/**
 * Shared Excel engine - every .xlsx export in the studio funnels through
 * here: one cell coercion, one sheet-name sanitizer, one frozen/filtered
 * sheet style. Callers declare sheets, the engine builds the workbook.
 */

import type ExcelJS from "exceljs";

/**
 * exceljs evaluates Node-only requires (`fs`) at its entry, which throws in
 * Cloudflare Workers at SSR time while working fine in Node dev - every page
 * bundling this module 500s in production. It must only ever load in the
 * browser download path, so every runtime touch goes through this lazy
 * loader. Type positions keep using `import type` (erased, zero runtime).
 */
async function loadExcelJS(): Promise<typeof ExcelJS> {
  return (await import("exceljs")).default as typeof ExcelJS;
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface ExcelSheetDef {
  name: string;
  /** Optional header row (bold). Absent for key-value sheets. */
  header?: string[];
  rows: unknown[][];
  /** Column widths in characters. */
  widths?: number[];
  /** Freeze the first row. Default true. */
  freezeHeader?: boolean;
  /** Autofilter over the data. Default true when rows exist. */
  filter?: boolean;
}

/** Excel sheet names: no \ / * ? : [ ], max 31 chars, unique per book. */
export function safeSheetName(name: string, used: Set<string>): string {
  const clean = name.replace(/[\\/*?:[\]]/g, "-").trim().slice(0, 31) || "Sheet";
  if (!used.has(clean)) {
    used.add(clean);
    return clean;
  }
  for (let i = 2; ; i++) {
    const suffix = ` (${i})`;
    const candidate = `${clean.slice(0, 31 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/** Coerce design-time values into Excel cells (objects stringify, dates stay dates). */
export function excelCell(v: unknown): ExcelJS.CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

export async function buildExcelWorkbook(sheets: ExcelSheetDef[]): Promise<ExcelJS.Workbook> {
  const Excel = await loadExcelJS();
  const wb = new Excel.Workbook();
  const used = new Set<string>();
  for (const def of sheets) {
    const ws = wb.addWorksheet(safeSheetName(def.name, used));
    const body = def.rows.map((r) => (Array.isArray(r) ? r : [r]).map(excelCell));
    if (def.header) {
      ws.addRow(def.header);
      ws.getRow(1).font = { bold: true };
    }
    if (body.length > 0) ws.addRows(body);
    if (def.widths) ws.columns = def.widths.map((width) => ({ width }));
    const totalRows = body.length + (def.header ? 1 : 0);
    if (def.freezeHeader !== false && totalRows > 0) {
      ws.views = [{ state: "frozen", ySplit: 1 }];
    }
    const colCount = Math.max(def.header?.length ?? 0, def.widths?.length ?? 0, ...body.map((r) => r.length), 1);
    if (def.filter !== false && totalRows > 0) {
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: totalRows, column: colCount } };
    }
  }
  return wb;
}

export async function downloadExcelWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: XLSX_MIME }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
