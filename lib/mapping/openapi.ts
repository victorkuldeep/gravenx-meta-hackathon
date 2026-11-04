/**
 * Mapping Studio - OpenAPI source sampler.
 *
 * Turns an OpenAPI 3.x operation into a sample source payload: ingest the
 * spec through the shared validate pipeline (size limits, version gate,
 * local-refs-only dereference), pick request or response schema, check the
 * fields you want, and generate representative JSON that drops straight
 * into the mapping source catalog.
 */

import { extractOperations } from "@/lib/validate/operations";
import { ingestSpec } from "@/lib/validate/spec";

export type { Operation } from "@/lib/validate/types";
import type { Operation } from "@/lib/validate/types";

export interface SpecIngest {
  version?: string;
  operations: Operation[];
  /** Fatal problems - nothing usable. Warnings stay on the operations. */
  errors: string[];
}

const MAX_FIELDS = 2000;
const MAX_DEPTH = 10;

type Schema = Record<string, unknown>;

/** Full ingest: parse -> gate -> dereference -> operations. Never throws. */
export async function ingestMappingSpec(text: string, fileName: string): Promise<SpecIngest> {
  const { contract, dereferenced, diagnostics, fatal } = await ingestSpec({
    fileName: fileName.trim() || "spec.yaml",
    text,
    byteSize: new Blob([text]).size,
  });
  const errors = diagnostics.filter((d) => d.severity === "error").map((d) => d.message);
  if (fatal || !dereferenced) return { version: contract.version, operations: [], errors };
  const { operations } = extractOperations(dereferenced, contract.version ?? "3.0");
  if (operations.length === 0) return { version: contract.version, operations: [], errors: ["No operations found under #/paths."] };
  return { version: contract.version, operations, errors };
}

function asSchema(value: unknown): Schema | undefined {
  return typeof value === "object" && value !== null ? (value as Schema) : undefined;
}

/** Merge allOf branches into one effective schema (shallow: properties + required). */
function resolveCombinators(schema: Schema, seen: Set<unknown>): Schema {
  let out = schema;
  const allOf = Array.isArray(out.allOf) ? out.allOf.map(asSchema).filter((s): s is Schema => !!s) : [];
  if (allOf.length > 0) {
    const merged: Schema = { ...out };
    const props: Record<string, unknown> = { ...(asSchema(out.properties) ?? {}) };
    const required = new Set<string>(Array.isArray(out.required) ? (out.required as string[]) : []);
    for (const branch of allOf) {
      const b = resolveCombinators(branch, seen);
      Object.assign(props, asSchema(b.properties) ?? {});
      for (const r of Array.isArray(b.required) ? (b.required as string[]) : []) required.add(r);
      if (!merged.description && typeof b.description === "string") merged.description = b.description;
    }
    merged.properties = props;
    merged.required = [...required];
    delete merged.allOf;
    out = merged;
  }
  const oneOf = Array.isArray(out.oneOf) ? out.oneOf.map(asSchema).find((s) => !!s) : undefined;
  const anyOf = Array.isArray(out.anyOf) ? out.anyOf.map(asSchema).find((s) => !!s) : undefined;
  const choice = oneOf ?? anyOf;
  if (choice && !asSchema(out.properties) && out.type !== "array") {
    return { ...resolveCombinators(choice, seen), description: (out.description as string) ?? choice.description };
  }
  return out;
}

function typeLabel(schema: Schema): string {
  const t = typeof schema.type === "string" ? schema.type : undefined;
  if (t === "array") {
    const items = asSchema(schema.items);
    return `${items ? typeLabel(resolveCombinators(items, new Set())) : "any"}[]`;
  }
  if (t) return schema.format ? `${t}(${String(schema.format)})` : t;
  if (Array.isArray(schema.enum)) return "enum";
  return "object";
}

export interface FlatField {
  id: string;
  key: string;
  type: string;
  required: boolean;
  description?: string;
  depth: number;
  /** True for object/array rows - toggling one selects its whole subtree. */
  container: boolean;
}

/** Leaf ids under a container row (container id itself included when selectable). */
export function descendantLeafIds(fields: FlatField[], containerId: string): string[] {
  return fields
    .filter((f) => !f.container && (f.id === containerId || f.id.startsWith(`${containerId}.`) || f.id.startsWith(`${containerId}[]`)))
    .map((f) => f.id);
}

