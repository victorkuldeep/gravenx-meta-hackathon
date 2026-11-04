/**
 * Governance pack - the review-board workbook: the ADR log plus
 * fill-in NFR and deployment checklists. Decision bodies may be rich
 * text, so everything is flattened to plain text on the way out.
 */

import type ExcelJS from "exceljs";
import { buildExcelWorkbook, downloadExcelWorkbook, type ExcelSheetDef } from "@/lib/excel/workbook";
import type { Decision } from "./model";
import { htmlToText } from "./richtext";

/** Fill-in NFR checklist shared by the governance pack and risk register. */
export function nfrChecklistSheet(): ExcelSheetDef {
  return {
    name: "NFR Checklist",
    header: ["Quality Attribute", "Target / SLO", "Owner", "Status", "Evidence / Notes"],
    rows: [
      ["Availability", "", "", "", ""],
      ["Latency (p95)", "", "", "", ""],
      ["Throughput", "", "", "", ""],
      ["Error budget", "", "", "", ""],
      ["Timeout policy", "", "", "", ""],
      ["Retry policy", "", "", "", ""],
      ["Idempotency", "", "", "", ""],
      ["RPO", "", "", "", ""],
      ["RTO", "", "", "", ""],
      ["Data retention", "", "", "", ""],
      ["Audit logging", "", "", "", ""],
      ["Compliance notes", "", "", "", ""],
    ],
    widths: [24, 30, 18, 14, 60],
  };
}

export function deploymentChecklistSheet(): ExcelSheetDef {
  return {
    name: "Deployment Checklist",
    header: ["Step", "Owner", "Done?", "Notes"],
    rows: [
      ["Metadata / config backup captured", "", "", ""],
      ["Package validated in a full-copy sandbox", "", "", ""],
      ["Production deploy window agreed", "", "", ""],
      ["Smoke tests defined and assigned", "", "", ""],
      ["Rollback plan written and reviewed", "", "", ""],
      ["Stakeholder sign-off recorded", "", "", ""],
      ["Monitoring watch scheduled post-deploy", "", "", ""],
      ["Runbook / handover updated", "", "", ""],
    ],
    widths: [44, 18, 10, 60],
  };
}

export function buildGovernanceSheets(decisions: Decision[]): ExcelSheetDef[] {
  return [
    {
      name: "ADR Log",
      header: [
        "ADR", "Title", "Status", "Context", "Decision", "Alternatives",
        "Consequences", "Linked Artifacts", "Superseded By", "Updated",
      ],
      rows: decisions.map((d) => [
        d.number,
        d.title,
        d.status,
        htmlToText(d.context),
        htmlToText(d.decision),
        d.alternatives.map((a) => (a.note ? `${a.title} — ${a.note}` : a.title)).join("; "),
        htmlToText(d.consequences),
        d.links.map((l) => `${l.surface}: ${l.label}`).join("; "),
        d.supersededBy ?? "",
        new Date(d.updatedAt).toISOString(),
      ]),
      widths: [12, 40, 14, 60, 60, 50, 50, 40, 14, 14],
    },
    nfrChecklistSheet(),
    deploymentChecklistSheet(),
  ];
}

export async function buildGovernanceWorkbook(decisions: Decision[]): Promise<ExcelJS.Workbook> {
  return buildExcelWorkbook(buildGovernanceSheets(decisions));
}

export async function downloadGovernancePack(decisions: Decision[], filename: string): Promise<void> {
  await downloadExcelWorkbook(await buildGovernanceWorkbook(decisions), filename);
}
