/**
 * Risk register - deterministic findings as a review sheet: severity,
 * rule, cited records, and live proof state. Shares the NFR checklist
 * template with the governance pack.
 */

import type ExcelJS from "exceljs";
import { buildExcelWorkbook, downloadExcelWorkbook, type ExcelSheetDef } from "@/lib/excel/workbook";
import { nfrChecklistSheet } from "@/lib/decisions/adrLog";
import { findingKey, type ProofState } from "./proof";
import type { RiskFinding } from "./rules";

const PROOF_LABEL: Record<ProofState, string> = {
  unproven: "unproven",
  covered: "covered",
  "proven-live": "proven live",
  "proven-mock": "proven mock",
  failed: "reproduced",
};

export function buildRiskRegisterSheets(
  projectName: string,
  findings: RiskFinding[],
  proofs: Map<string, ProofState> = new Map(),
): ExcelSheetDef[] {
  const bySeverity = (s: RiskFinding["severity"]) => findings.filter((f) => f.severity === s).length;
  return [
    {
      name: "Summary",
      rows: [
        ["Risk Register", ""],
        ["Project", projectName],
        ["Exported", new Date().toISOString()],
        ["Findings", findings.length],
        ["High / Medium / Low", `${bySeverity("high")} / ${bySeverity("medium")} / ${bySeverity("low")}`],
      ],
      widths: [24, 90],
    },
    {
      name: "Risk Register",
      header: ["Severity", "Rule", "Finding", "Records", "Proof"],
      rows: findings.map((f) => [
        f.severity,
        f.rule,
        f.message,
        f.refs.map((r) => `${r.name} (${r.surface})`).join("; "),
        PROOF_LABEL[proofs.get(findingKey(f)) ?? "unproven"],
      ]),
      widths: [12, 30, 90, 50, 14],
    },
    nfrChecklistSheet(),
  ];
}

export async function buildRiskRegisterWorkbook(
  projectName: string,
  findings: RiskFinding[],
  proofs: Map<string, ProofState> = new Map(),
): Promise<ExcelJS.Workbook> {
  return buildExcelWorkbook(buildRiskRegisterSheets(projectName, findings, proofs));
}

export async function downloadRiskRegister(
  projectName: string,
  findings: RiskFinding[],
  proofs: Map<string, ProofState>,
  filename: string,
): Promise<void> {
  await downloadExcelWorkbook(await buildRiskRegisterWorkbook(projectName, findings, proofs), filename);
}
