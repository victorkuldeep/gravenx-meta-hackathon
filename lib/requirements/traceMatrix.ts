/**
 * Requirements traceability matrix - the auditor's sheet: every REQ with
 * its lifecycle status, derived coverage, and per-surface links. Coverage
 * is computed by the caller from the graph index (same honesty rule as
 * the UI: links must resolve to live records to count).
 */

import type ExcelJS from "exceljs";
import { buildExcelWorkbook, downloadExcelWorkbook, type ExcelSheetDef } from "@/lib/excel/workbook";
import type { RequirementCoverage } from "./coverage";
import { REQUIREMENT_LINK_SURFACES, type Requirement } from "./model";

const SURFACE_LABEL: Record<string, string> = {
  system: "System",
  wireframe: "Wireframe",
  sequence: "Sequence",
  draw: "Draw+",
  schema: "Schema",
  decision: "Decision",
};

export function buildTraceabilitySheets(
  reqs: Requirement[],
  coverage: Map<string, RequirementCoverage>,
): ExcelSheetDef[] {
  const covered = reqs.filter((r) => coverage.get(r.id)?.covered).length;
  const rows = reqs.map((r) => {
    const c = coverage.get(r.id);
    const bySurface = (s: string) =>
      r.links.filter((l) => l.surface === s).map((l) => l.label).join("; ");
    return [
      r.number,
      r.title,
      r.status,
      c ? (c.covered ? "yes" : "no") : "unknown",
      c?.liveLinks ?? "",
      c?.danglingLinks ?? "",
      ...REQUIREMENT_LINK_SURFACES.map(bySurface),
    ];
  });
  return [
    {
      name: "Summary",
      rows: [
        ["Requirements Traceability", ""],
        ["Exported", new Date().toISOString()],
        ["Total requirements", reqs.length],
        ["Covered", covered],
        ["Without design", reqs.length - covered],
      ],
      widths: [24, 90],
    },
    {
      name: "Traceability",
      header: [
        "REQ", "Title", "Status", "Covered", "Live Links", "Dangling Links",
        ...REQUIREMENT_LINK_SURFACES.map((s) => SURFACE_LABEL[s]),
      ],
      rows,
      widths: [12, 44, 12, 10, 12, 14, 28, 28, 28, 28, 28, 28],
    },
  ];
}

export async function buildTraceabilityWorkbook(
  reqs: Requirement[],
  coverage: Map<string, RequirementCoverage>,
): Promise<ExcelJS.Workbook> {
  return buildExcelWorkbook(buildTraceabilitySheets(reqs, coverage));
}

export async function downloadTraceabilityMatrix(
  reqs: Requirement[],
  coverage: Map<string, RequirementCoverage>,
  filename: string,
): Promise<void> {
  await downloadExcelWorkbook(await buildTraceabilityWorkbook(reqs, coverage), filename);
}
