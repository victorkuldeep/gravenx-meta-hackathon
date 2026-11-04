/**
 * Impact analysis export - "what breaks if this changes" as a workbook:
 * the target cover, every referencing record grouped by surface with
 * the citing edge, and dangling references hiding behind renames.
 */

import type ExcelJS from "exceljs";
import { buildExcelWorkbook, downloadExcelWorkbook, type ExcelSheetDef } from "@/lib/excel/workbook";
import type { ImpactSummary } from "./impact";

export function buildImpactSheets(summary: ImpactSummary): ExcelSheetDef[] {
  const t = summary.target;
  return [
    {
      name: "Summary",
      rows: [
        ["Impact Analysis", ""],
        ["Target", t ? t.name : "(record gone)"],
        ["Surface", t ? t.surface : ""],
        ["Key", t ? t.key : ""],
        ["Exported", new Date().toISOString()],
        ["Total references", summary.total],
        ["Surfaces touched", summary.groups.length],
        ["Dangling references", summary.dangling.length],
      ],
      widths: [22, 100],
    },
    {
      name: "References",
      header: ["Surface", "Record", "Via Edge", "Resolution"],
      rows: summary.groups.flatMap((g) =>
        g.hits.map((h) => [g.label, h.node.name, h.via.kind, h.via.resolution]),
      ),
      widths: [16, 60, 20, 16],
    },
    {
      name: "Dangling",
      header: ["Reference", "From Surface", "Raw"],
      rows: summary.dangling.map((u) => [u.name ?? u.raw, u.surface, u.raw]),
      widths: [60, 16, 60],
    },
  ];
}

export async function buildImpactWorkbook(summary: ImpactSummary): Promise<ExcelJS.Workbook> {
  return buildExcelWorkbook(buildImpactSheets(summary));
}

export async function downloadImpactAnalysis(summary: ImpactSummary, filename: string): Promise<void> {
  await downloadExcelWorkbook(await buildImpactWorkbook(summary), filename);
}
