/**
 * Picklist x Record Type matrix - one object: every picklist field value
 * down the rows, every record type across the columns, checkmarks where
 * the value is available. Master always shows everything (platform rule).
 * Availability comes from the UI API, fetched live by the caller.
 */

import type ExcelJS from "exceljs";
import { buildExcelWorkbook, downloadExcelWorkbook, type ExcelSheetDef } from "@/lib/excel/workbook";

export interface MatrixField {
  label: string;
  apiName: string;
  values: { label: string; value: string }[];
}

export interface MatrixRt {
  id: string;
  name: string;
  developerName: string;
  master: boolean;
  /** Lowercased field API -> available value API names (UI API per RT). */
  available: Map<string, string[]>;
}

export function buildPicklistMatrixSheets(
  objectLabel: string,
  fields: MatrixField[],
  rts: MatrixRt[],
): ExcelSheetDef[] {
  const header = ["Field Label", "Field API", "Label", "Value", ...rts.map((r) => r.name)];
  const rows: unknown[][] = [];
  for (const f of fields) {
    for (const v of f.values) {
      const want = v.value.toLowerCase();
      rows.push([
        f.label,
        f.apiName,
        v.label,
        v.value,
        ...rts.map((rt) => {
          if (rt.master) return "✓";
          const have = rt.available.get(f.apiName.toLowerCase()) ?? [];
          return have.some((a) => a.toLowerCase() === want) ? "✓" : "";
        }),
      ]);
    }
  }
  return [
    {
      name: `${objectLabel} Matrix`,
      header,
      rows,
      widths: [26, 26, 30, 30, ...rts.map(() => 18)],
    },
    {
      name: "Record Types",
      header: ["Name", "Developer Name", "Id", "Master"],
      rows: rts.map((r) => [r.name, r.developerName, r.id, r.master ? "yes" : "no"]),
      widths: [28, 28, 22, 10],
    },
  ];
}

export async function buildPicklistMatrixWorkbook(
  objectLabel: string,
  fields: MatrixField[],
  rts: MatrixRt[],
): Promise<ExcelJS.Workbook> {
  return buildExcelWorkbook(buildPicklistMatrixSheets(objectLabel, fields, rts));
}

export async function downloadPicklistMatrix(
  objectLabel: string,
  fields: MatrixField[],
  rts: MatrixRt[],
  filename: string,
): Promise<void> {
  await downloadExcelWorkbook(await buildPicklistMatrixWorkbook(objectLabel, fields, rts), filename);
}
