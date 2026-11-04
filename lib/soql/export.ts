/**
 * Query result export - the SOQL/SOSL grid as a workbook: a run cover
 * (query text, timing, truncation) plus the full result table. Values
 * arrive pre-flattened as strings, matching the CSV export exactly.
 */

import type ExcelJS from "exceljs";
import { buildExcelWorkbook, downloadExcelWorkbook, type ExcelSheetDef } from "@/lib/excel/workbook";

export interface QueryResultExport {
  columns: string[];
  rows: string[][];
  totalSize: number;
  truncated: boolean;
  timeMs: number;
  query: string;
  mode: "soql" | "sosl";
}

export function buildQueryResultSheets(r: QueryResultExport): ExcelSheetDef[] {
  return [
    {
      name: "Run",
      rows: [
        ["Query Export", ""],
        ["Mode", r.mode.toUpperCase()],
        ["Query", r.query],
        ["Rows", r.rows.length],
        ["Total size", r.totalSize],
        ["Truncated", r.truncated ? "yes - add LIMIT to page deliberately" : "no"],
        ["Time", `${r.timeMs}ms`],
        ["Exported", new Date().toISOString()],
      ],
      widths: [16, 120],
    },
    {
      name: "Results",
      header: r.columns,
      rows: r.rows,
      widths: r.columns.map(() => 24),
    },
  ];
}

export async function buildQueryResultWorkbook(r: QueryResultExport): Promise<ExcelJS.Workbook> {
  return buildExcelWorkbook(buildQueryResultSheets(r));
}

export async function downloadQueryResult(r: QueryResultExport, filename: string): Promise<void> {
  await downloadExcelWorkbook(await buildQueryResultWorkbook(r), filename);
}
