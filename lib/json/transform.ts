import { parsePath, type JsonPath } from "./path";
import { parseJsonInput } from "./studio";

/**
 * JSON Transform: node surgery (drop / set / rename by canonical path) plus
 * escape-and-embed for string-carried payloads (RCA setInstance style:
 * `salesTransaction: "<escaped json>"`). Pure functions - the UI owns state.
 */

export type TransformOp =
  | { kind: "drop"; path: string }
  | { kind: "set"; path: string; valueText: string }
  | { kind: "rename"; parent: string; from: string; to: string };

export interface TransformError {
  op: number;
  message: string;
}

const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

function parentOf(root: unknown, path: JsonPath): { parent: unknown; key: string | number } | { error: string } {
  if (path.length === 0) return { error: "Path points at the root ($)" };
  const key = path[path.length - 1];
  let cur = root;
  for (const seg of path.slice(0, -1)) {
    if (cur === null || typeof cur !== "object") return { error: "Path crosses a non-container" };
    if (typeof seg === "number") {
      if (!Array.isArray(cur) || seg < 0 || seg >= cur.length) return { error: `Index [${seg}] out of range` };
      cur = cur[seg];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) return { error: `Key "${seg}" not found` };
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return { parent: cur, key };
}

/**
 * Apply surgery ops in listed order to a deep clone. A failing op is
 * skipped and reported - the rest still apply. Drops apply top-to-bottom,
 * so dropping two array indices lists the higher index first.
 */
export function applyTransformOps(
  value: unknown,
  ops: TransformOp[]
): { value: unknown; errors: TransformError[] } {
  const out = clone(value);
  const errors: TransformError[] = [];
  ops.forEach((op, i) => {
    try {
      if (op.kind === "drop") {
        const path = parsePath(op.path);
        const loc = parentOf(out, path);
        if ("error" in loc) throw new Error(loc.error);
        if (typeof loc.key === "number") {
          if (!Array.isArray(loc.parent)) throw new Error("Parent is not an array");
          if (loc.key < 0 || loc.key >= loc.parent.length) throw new Error(`Index [${loc.key}] out of range`);
          loc.parent.splice(loc.key, 1);
        } else {
          if (loc.parent === null || typeof loc.parent !== "object" || Array.isArray(loc.parent)) {
            throw new Error("Parent is not an object");
          }
          if (!Object.prototype.hasOwnProperty.call(loc.parent, loc.key)) {
            throw new Error(`Key "${loc.key}" not found`);
          }
          delete (loc.parent as Record<string, unknown>)[loc.key];
        }
      } else if (op.kind === "set") {
        const path = parsePath(op.path);
        if (path.length === 0) throw new Error("Cannot replace the root - drop or rename instead");
        const parsed = parseJsonInput(op.valueText);
        if (!parsed.ok) throw new Error(`Value is not valid JSON: ${parsed.error}`);
        const loc = parentOf(out, path);
        if ("error" in loc) throw new Error(loc.error);
        if (typeof loc.key === "number") {
          if (!Array.isArray(loc.parent)) throw new Error("Parent is not an array");
          if (loc.key < 0 || loc.key >= loc.parent.length) throw new Error(`Index [${loc.key}] out of range`);
          loc.parent[loc.key] = parsed.value;
        } else {
          if (loc.parent === null || typeof loc.parent !== "object" || Array.isArray(loc.parent)) {
            throw new Error("Parent is not an object");
          }
          (loc.parent as Record<string, unknown>)[loc.key] = parsed.value;
        }
      } else {
        const parentPath = parsePath(op.parent);
        const from = op.from.trim();
        const to = op.to.trim();
        if (!from) throw new Error("Rename needs a source key");
        if (!to) throw new Error("Rename needs a target key");
        let holder: unknown = out;
        for (const seg of parentPath) {
          if (holder === null || typeof holder !== "object") throw new Error("Parent path crosses a non-container");
          if (typeof seg === "number") {
            if (!Array.isArray(holder) || seg < 0 || seg >= holder.length) {
              throw new Error(`Index [${seg}] out of range`);
            }
            holder = holder[seg];
          } else {
            if (!Object.prototype.hasOwnProperty.call(holder, seg)) throw new Error(`Key "${seg}" not found`);
            holder = (holder as Record<string, unknown>)[seg];
          }
        }
        if (holder === null || typeof holder !== "object" || Array.isArray(holder)) {
          throw new Error("Rename parent is not an object");
        }
        const obj = holder as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(obj, from)) throw new Error(`Key "${from}" not found`);
        if (Object.prototype.hasOwnProperty.call(obj, to)) throw new Error(`Key "${to}" already exists`);
        obj[to] = obj[from];
        delete obj[from];
      }
    } catch (err) {
      errors.push({ op: i, message: err instanceof Error ? err.message : "Operation failed" });
    }
  });
  return { value: out, errors };
}

/**
 * Escape a value's JSON text for embedding inside another quoted context
 * (single-quoted Apex string, JSON string field). Returns the inner content
 * WITHOUT surrounding quotes - the caller supplies the quotes.
 */
export function escapeForEmbedding(value: unknown, pretty: boolean): string {
  const text = JSON.stringify(value, null, pretty ? 2 : 0) ?? "null";
  return JSON.stringify(text).slice(1, -1);
}

/** Build the wrapper object carrying the payload as a string field. */
export function buildWrapper(
  value: unknown,
  wrapperKey: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...extra, [wrapperKey]: JSON.stringify(value) };
}

/** Reverse an escaped string (or a wrapper carrying one) back to a value. */
export function unescapeToJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const t = text.trim();
  if (!t) return { ok: false, error: "Nothing to unescape" };
  const first = parseJsonInput(t);
  if (!first.ok) {
    // Bare escaped content without surrounding quotes (Apex-style) - wrap and retry.
    const wrapped = parseJsonInput(`"${t}"`);
    if (!wrapped.ok) return { ok: false, error: first.error };
    return unescapeParsed(wrapped.value);
  }
  return unescapeParsed(first.value);
}

function unescapeParsed(v: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (typeof v === "string") {
    const inner = parseJsonInput(v);
    if (!inner.ok) return { ok: false, error: `String content is not JSON: ${inner.error}` };
    return { ok: true, value: inner.value };
  }
  if (v !== null && typeof v === "object") {
    // Wrapper object? Unescape the first string field found.
    for (const val of Object.values(v)) {
      if (typeof val === "string") {
        const inner = parseJsonInput(val);
        if (inner.ok) return { ok: true, value: inner.value };
      }
    }
  }
  return { ok: false, error: "No escaped JSON string found" };
}