/** Flatten a (dereferenced) JSON schema to checkbox-ready fields. Dotted ids, [] for arrays. */
export function flattenFields(root: unknown): FlatField[] {
  const out: FlatField[] = [];
  const push = (field: FlatField) => {
    if (out.length < MAX_FIELDS) out.push(field);
  };
  const walk = (schema: Schema, id: string, key: string, required: boolean, depth: number, seen: Set<unknown>) => {
    if (out.length >= MAX_FIELDS || depth > MAX_DEPTH || seen.has(schema)) return;
    seen.add(schema);
    const resolved = resolveCombinators(schema, seen);
    const props = asSchema(resolved.properties);
    const desc = typeof resolved.description === "string" ? resolved.description : undefined;
    if (resolved.type === "array" || (!resolved.type && asSchema(resolved.items))) {
      const items = asSchema(resolved.items);
      const elemId = id ? `${id}[]` : "[]";
      push({ id: elemId, key: id ? `${key}[]` : "[]", type: items ? typeLabel(resolveCombinators(items, seen)) : "any", required, description: desc, depth: depth + 1, container: true });
      if (items) walk(items, elemId, key, false, depth + 1, seen);
      return;
    }
    if (props) {
      if (id) push({ id, key, type: "object", required, description: desc, depth, container: true });
      const requiredSet = new Set<string>(Array.isArray(resolved.required) ? (resolved.required as string[]) : []);
      for (const [k, child] of Object.entries(props)) {
        const childSchema = asSchema(child);
        if (!childSchema) continue;
        const childId = id ? `${id}.${k}` : k;
        const childResolved = resolveCombinators(childSchema, seen);
        const childProps = asSchema(childResolved.properties);
        const childIsArray = childResolved.type === "array" || (!childResolved.type && asSchema(childResolved.items));
        if (childProps || childIsArray) {
          walk(childSchema, childId, k, requiredSet.has(k), depth + 1, seen);
        } else {
          push({
            id: childId,
            key: k,
            type: typeLabel(childResolved),
            required: requiredSet.has(k),
            description: typeof childResolved.description === "string" ? childResolved.description : undefined,
            depth: depth + 1,
            container: false,
          });
        }
        if (out.length >= MAX_FIELDS) return;
      }
      return;
    }
    // Scalar leaf (or root scalar, which has no id and is skipped).
    if (!id) return;
    push({ id, key, type: typeLabel(resolved), required, description: desc, depth, container: false });
  };
  const schema = asSchema(root);
  if (!schema) return [];
  walk(schema, "", "$", false, 0, new Set());
  return out;
}

export type BodySide = "request" | "response";

/** First JSON schema available for the side. Prefers 2xx responses. */
export function schemaForSide(
  op: Operation,
  side: BodySide,
  statusCode?: string
): { schema: unknown; label: string } | undefined {
  if (side === "request") {
    const found = op.request?.contentTypes.find((c) => c.supported && c.schema !== undefined);
    return found ? { schema: found.schema, label: "request body" } : undefined;
  }
  const ordered = [...op.responses].sort((a, b) => {
    const rank = (s: string) => (s.startsWith("2") ? 0 : s === "default" ? 2 : 1);
    return rank(a.statusCode) - rank(b.statusCode);
  });
  const pick = (statusCode ? ordered.filter((r) => r.statusCode === statusCode) : ordered)
    .map((r) => ({ r, c: r.contentTypes.find((c) => c.supported && c.schema !== undefined) }))
    .find((x) => x.c);
  return pick ? { schema: pick.c?.schema, label: `${pick.r.statusCode} response` } : undefined;
}

function placeholderFor(schema: Schema): unknown {
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  switch (schema.type) {
    case "string":
      if (schema.format === "date") return "2024-01-15";
      if (schema.format === "date-time") return "2024-01-15T10:00:00Z";
      if (schema.format === "email") return "user@example.com";
      if (schema.format === "uuid") return "3fa85f64-5717-4562-b3fc-2c963f66afa6";
      if (schema.format === "uri") return "https://example.com/resource/1";
      return "string";
    case "integer":
      return 0;
    case "number":
      return 0;
    case "boolean":
      return true;
    default:
      return null;
  }
}

/**
 * Build sample JSON from a schema, including only selected field ids.
 * Containers are emitted when selected themselves or when any selected
 * id descends from them. Arrays carry a single representative element.
 */
export function generateSample(root: unknown, selected: Set<string>): unknown {
  const build = (schema: Schema, id: string, seen: Set<unknown>): unknown => {
    if (seen.has(schema)) return undefined;
    seen.add(schema);
    const resolved = resolveCombinators(schema, seen);
    if (resolved.type === "array" || (!resolved.type && asSchema(resolved.items))) {
      const items = asSchema(resolved.items);
      if (!items) return [];
      const elem = build(items, `${id}[]`, seen);
      return elem === undefined ? [] : [elem];
    }
    const props = asSchema(resolved.properties);
    if (props) {
      const obj: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(props)) {
        const childSchema = asSchema(child);
        if (!childSchema) continue;
        const childId = id ? `${id}.${k}` : k;
        const wanted =
          selected.has(childId) || [...selected].some((s) => s === childId || s.startsWith(`${childId}.`) || s.startsWith(`${childId}[]`));
        if (!wanted) continue;
        const value = build(childSchema, childId, seen);
        if (value !== undefined) obj[k] = value;
      }
      // A selected container with no selected descendants still needs a body.
      if (Object.keys(obj).length === 0 && selected.has(id)) {
        for (const [k, child] of Object.entries(props)) {
          const childSchema = asSchema(child);
          if (!childSchema) continue;
          const value = build(childSchema, id ? `${id}.${k}` : k, seen);
          if (value !== undefined) obj[k] = value;
        }
      }
      return obj;
    }
    return placeholderFor(resolved);
  };
  const schema = asSchema(root);
  if (!schema) return undefined;
  return build(schema, "", new Set());
}
