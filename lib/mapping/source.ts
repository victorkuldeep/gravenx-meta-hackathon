/**
 * Mapping Studio - source JSON parsing + path catalog.
 *
 * Canonical notation: "$.order.orderNumber", "$.orderItem[].sku".
 * Arrays collapse to a single [] element path. Shape is the union of
 * keys across the first ELEMENT_SCAN_LIMIT elements (first-seen order,
 * first defined value wins) so ragged samples - line 7 carrying a key
 * that line 1 lacks - still catalog every field once. The canonical
 * path IS the stable id, so reparse reconciles without losing mappings.
 */

import type { JsonType, NodeKind, SourcePath } from "./types";

export interface ParseResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export function parseSourceJson(text: string): ParseResult {
  if (!text.trim()) return { ok: false, error: "Source is empty - paste JSON to begin." };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const pos = /position (\d+)/.exec(msg)?.[1];
    let suffix = "";
    if (pos) {
      const idx = Number(pos);
      const before = text.slice(0, idx);
      suffix = ` (line ${before.split("\n").length}, column ${idx - before.lastIndexOf("\n")})`;
    }
    return { ok: false, error: `Invalid JSON: ${msg}${suffix}` };
  }
}

function jsonTypeOf(value: unknown): JsonType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    case "object":
      return "object";
    default:
      return "string";
  }
}

function kindOf(value: unknown): NodeKind {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return "scalar";
}

const SAFE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function segment(key: string): string {
  return SAFE_KEY.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function truncateExample(value: unknown): unknown {
  if (typeof value === "string" && value.length > 120) return `${value.slice(0, 117)}…`;
  if (typeof value === "object" && value !== null) return undefined; // containers carry no scalar preview
  return value;
}

/** How many array elements contribute keys to the [] union shape. */
export const ELEMENT_SCAN_LIMIT = 25;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Extract every path. Object/array containers are catalog rows too
 * (mappable to record plans); array elements collapse to one [] row.
 */
export function extractPaths(value: unknown): SourcePath[] {
  const out: SourcePath[] = [];

  const visit = (node: unknown, path: string, parent: string | null, key: string, depth: number, inArray: boolean) => {
    const kind = kindOf(node);
    out.push({
      id: path,
      path,
      parent,
      key,
      kind,
      jsonType: jsonTypeOf(node),
      example: kind === "scalar" || kind === "null" ? truncateExample(node) : undefined,
      depth,
      inArray,
      required: "unknown", // sample-only: never infer mandatory from presence
    });

    if (kind === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        visit(v, `${path}${segment(k)}`, path, k, depth + 1, inArray);
      }
    } else if (kind === "array") {
      const arr = (node as unknown[]).slice(0, ELEMENT_SCAN_LIMIT);
      if (arr.length > 0) {
        // Single [] row. Union shape across scanned elements so ragged
        // samples catalog every key once; first defined value wins.
        const first = arr[0];
        const firstKind = kindOf(first);
        const elemIsContainer = firstKind === "object" || firstKind === "array" || arr.some((el) => isPlainObject(el) || Array.isArray(el));
        const elemPath = `${path}[]`;
        out.push({
          id: elemPath,
          path: elemPath,
          parent: path,
          key: `${key}[]`,
          kind: elemIsContainer ? (arr.some((el) => isPlainObject(el)) || firstKind === "object" ? "object" : "array") : firstKind === "null" ? "null" : "scalar",
          jsonType: jsonTypeOf(first),
          example: firstKind === "scalar" || firstKind === "null" ? truncateExample(first) : undefined,
          depth: depth + 1,
          inArray: true,
          required: "unknown",
        });
        const objects = arr.filter(isPlainObject);
        if (objects.length > 0) {
          // Union keys in first-seen order; shape per key from its first defined value.
          const ordered: string[] = [];
          const seenKeys = new Set<string>();
          for (const obj of objects) {
            for (const k of Object.keys(obj)) {
              if (!seenKeys.has(k)) {
                seenKeys.add(k);
                ordered.push(k);
              }
            }
          }
          for (const k of ordered) {
            const holder = (objects.find((obj) => k in obj && obj[k] !== undefined && obj[k] !== null) ??
              objects.find((obj) => k in obj)) as Record<string, unknown>;
            visit(holder[k], `${elemPath}${segment(k)}`, elemPath, k, depth + 2, true);
          }
        } else if (firstKind === "array") {
          // Nested array: elemPath already represents the element - expand one level.
          const inners = arr.filter((el): el is unknown[] => Array.isArray(el) && el.length > 0);
          const innerObjects = inners.map((inner) => inner[0]).filter(isPlainObject);
          if (innerObjects.length > 0) {
            const ordered: string[] = [];
            const seenKeys = new Set<string>();
            for (const obj of innerObjects) {
              for (const k of Object.keys(obj)) {
                if (!seenKeys.has(k)) {
                  seenKeys.add(k);
                  ordered.push(k);
                }
              }
            }
            for (const k of ordered) {
              const holder = (innerObjects.find((obj) => k in obj && obj[k] !== undefined && obj[k] !== null) ??
                innerObjects.find((obj) => k in obj)) as Record<string, unknown>;
              visit(holder[k], `${elemPath}[]${segment(k)}`, elemPath, k, depth + 2, true);
            }
          }
        }
      }
    }
  };

  if (kindOf(value) === "object" || kindOf(value) === "array") {
    // Root row + children. Root id is "$" / "$[]".
    const rootPath = Array.isArray(value) ? "$[]" : "$";
    out.push({
      id: rootPath,
      path: rootPath,
      parent: null,
      key: "$",
      kind: kindOf(value),
      jsonType: jsonTypeOf(value),
      example: undefined,
      depth: 0,
      inArray: false,
      required: "unknown",
    });
    if (!Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        visit(v, `$${segment(k)}`, rootPath, k, 1, false);
      }
    } else {
      // Root array: "$[]" IS the element row - expand its union children directly.
      const scanned = (value as unknown[]).slice(0, ELEMENT_SCAN_LIMIT).filter(isPlainObject);
      const ordered: string[] = [];
      const seenKeys = new Set<string>();
      for (const obj of scanned) {
        for (const k of Object.keys(obj)) {
          if (!seenKeys.has(k)) {
            seenKeys.add(k);
            ordered.push(k);
          }
        }
      }
      for (const k of ordered) {
        const holder = (scanned.find((obj) => k in obj && obj[k] !== undefined && obj[k] !== null) ??
          scanned.find((obj) => k in obj)) as Record<string, unknown>;
        visit(holder[k], `${rootPath}${segment(k)}`, rootPath, k, 1, true);
      }
    }
  } else {
    visit(value, "$", null, "$", 0, false);
  }
  return out;
}

/** Reconcile saved mappings against a fresh catalog: split into live + orphaned. */
export function reconcilePaths(
  mappingSourcePaths: string[],
  catalog: SourcePath[]
): { live: string[]; orphaned: string[] } {
  const ids = new Set(catalog.map((p) => p.id));
  const live: string[] = [];
  const orphaned: string[] = [];
  for (const p of mappingSourcePaths) {
    (ids.has(p) ? live : orphaned).push(p);
  }
  return { live, orphaned };
}

/** Catalog-vs-catalog diff for source replace: added + removed path ids. */
export function diffSourceCatalog(
  oldIds: string[],
  newIds: string[]
): { added: string[]; removed: string[] } {
  const before = new Set(oldIds);
  const after = new Set(newIds);
  return {
    added: newIds.filter((id) => !before.has(id)),
    removed: oldIds.filter((id) => !after.has(id)),
  };
}
