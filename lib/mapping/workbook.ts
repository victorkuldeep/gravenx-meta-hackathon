/**
 * Mapping Studio - Excel workbook, CSV and Copy-as-Excel handoff.
 * Design-time artifact: exact API names + canonical paths, frozen panes,
 * filters, no merged cells in data. States its own limitations.
 */

import type ExcelJS from "exceljs";
import { buildExcelWorkbook, downloadExcelWorkbook, type ExcelSheetDef } from "@/lib/excel/workbook";
import type { Diagnostic, MappingProject } from "./types";
import { analyzeRow } from "./diagnostics";

/** First row is the header; the rest is body. */
function tableSheet(name: string, rows: unknown[][], widths: number[]): ExcelSheetDef {
  const [head, ...body] = rows;
  return { name, header: (head ?? []).map((v) => String(v ?? "")), rows: body, widths };
}

const LIMIT_NOTE =
  "Design-time mapping artifact - represents agreed field correspondence and metadata constraints, not proof of runtime behavior. Salesforce validation rules, flows, triggers, permissions and data state may impose additional requirements.";

function fieldOf(project: MappingProject, objectName: string, fieldName: string) {
  return project.sfSnapshot?.objects.find((o) => o.name === objectName)?.fields.find((f) => f.name === fieldName);
}

function sourceOf(project: MappingProject, path: string) {
  return project.source?.paths.find((p) => p.id === path);
}

export interface HandoffCounts {
  mapped: number;
  unmapped: number;
  openDecisions: number;
  errors: number;
  warnings: number;
}

export function handoffCounts(project: MappingProject, findings: Diagnostic[]): HandoffCounts {
  const leaves = project.source?.paths.filter((p) => p.kind === "scalar" || p.kind === "null") ?? [];
  const mapped = new Set(project.mappings.filter((m) => m.kind !== "excluded").map((m) => m.sourcePath));
  return {
    mapped: project.mappings.filter((m) => m.kind !== "excluded").length,
    unmapped: leaves.filter((p) => !mapped.has(p.id)).length,
    openDecisions: project.decisions.filter((d) => d.status === "open").length,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
  };
}

function mappingSheet(project: MappingProject): unknown[][] {
  const header = [
    "Record Plan", "Target Object API Name", "Source JSON Path", "Source Type", "Example Value",
    "Target Field API Name", "Target Field Label", "Target Field Type", "Nillable", "Createable",
    "Updateable", "Length", "Precision", "Scale", "Mapping Kind", "Mapping Status",
    "Transformation / Enum Mapping", "Rationale", "Notes", "Metadata Snapshot Ref",
  ];
  const rows: unknown[][] = [header];
  for (const m of project.mappings) {
    const src = sourceOf(project, m.sourcePath);
    const field = m.fieldName ? fieldOf(project, m.objectName, m.fieldName) : undefined;
    const plan = m.planId ? project.recordPlans.find((p) => p.id === m.planId)?.name ?? "" : "";
    const enumText = (m.enumMap ?? []).map((e) => `${e.sourceValue}→${e.targetValue}${e.decided ? "" : " (open)"}`).join("; ");
    rows.push([
      plan, m.objectName, m.sourcePath, src?.jsonType ?? "", src?.example ?? "",
      m.fieldName, field?.label ?? "", field?.type ?? "",
      field ? String(field.nillable) : "", field ? String(field.createable) : "", field ? String(field.updateable) : "",
      field?.length ?? "", field?.precision ?? "", field?.scale ?? "",
      m.kind, analyzeRow(project, m).suggested,
      enumText || (m.kind === "hardcoded" ? `hardcoded: ${String(m.hardcodedValue ?? "")}` : ""),
      m.rationale ?? "", m.notes ?? "", project.sfSnapshot?.fingerprint ?? "",
    ]);
  }
  return rows;
}

