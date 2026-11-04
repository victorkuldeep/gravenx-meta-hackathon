/**
 * Canonical JSON paths: `$`, `$.account`, `$.contacts[0].id`.
 * Keys unsafe for dot notation use bracket-quoted segments.
 * One convention shared by Editor Graph, diffs, search and copy.
 */

export type PathSegment = string | number;
export type JsonPath = PathSegment[];

const SAFE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function stringifyPath(path: JsonPath): string {
  let out = "$";
  for (const seg of path) {
    if (typeof seg === "number") {
      out += `[${seg}]`;
    } else if (SAFE_KEY.test(seg)) {
      out += `.${seg}`;
    } else {
      out += `[${JSON.stringify(seg)}]`;
    }
  }
  return out;
}

/** Parse what stringifyPath produces (plus bare `$`). Throws on garbage. */
export function parsePath(text: string): JsonPath {
  const t = text.trim();
  if (t === "" || t === "$") return [];
  if (!t.startsWith("$")) throw new Error(`Not a canonical path: ${text}`);
  const path: JsonPath = [];
  // Tokenize `.name`, `[0]`, `["weird key"]` segments.
  const re = /(?:\.([A-Za-z_$][A-Za-z0-9_$]*))|(?:\[(\d+)\])|(?:\["((?:[^"\\]|\\.)*)"\])/g;
  let m: RegExpExecArray | null;
  let consumed = 1;
  while ((m = re.exec(t)) !== null) {
    if (m.index !== consumed) throw new Error(`Not a canonical path: ${text}`);
    if (m[1] !== undefined) path.push(m[1]);
    else if (m[2] !== undefined) path.push(Number(m[2]));
    else path.push(JSON.parse(`"${m[3]}"`));
    consumed = m.index + m[0].length;
  }
  if (consumed !== t.length) throw new Error(`Not a canonical path: ${text}`);
  return path;
}

/** Resolve a path against a value. Returns {found, value}. Never throws. */
export function resolvePath(value: unknown, path: JsonPath): { found: boolean; value: unknown } {
  let cur = value;
  for (const seg of path) {
    if (cur === null || typeof cur !== "object") return { found: false, value: undefined };
    if (typeof seg === "number") {
      if (!Array.isArray(cur) || seg < 0 || seg >= cur.length) return { found: false, value: undefined };
      cur = cur[seg];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) return { found: false, value: undefined };
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return { found: true, value: cur };
}

export function parentPath(path: JsonPath): JsonPath {
  return path.slice(0, -1);
}
