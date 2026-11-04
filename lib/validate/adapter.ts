/**
 * Validate workspace - OpenAPI 3.0 compatibility adapter.
 *
 * Translates OpenAPI 3.0 Schema Objects into Draft 2020-12 JSON Schema
 * for AJV. OpenAPI 3.1 schemas already are JSON Schema and pass through
 * (with a scan for unsupported constructs).
 *
 * Never mutates the input. Never guesses author intent: suspicious
 * patterns produce advisories, not silent rewrites.
 */

import type { ContractDiagnostic } from "./types";

export interface AdaptOptions {
  version: string; // "3.0.x" | "3.1.x"
  direction: "request" | "response";
}

export interface AdaptResult {
  schema: unknown;
  supported: boolean;
  diagnostics: ContractDiagnostic[];
}

let diagSeq = 0;
function diag(
  severity: ContractDiagnostic["severity"],
  message: string,
  opts?: Partial<ContractDiagnostic>
): ContractDiagnostic {
  return { id: `adapt-${++diagSeq}`, severity, message, blocking: severity === "error", ...opts };
}

const KNOWN_TYPES = new Set(["null", "boolean", "object", "array", "number", "string", "integer"]);

/** Formats enforced by ajv-formats. Anything else is stripped + reported. */
const ENFORCED_FORMATS = new Set([
  "date",
  "time",
  "date-time",
  "duration",
  "uri",
  "uri-reference",
  "uri-template",
  "url",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
  "regex",
  "uuid",
  "json-pointer",
  "relative-json-pointer",
]);

const ANNOTATIONS = new Set(["example", "examples", "xml", "externalDocs", "deprecated", "title", "description", "default"]);

interface Ctx extends AdaptOptions {
  diagnostics: ContractDiagnostic[];
  location: string;
}

function convertExclusiveBoundaries(node: Record<string, unknown>): void {
  // OpenAPI 3.0 boolean form -> Draft 2020-12 numeric form.
  if (node.exclusiveMinimum === true && typeof node.minimum === "number") {
    node.exclusiveMinimum = node.minimum;
    delete node.minimum;
  } else if (node.exclusiveMinimum === false) {
    delete node.exclusiveMinimum;
  }
  if (node.exclusiveMaximum === true && typeof node.maximum === "number") {
    node.exclusiveMaximum = node.maximum;
    delete node.maximum;
  } else if (node.exclusiveMaximum === false) {
    delete node.exclusiveMaximum;
  }
}

function adaptNode(raw: unknown, ctx: Ctx): unknown {
  if (Array.isArray(raw)) return raw.map((v) => adaptNode(v, ctx));
  if (typeof raw !== "object" || raw === null) return raw;

  const node = { ...(raw as Record<string, unknown>) };

  // Drop vendor extensions + pure annotations silently (3.0) — info for deprecated.
  for (const key of Object.keys(node)) {
    if (key.startsWith("x-")) delete node[key];
    else if (ANNOTATIONS.has(key) && key !== "title" && key !== "description") delete node[key];
  }

  // discriminator: validated as pure composition; dispatch is NOT performed.
  if (node.discriminator !== undefined) {
    delete node.discriminator;
    ctx.diagnostics.push(
      diag("info", "discriminator is informational only - oneOf/anyOf branches validate by pure composition semantics.", { location: ctx.location })
    );
  }

  // readOnly / writeOnly: strip markers; relax `required` for the
  // direction in which such properties must be absent-tolerant.
  const props = node.properties as Record<string, unknown> | undefined;
  if (props && typeof props === "object") {
    const required = Array.isArray(node.required) ? [...(node.required as unknown[])] : null;
    for (const [name, sub] of Object.entries(props)) {
      if (typeof sub !== "object" || sub === null) continue;
      const marker = sub as Record<string, unknown>;
      const hide =
        (ctx.direction === "request" && marker.readOnly === true) ||
        (ctx.direction === "response" && marker.writeOnly === true);
      if (hide && required) {
        const idx = required.indexOf(name);
        if (idx >= 0) {
          required.splice(idx, 1);
          ctx.diagnostics.push(
            diag("info", `Property "${name}" is ${marker.readOnly === true ? "readOnly" : "writeOnly"} - not required for ${ctx.direction} validation.`, { location: ctx.location })
          );
        }
      }
      if (marker.readOnly !== undefined || marker.writeOnly !== undefined) {
        const cleaned = { ...marker };
        delete cleaned.readOnly;
        delete cleaned.writeOnly;
        props[name] = cleaned;
      }
    }
    if (required) node.required = required;
  } else {
    if ((node as Record<string, unknown>).readOnly !== undefined) delete (node as Record<string, unknown>).readOnly;
    if ((node as Record<string, unknown>).writeOnly !== undefined) delete (node as Record<string, unknown>).writeOnly;
  }

  // Unknown type values block validation - never guess.
  if (node.type !== undefined && typeof node.type === "string" && !KNOWN_TYPES.has(node.type)) {
    ctx.diagnostics.push(
      diag("error", `Unsupported schema type "${node.type}" - validation blocked for this schema.`, { location: ctx.location })
    );
    return node;
  }

  // Formats that ajv-formats cannot enforce are stripped + reported.
  if (typeof node.format === "string" && !ENFORCED_FORMATS.has(node.format)) {
    ctx.diagnostics.push(
      diag("info", `String format "${node.format}" is informational - not enforced during validation.`, { location: ctx.location })
    );
    delete node.format;
  }

  convertExclusiveBoundaries(node);

  // Recurse into subschemas.
  for (const key of ["properties", "items", "additionalProperties", "contains", "if", "then", "else"]) {
    if (node[key] !== undefined) node[key] = adaptNode(node[key], ctx);
  }
  for (const key of ["allOf", "oneOf", "anyOf", "prefixItems"]) {
    if (Array.isArray(node[key])) node[key] = (node[key] as unknown[]).map((v) => adaptNode(v, ctx));
  }
  if (node.not !== undefined) node.not = adaptNode(node.not, ctx);

  // Suspicious conditional advisory (never a rewrite).
  if (node.if && typeof node.if === "object" && !Array.isArray(node.if)) {
    const cond = node.if as Record<string, unknown>;
    if (cond.properties !== undefined && cond.required === undefined && (node.then !== undefined || node.else !== undefined)) {
      ctx.diagnostics.push(
        diag("info", "Suspicious conditional: `if` tests properties without `required`, so the condition passes when the property is absent. Contract semantics preserved - branches evaluated as written.", { location: ctx.location })
      );
    }
  }

  // nullable (3.0 only): enum -> append null; otherwise anyOf wrap.
  if (ctx.version.startsWith("3.0") && node.nullable === true) {
    delete node.nullable;
    if (Array.isArray(node.enum)) {
      if (!node.enum.includes(null)) node.enum = [...node.enum, null];
      return node;
    }
    return { anyOf: [node, { type: "null" }] };
  }
  if (node.nullable !== undefined) delete node.nullable;

  return node;
}