export async function buildWorkbook(project: MappingProject, findings: Diagnostic[], exportedAt: string): Promise<ExcelJS.Workbook> {
  const counts = handoffCounts(project, findings);
  const sheets: ExcelSheetDef[] = [];

  const summary: unknown[][] = [
    ["Mapping Summary", ""],
    ["Project name", project.name],
    ["Source API / system", `${project.sourceApi ?? ""} / ${project.sourceSystem ?? ""}`],
    ["Target system", project.targetSystem],
    ["Project status", project.status],
    ["Project versions", project.versions.length],
    ["Export timestamp", exportedAt],
    ["Metadata snapshot", project.sfSnapshot ? `${project.sfSnapshot.capturedAt} · ${project.sfSnapshot.fingerprint}` : "none"],
    ["Record plans", project.recordPlans.length],
    ["Mapped rows", counts.mapped],
    ["Unmapped source leaves", counts.unmapped],
    ["Open decisions", counts.openDecisions],
    ["Review errors / warnings", `${counts.errors} / ${counts.warnings}`],
    ["Limitations", LIMIT_NOTE],
  ];
  sheets.push({ name: "Summary", rows: summary, widths: [28, 90] });

  sheets.push(tableSheet("Field Mappings", mappingSheet(project), [18, 22, 30, 12, 20, 22, 22, 14, 10, 10, 10, 8, 10, 8, 12, 14, 30, 30, 30, 20]));

  const plans: unknown[][] = [["Plan", "Target Object", "Intent", "Source Path", "Cardinality", "Parent Plan", "Match Key", "Mappings", "Notes"]];
  for (const p of project.recordPlans) {
    plans.push([
      p.name, p.objectName, p.intent, p.sourcePath, p.cardinality,
      p.parentPlanId ? (project.recordPlans.find((x) => x.id === p.parentPlanId)?.name ?? p.parentPlanId) : "",
      p.matchKey ?? "", project.mappings.filter((m) => m.planId === p.id).length, p.notes ?? "",
    ]);
  }
  sheets.push(tableSheet("Record Plans", plans, [20, 20, 10, 28, 12, 20, 18, 10, 30]));

  const rels: unknown[][] = [["Child Plan", "Parent Plan", "Relationship Field", "Strategy", "Confirmed", "Notes"]];
  for (const r of project.relationships) {
    rels.push([
      project.recordPlans.find((p) => p.id === r.childPlanId)?.name ?? r.childPlanId,
      project.recordPlans.find((p) => p.id === r.parentPlanId)?.name ?? r.parentPlanId,
      r.fieldName, r.strategy, r.confirmed ? "yes" : "no", r.notes ?? "",
    ]);
  }
  sheets.push(tableSheet("Relationships", rels, [20, 20, 24, 22, 10, 30]));

  const decs: unknown[][] = [["Question", "Status", "Owner", "Source Paths", "Target", "Decision", "Rationale", "Created", "Updated"]];
  for (const d of project.decisions) {
    decs.push([d.title, d.status, d.owner ?? "", d.sourcePaths.join("; "), [d.planId ?? "", d.fieldName ?? ""].filter(Boolean).join("."), d.decision ?? "", d.rationale ?? "", d.createdAt, d.updatedAt]);
  }
  sheets.push(tableSheet("Decisions", decs, [32, 10, 14, 30, 22, 30, 30, 22, 22]));

  const snap: unknown[][] = [["Object", "Field", "Label", "Type", "Length", "Precision", "Scale", "Nillable", "Createable", "Updateable", "External ID", "Reference To", "Picklist (value:active)"]];
  for (const o of project.sfSnapshot?.objects ?? []) {
    for (const f of o.fields) {
      snap.push([o.name, f.name, f.label, f.type, f.length, f.precision, f.scale, String(f.nillable), String(f.createable), String(f.updateable), String(f.externalId), f.referenceTo.join(","), f.picklistValues.map((p) => `${p.value}:${p.active ? 1 : 0}`).join("; ")]);
    }
  }
  sheets.push(tableSheet("Schema Snapshot", snap, [18, 24, 24, 14, 8, 10, 8, 10, 10, 10, 10, 20, 40]));

  const log: unknown[][] = [["Version", "Timestamp", "Summary", "Fingerprint"]];
  for (const v of project.versions) {
    log.push([v.label, v.createdAt, v.summary, v.fingerprint]);
  }
  sheets.push(tableSheet("Change Log", log, [30, 24, 60, 20]));

  return buildExcelWorkbook(sheets);
}

export async function downloadWorkbook(project: MappingProject, findings: Diagnostic[]): Promise<void> {
  const wb = await buildWorkbook(project, findings, new Date().toISOString());
  const safe = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mapping";
  await downloadExcelWorkbook(wb, `${safe}-handoff.xlsx`);
}

const CSV_COLS = ["Record Plan", "Target Object", "Source Path", "Source Type", "Example", "Target Field", "Field Label", "Field Type", "Kind", "Status", "Rationale", "Notes"];

function csvEscape(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function mappingsCsv(project: MappingProject): string {
  const lines = [CSV_COLS.map(csvEscape).join(",")];
  for (const m of project.mappings) {
    const src = sourceOf(project, m.sourcePath);
    const field = m.fieldName ? fieldOf(project, m.objectName, m.fieldName) : undefined;
    const plan = m.planId ? project.recordPlans.find((p) => p.id === m.planId)?.name ?? "" : "";
    lines.push(
      [plan, m.objectName, m.sourcePath, src?.jsonType ?? "", src?.example ?? "", m.fieldName, field?.label ?? "", field?.type ?? "", m.kind, analyzeRow(project, m).suggested, m.rationale ?? "", m.notes ?? ""]
        .map(csvEscape)
        .join(",")
    );
  }
  return lines.join("\n");
}

export function downloadCsv(project: MappingProject): void {
  const blob = new Blob([mappingsCsv(project)], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safe = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mapping";
  a.href = url;
  a.download = `${safe}-mappings.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Tab-separated copy of mapping rows - pastes straight into Excel. */
export function mappingsTsv(project: MappingProject): { text: string; count: number } {
  const lines = [CSV_COLS.join("\t")];
  for (const m of project.mappings) {
    const src = sourceOf(project, m.sourcePath);
    const field = m.fieldName ? fieldOf(project, m.objectName, m.fieldName) : undefined;
    const plan = m.planId ? project.recordPlans.find((p) => p.id === m.planId)?.name ?? "" : "";
    const cells = [plan, m.objectName, m.sourcePath, src?.jsonType ?? "", String(src?.example ?? ""), m.fieldName, field?.label ?? "", field?.type ?? "", m.kind, analyzeRow(project, m).suggested, m.rationale ?? "", m.notes ?? ""];
    lines.push(cells.map((c) => String(c).replace(/\t/g, " ").replace(/\n/g, " ")).join("\t"));
  }
  return { text: lines.join("\n"), count: project.mappings.length };
}
