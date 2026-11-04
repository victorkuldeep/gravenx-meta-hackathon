/**
 * Mapping Studio - sample JSON line renderer.
 *
 * Pretty-prints the source sample while recording the canonical catalog
 * path id (the same "$.order.lines[].sku" notation extractPaths emits)
 * for every line. The workspace viewer uses those ids to scroll to and
 * highlight the selected path, so repeated key names stay distinguishable.
 */

const SAFE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function segment(key: string): string {
  return SAFE_KEY.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

export interface JsonLine {
  text: string;
  /** Canonical path id of the value on this line. Null for bare closers. */
  pathId: string | null;
  depth: number;
}

function scalarText(value: unknown): string {
  if (typeof value === "string") {
    const s = value.length > 120 ? `${value.slice(0, 117)}…` : value;
    return JSON.stringify(s);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return '"…"';
}

/**
 * Render a value to lines. Every array element renders (values stay
 * visible for discussion) but all share the single [] element path id,
 * mirroring the catalog: one row per field, never per index.
 */
export function renderJsonLines(value: unknown, maxLines = 800): { lines: JsonLine[]; truncated: boolean } {
  const lines: JsonLine[] = [];
  const emit = (text: string, pathId: string | null, depth: number) => {
    if (lines.length < maxLines) lines.push({ text: `${"  ".repeat(depth)}${text}`, pathId, depth });
  };

  const write = (node: unknown, pathId: string | null, depth: number, prefix: string, isLast: boolean): void => {
    const comma = isLast ? "" : ",";
    if (Array.isArray(node)) {
      if (node.length === 0) {
        emit(`${prefix}[]${comma}`, pathId, depth);
        return;
      }
      emit(`${prefix}[`, pathId, depth);
      node.forEach((el, i) => write(el, pathId ? `${pathId}[]` : null, depth + 1, "", i === node.length - 1));
      emit(`]${comma}`, null, depth);
      return;
    }
    if (node !== null && typeof node === "object") {
      const entries = Object.entries(node);
      if (entries.length === 0) {
        emit(`${prefix}{}${comma}`, pathId, depth);
        return;
      }
      emit(`${prefix}{`, pathId, depth);
      entries.forEach(([k, v], i) => {
        write(v, pathId ? `${pathId}${segment(k)}` : null, depth + 1, `${JSON.stringify(k)}: `, i === entries.length - 1);
      });
      emit(`}${comma}`, null, depth);
      return;
    }
    emit(`${prefix}${scalarText(node)}${comma}`, pathId, depth);
  };

  write(value, "$", 0, "", true);
  return { lines, truncated: lines.length >= maxLines };
}

/** Line indexes to highlight for a selected catalog path: itself + its [] subtree. */
export function highlightIndexes(lines: JsonLine[], selected: string | null): Set<number> {
  const out = new Set<number>();
  if (!selected) return out;
  lines.forEach((line, i) => {
    if (line.pathId === selected) out.add(i);
  });
  return out;
}