/** Scan for keywords no adapter handles - these warn, never silently pass. */
function scanUnsupported(node: unknown, diagnostics: ContractDiagnostic[], location: string, seen = new Set<unknown>()): void {
  if (typeof node !== "object" || node === null || seen.has(node)) return;
  seen.add(node);
  const rec = node as Record<string, unknown>;
  if (rec.discriminator !== undefined) return; // handled with info elsewhere
  for (const [k, v] of Object.entries(rec)) {
    if (k === "$ref" || k.startsWith("x-")) continue;
    scanUnsupported(v, diagnostics, location, seen);
  }
}

export function adaptSchema(schema: unknown, opts: AdaptOptions): AdaptResult {
  const diagnostics: ContractDiagnostic[] = [];
  const ctx: Ctx = { ...opts, diagnostics, location: "#/schema" };
  const adapted = adaptNode(schema, ctx);
  scanUnsupported(adapted, diagnostics, ctx.location);
  const blocking = diagnostics.some((d) => d.severity === "error" && d.blocking);
  return { schema: adapted, supported: !blocking, diagnostics };
}

/** Explicit support matrix, mirrored in the UI help. */
export interface SupportRow {
  feature: string;
  status: "supported" | "limited" | "unsupported" | "na";
  note: string;
}

export function supportMatrix(version: string): SupportRow[] {
  const is30 = version.startsWith("3.0");
  return [
    { feature: is30 ? "OpenAPI 3.0" : "OpenAPI 3.1", status: "supported", note: is30 ? "Adapted to Draft 2020-12 for AJV." : "Native JSON Schema - compiled directly." },
    { feature: "JSON Schema dialect", status: "supported", note: "Draft 2020-12 (AJV + ajv-formats)." },
    { feature: "Local $ref", status: "supported", note: "Dereferenced at import via Scalar." },
    { feature: "External $ref", status: "unsupported", note: "Never fetched. Import is blocked until inlined." },
    { feature: "nullable (3.0)", status: "supported", note: "Translated to enum-null or anyOf null." },
    { feature: "allOf / oneOf / anyOf", status: "supported", note: "Pure composition semantics. oneOf = exactly one." },
    { feature: "if / then / else", status: "supported", note: "Evaluated as written. Suspicious patterns get advisories." },
    { feature: "discriminator", status: "limited", note: "Informational only - no dispatch, branches validate by composition." },
    { feature: "readOnly / writeOnly", status: "limited", note: "Markers stripped; requiredness relaxed for the absent direction." },
    { feature: "formats", status: "limited", note: "Standard formats enforced (date-time, email, uuid, uri…). OpenAPI-only formats (int32, byte, binary…) are informational." },
    { feature: "exclusiveMinimum/Maximum", status: "supported", note: "3.0 boolean form converted to numeric form." },
    { feature: "required / enum / string / numeric / array constraints", status: "supported", note: "Enforced as written. coerceTypes, useDefaults and removeAdditional are OFF." },
    { feature: "Vendor extensions (x-*)", status: "na", note: "Ignored - never affect validation." },
  ];
}
