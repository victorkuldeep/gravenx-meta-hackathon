/**
 * Leadership coverage workbook: summary rollup plus the pivoted detail table
 * (every class/trigger with covered/uncovered lines, % and bucket) - built
 * for forwarding, not for the screen.
 */
import { buildExcelWorkbook, downloadExcelWorkbook, type ExcelSheetDef } from "@/lib/excel/workbook";
import { BUCKET_LABEL, type CoverageReport } from "./coverage";

export function buildCoverageSheets(rep: CoverageReport, orgLabel: string): ExcelSheetDef[] {
  const pct = rep.orgPct === null ? "n/a" : `${rep.orgPct.toFixed(1)}%`;
  const summary: ExcelSheetDef = {
    name: "Summary",
    rows: [
      ["Org", orgLabel],
      ["Org coverage", pct],
      ["Covered lines", rep.orgCovered],
      ["Uncovered lines", rep.orgUncovered],
      ["Classes + triggers", rep.rows.length],
      ["Below 75", rep.counts["risk"]],
      ["75-85", rep.counts["watch"]],
      ["Above 85", rep.counts["healthy"]],
      ["No executable lines", rep.counts["no-lines"]],
    ],
    widths: [24, 40],
  };
  const detail: ExcelSheetDef = {
    name: "Coverage",
    header: ["Name", "Type", "Object", "Covered", "Uncovered", "Total", "%", "Bucket"],
    rows: rep.rows.map((r) => [
      r.name,
      r.kind,
      r.objectName,
      r.covered,
      r.uncovered,
      r.total,
      r.pct === null ? "n/a" : Number(r.pct.toFixed(1)),
      BUCKET_LABEL[r.bucket],
    ]),
    widths: [44, 10, 22, 10, 12, 10, 8, 22],
  };
  return [summary, detail];
}

export async function downloadCoverageReport(rep: CoverageReport, orgLabel: string): Promise<void> {
  const safe = orgLabel.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "org";
  await downloadExcelWorkbook(await buildExcelWorkbook(buildCoverageSheets(rep, orgLabel)), `${safe}-apex-coverage.xlsx`);
}
