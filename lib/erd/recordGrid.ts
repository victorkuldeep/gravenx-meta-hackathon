/**
 * Record grid data helpers: column union, filtering, and Excel-shaped
 * exports for the "view all aboard records as a table" modal. Pure logic -
 * the modal component owns rendering and clipboard/download I/O.
 */

/** API-name columns across rows: Id first, then first-seen order. Skips the REST envelope noise. */
export function gridColumns(rows: Record<string, unknown>[], requiredFields: string[] = []): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (k === "attributes" || seen.has(k)) continue;
      seen.add(k);
      cols.push(k);
    }
  }
  // Id (primary key) first, then required fields, then everything else
  // alphabetical (case-insensitive, deterministic across runtimes) so wide
  // objects scan the same way on every open.
  const pinned = new Set(requiredFields);
  const alpha = (a: string, b: string): number => {
    const al = a.toLowerCase();
    const bl = b.toLowerCase();
    if (al !== bl) return al < bl ? -1 : 1;
    return a < b ? -1 : a > b ? 1 : 0;
  };
  cols.sort((a, b) => {
    if (a === "Id") return -1;
    if (b === "Id") return 1;
    // Name is the human key and all but always populated - it rides right
    // behind Id even when the describe marks it optional.
    if (a === "Name") return -1;
    if (b === "Name") return 1;
    const pa = pinned.has(a) ? 0 : 1;
    const pb = pinned.has(b) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return alpha(a, b);
  });
  return cols;
}

const textOf = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v) ?? "";
  return String(v);
};

export interface GridFilter {
  /** Global search across every visible cell. */
  search: string;
  /** Per-column contains filter (API name -> substring). */
  cols: Record<string, string>;
  /** Hidden API names. */
  hidden: Set<string>;
}

/** Rows matching the search + per-column filters, over visible columns. */
export function filterGridRows(
  rows: Record<string, unknown>[],
  columns: string[],
  filter: GridFilter
): Record<string, unknown>[] {
  const q = filter.search.trim().toLowerCase();
  const colQs = Object.entries(filter.cols)
    .filter(([, v]) => v.trim() !== "")
    .map(([k, v]) => [k, v.trim().toLowerCase()] as const);
  return rows.filter((row) => {
    for (const [k, needle] of colQs) {
      if (!textOf(row[k]).toLowerCase().includes(needle)) return false;
    }
    if (q === "") return true;
    return columns.some((c) => !filter.hidden.has(c) && textOf(row[c]).toLowerCase().includes(q));
  });
}

/** Raw cell text for export: absent side as null, containers compact. */
export function gridCellFull(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (typeof v === "string") return v;
  return JSON.stringify(v) ?? "null";
}

/** Tab-separated grid: header + one line per row. Pastes straight into Excel. */
export function gridRowsToTsv(rows: Record<string, unknown>[], columns: string[]): string {
  const esc = (s: string) => (/[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [columns.map(esc).join("\t")];
  for (const row of rows) lines.push(columns.map((c) => esc(gridCellFull(row[c]))).join("\t"));
  return lines.join("\n");
}

/** String matrix for the shared ExcelJS workbook builder. */
export function gridRowsToMatrix(rows: Record<string, unknown>[], columns: string[]): string[][] {
  return rows.map((row) => columns.map((c) => gridCellFull(row[c])));
}
