/**
 * Experience Mapping - architecture deliverables.
 * Word pack (docx), Excel workbook (exceljs), CSV exports and TSV clipboard.
 * Every artifact carries stable IDs and labels proposed vs confirmed.
 */

import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import type ExcelJS from "exceljs";
import { buildExcelWorkbook, downloadExcelWorkbook, type ExcelSheetDef } from "@/lib/excel/workbook";
import { analyzeCoverage } from "./coverage";
import type { WorkspaceScope } from "../studio/types";

/** Document scope: satisfied by a workspace root or a standalone mapping. */
export interface DocScope extends WorkspaceScope {
  name: string;
  status: string;
  description?: string;
  sourceSystem?: string;
  sourceApi?: string;
  targetSystem?: string;
}

/** Cross-child integration data for workspace-level documents. */
export interface DocCross {
  mappings: { id: string; sourcePath: string; objectName: string; fieldName: string }[];
  plans: { id: string; name: string; sourcePath?: string; objectName: string }[];
}

const LIMIT =
  "Design-time architecture record - agreed correspondence and constraints, not proof of runtime behavior. Salesforce validation rules, flows, triggers, permissions and data state may impose additional requirements.";

function cell(text: string, bold = false): TableCell {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold, size: 18 })] })] });
}

function kvTable(rows: [string, string][]): Table {
  return new Table({
    width: { size: 100, type: "pct" },
    rows: rows.map(([k, v]) => new TableRow({ children: [cell(k, true), cell(v)] })),
  });
}

function matrixTable(header: string[], rows: string[][]): Table {
  return new Table({
    width: { size: 100, type: "pct" },
    rows: [
      new TableRow({ children: header.map((h) => cell(h, true)) }),
      ...rows.map((r) => new TableRow({ children: r.map((c) => cell(c)) })),
    ],
  });
}

export async function buildWordPack(
  scope: DocScope,
  loadBlob: (storageKey: string) => Promise<Blob | null>
): Promise<Blob> {
  const exp = scope.experience;
  const ops = new Map((scope.apiCatalog?.operations ?? []).map((o) => [o.id, o]));
  const children: (Paragraph | Table)[] = [];
  const h = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1) =>
    children.push(new Paragraph({ text, heading: level }));
  const p = (text: string) => children.push(new Paragraph({ children: [new TextRun({ text, size: 20 })] }));

  // Cover + overview.
  children.push(new Paragraph({ text: scope.name, heading: HeadingLevel.TITLE }));
  p(`Architecture pack · exported ${new Date().toISOString().slice(0, 10)} · GRAVENX Experience Mapping`);
  h("Project overview", HeadingLevel.HEADING_1);
  children.push(kvTable([
    ["Description", scope.description ?? "—"],
    ["Source", `${scope.sourceSystem ?? "—"} / ${scope.sourceApi ?? "—"}`],
    ["Target", scope.targetSystem ?? "—"],
    ["Status", scope.status],
  ]));
  h("Scope and limitations", HeadingLevel.HEADING_1);
  p(LIMIT);

  // Journeys.
  h("User journeys", HeadingLevel.HEADING_1);
  if (!exp || exp.journeys.length === 0) p("No journeys recorded.");
  for (const j of exp?.journeys ?? []) {
    h(j.name, HeadingLevel.HEADING_2);
    if (j.actor || j.goal) p(`Actor: ${j.actor ?? "—"} · Goal: ${j.goal ?? "—"}`);
    const steps = j.screenIds.map((sid, i) => {
      const s = exp?.screens.find((x) => x.id === sid);
      return `${i + 1}. ${s?.name ?? "(missing screen)"}`;
    });
    p(steps.length > 0 ? steps.join("\n") : "No steps.");
  }

  // Screen-by-screen.
  h("Screen inventory", HeadingLevel.HEADING_1);
  for (const s of exp?.screens ?? []) {
    h(s.name, HeadingLevel.HEADING_2);
    children.push(kvTable([
      ["Screen id", s.id],
      ["Route", s.route ?? "—"],
      ["Role", s.userRole ?? "—"],
      ["Feature", s.feature ?? "—"],
      ["Status", s.status],
    ]));
    const asset = exp?.assets.find((a) => a.screenId === s.id);
    if (asset) {
      const blob = await loadBlob(asset.storageKey);
      if (blob) {
        const buf = new Uint8Array(await blob.arrayBuffer());
        const maxW = 600;
        const scale = Math.min(1, maxW / asset.width);
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: buf,
                transformation: { width: Math.round(asset.width * scale), height: Math.round(asset.height * scale) },
                type: asset.mimeType === "image/webp" ? "png" : "png",
              }),
            ],
          })
        );
      }
    }
    const comps = (exp?.components ?? []).filter((c) => c.screenId === s.id);
    if (comps.length > 0) {
      children.push(
        matrixTable(
          ["Component", "Type", "Purpose", "Status"],
          comps.map((c) => [c.name, c.componentType, c.purpose ?? "—", c.status])
        )
      );
      for (const c of comps) {
        const reqs = (exp?.requirements ?? []).filter((r) => r.componentId === c.id);
        const binds = (exp?.bindings ?? []).filter((b) => b.componentId === c.id);
        if (reqs.length > 0) {
          children.push(
            matrixTable(
              [`Requirements · ${c.name}`, "Path", "Direction", "Status"],
              reqs.map((r) => [r.name, r.propertyPath ?? "(no path)", r.direction, r.status])
            )
          );
        }
        if (binds.length > 0) {
          children.push(
            matrixTable(
              [`APIs · ${c.name}`, "Usage", "Trigger", "Status"],
              binds.map((b) => {
                const op = ops.get(b.operationId);
                return [op ? `${op.method} ${op.path}` : b.operationId, b.usage, b.trigger, b.status];
              })
            )
          );
        }
      }
    }
    const states = (exp?.states ?? []).filter((st) => st.screenId === s.id);
    if (states.length > 0) {
      children.push(matrixTable(["UI state", "Behavior", "Status"], states.map((st) => [st.kind, st.expectedBehavior ?? "—", st.status])));
    }
  }

  // API catalog + matrix.
  h("API catalog", HeadingLevel.HEADING_1);
  const allOps = scope.apiCatalog?.operations ?? [];
  children.push(
    matrixTable(
      ["Operation", "Method", "Path", "Layer", "Owner", "Lifecycle", "Status"],
      allOps.map((o) => [o.name, o.method, o.path, o.layer, o.owner ?? "—", o.lifecycle, o.status])
    )
  );
  const matrix: string[][] = [];
  for (const b of exp?.bindings ?? []) {
    const scr = exp?.screens.find((s) => s.id === b.screenId)?.name ?? b.screenId;
    const comp = b.componentId ? (exp?.components.find((c) => c.id === b.componentId)?.name ?? b.componentId) : "—";
    const op = ops.get(b.operationId);
    matrix.push([scr, comp, op?.name ?? b.operationId, op?.method ?? "—", op?.path ?? "—", op?.layer ?? "—", op?.owner ?? "—", op ? (op.requestContractId || op.responseContractId ? "attached" : "missing") : "—", b.status]);
  }
  h("Screen / component / API matrix", HeadingLevel.HEADING_2);
  children.push(matrixTable(["Screen", "Component", "Operation", "Method", "Path", "Layer", "Owner", "Contract", "Status"], matrix));

  // Dependencies + integration refs.
  h("Backend ownership", HeadingLevel.HEADING_1);
  const deps = scope.apiCatalog?.dependencies ?? [];
  if (deps.length === 0) p("No backend dependencies recorded.");
  else {
    children.push(
      matrixTable(
        ["Operation", "Dependency", "Kind", "Reference", "Status"],
        deps.map((d) => [
          ops.get(d.operationId)?.name ?? d.operationId,
          d.label,
          d.kind,
          [d.reference?.objectApiName, d.reference?.fieldApiName].filter(Boolean).join(".") || d.reference?.artifactId || "—",
          d.status,
        ])
      )
    );
  }

  // Decisions + questions + coverage + history.
  h("Open questions", HeadingLevel.HEADING_1);
  const open = (scope.assumptions ?? []).filter((a) => a.status === "open");
  p(open.length === 0 ? "None open." : open.map((a) => `• ${a.question}${a.owner ? ` (owner: ${a.owner})` : ""}`).join("\n"));
  h("Architecture decisions", HeadingLevel.HEADING_1);
  const decs = scope.archDecisions ?? [];
  if (decs.length === 0) p("None recorded.");
  else {
    children.push(matrixTable(["Decision", "Status", "Outcome"], decs.map((d) => [d.title, d.status, d.decision ?? "—"])));
  }
  h("Coverage and gaps", HeadingLevel.HEADING_1);
  const { counts, findings } = analyzeCoverage(scope);
  children.push(kvTable([
    ["Screens", `${counts.screensWithImages}/${counts.screens} with images`],
    ["Components bound", `${counts.componentsWithBindings}/${counts.components}`],
    ["Operations with contracts", `${counts.operationsWithContracts}/${counts.operations}`],
    ["Orphan operations", String(counts.orphanOperations)],
    ["Broken references", String(counts.brokenReferences)],
  ]));
  for (const f of findings.slice(0, 100)) {
    p(`[${f.severity}] ${f.message} → ${f.action}`);
  }
  h("Change history", HeadingLevel.HEADING_1);
  for (const c of (scope.changeLog ?? []).slice(-60)) {
    p(`${c.timestamp.slice(0, 16).replace("T", " ")} · ${c.entityType}/${c.changeType} · ${c.summary}`);
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({ text: "GRAVENX · Experience Mapping", alignment: AlignmentType.RIGHT }),
          ...children,
          new Paragraph({ text: LIMIT }),
        ],
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  return new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}

// ---------- Excel ----------

export async function buildExperienceWorkbook(scope: DocScope, cross?: DocCross): Promise<ExcelJS.Workbook> {
  const sheets: ExcelSheetDef[] = [];
  const exp = scope.experience;
  const ops = new Map((scope.apiCatalog?.operations ?? []).map((o) => [o.id, o]));
  const { counts } = analyzeCoverage(scope);

  const add = (name: string, rows: unknown[][]) => {
    sheets.push({ name, rows: rows.length > 0 ? rows : [["(empty)"]] });
  };

  add("Summary", [
    ["Project", scope.name],
    ["Source", `${scope.sourceSystem ?? ""} / ${scope.sourceApi ?? ""}`],
    ["Status", scope.status],
    ["Exported", new Date().toISOString()],
    ["Screens", counts.screens],
    ["Components", counts.components],
    ["Operations", counts.operations],
    ["Broken references", counts.brokenReferences],
    ["Limitations", LIMIT],
  ]);
  add("Screens", [
    ["Id", "Name", "Route", "Feature", "Role", "Device", "Status", "Image px"],
    ...(exp?.screens ?? []).map((s) => [s.id, s.name, s.route ?? "", s.feature ?? "", s.userRole ?? "", s.deviceContext ?? "", s.status, s.assetId ? `${s.canvas.sourceWidth}x${s.canvas.sourceHeight}` : ""]),
  ]);
  add("Journeys", [
    ["Journey", "Status", "Step", "Screen"],
    ...(exp?.journeys ?? []).flatMap((j) =>
      j.screenIds.length === 0
        ? [[j.name, j.status, "", ""]]
        : j.screenIds.map((sid, i) => [j.name, j.status, i + 1, exp?.screens.find((s) => s.id === sid)?.name ?? "(missing)"])
    ),
  ]);
  add("Components", [
    ["Id", "Screen", "Name", "Type", "Purpose", "Status"],
    ...(exp?.components ?? []).map((c) => [c.id, exp?.screens.find((s) => s.id === c.screenId)?.name ?? c.screenId, c.name, c.componentType, c.purpose ?? "", c.status]),
  ]);
  add("API Bindings", [
    ["Id", "Screen", "Component", "Operation", "Method", "Path", "Usage", "Trigger", "Status"],
    ...(exp?.bindings ?? []).map((b) => {
      const op = ops.get(b.operationId);
      return [b.id, exp?.screens.find((s) => s.id === b.screenId)?.name ?? b.screenId, b.componentId ? (exp?.components.find((c) => c.id === b.componentId)?.name ?? b.componentId) : "", op?.name ?? b.operationId, op?.method ?? "", op?.path ?? "", b.usage, b.trigger, b.status];
    }),
  ]);
  add("API Catalog", [
    ["Id", "Name", "Method", "Path", "Layer", "Owner", "Lifecycle", "Request contract", "Response contract", "Status"],
    ...(scope.apiCatalog?.operations ?? []).map((o) => [o.id, o.name, o.method, o.path, o.layer, o.owner ?? "", o.lifecycle, o.requestContractId ?? "", o.responseContractId ?? "", o.status]),
  ]);
  add("Data Requirements", [
    ["Id", "Screen", "Component", "Label", "Path", "Direction", "Required", "Status"],
    ...(exp?.requirements ?? []).map((r) => [r.id, exp?.screens.find((s) => s.id === r.screenId)?.name ?? r.screenId, r.componentId ? (exp?.components.find((c) => c.id === r.componentId)?.name ?? "") : "", r.name, r.propertyPath ?? "", r.direction, r.required ? "yes" : "no", r.status]),
  ]);
  add("Backend Dependencies", [
    ["Operation", "Label", "Kind", "Reference", "Status", "Notes"],
    ...(scope.apiCatalog?.dependencies ?? []).map((d) => [ops.get(d.operationId)?.name ?? d.operationId, d.label, d.kind, [d.reference?.objectApiName, d.reference?.fieldApiName].filter(Boolean).join(".") || d.reference?.artifactId || "", d.status, d.notes ?? ""]),
  ]);
  add("Integration References", [
    ["Operation", "Label", "Source path", "Target", "Kind"],
    ...(scope.apiCatalog?.dependencies ?? [])
      .filter((d) => d.kind === "integration-mapping")
      .map((d) => {
        const row = cross?.mappings.find((m) => m.id === d.reference?.artifactId);
        const plan = cross?.plans.find((r) => r.id === d.reference?.artifactId);
        return [ops.get(d.operationId)?.name ?? d.operationId, d.label, row?.sourcePath ?? plan?.sourcePath ?? "", row ? `${row.objectName}.${row.fieldName}` : (plan ? plan.objectName : ""), row ? "field-mapping" : "record-plan"];
      }),
  ]);
  add("Decisions", [
    ["Title", "Status", "Outcome", "Decided"],
    ...(scope.archDecisions ?? []).map((d) => [d.title, d.status, d.decision ?? "", d.decidedAt ?? ""]),
  ]);
  add("Assumptions", [
    ["Question", "Owner", "Status", "Resolution"],
    ...(scope.assumptions ?? []).map((a) => [a.question, a.owner ?? "", a.status, a.resolution ?? ""]),
  ]);
  const { findings } = analyzeCoverage(scope);
  add("Coverage Findings", [
    ["Severity", "Type", "Message", "Action"],
    ...findings.map((f) => [f.severity, f.type, f.message, f.action]),
  ]);
  add("Change Log", [
    ["Timestamp", "Entity", "Change", "Summary", "Origin"],
    ...(scope.changeLog ?? []).map((c) => [c.timestamp, `${c.entityType}:${c.entityId}`, c.changeType, c.summary, c.origin]),
  ]);
  return buildExcelWorkbook(sheets);
}

export async function downloadExperienceWorkbook(scope: DocScope, cross?: DocCross): Promise<void> {
  const safe = scope.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
  await downloadExcelWorkbook(await buildExperienceWorkbook(scope, cross), `${safe}-experience.xlsx`);
}

// ---------- CSV / TSV ----------

function csvEscape(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: string[][]): string {
  return [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
}

export function apiCatalogCsv(scope: DocScope): string {
  const ops = scope.apiCatalog?.operations ?? [];
  return toCsv(
    ["Id", "Name", "Method", "Path", "Layer", "Owner", "Lifecycle", "Status"],
    ops.map((o) => [o.id, o.name, o.method, o.path, o.layer, o.owner ?? "", o.lifecycle, o.status])
  );
}

export function screenApiMatrixCsv(scope: DocScope): string {
  const exp = scope.experience;
  const ops = new Map((scope.apiCatalog?.operations ?? []).map((o) => [o.id, o]));
  return toCsv(
    ["Screen", "Component", "Action", "Method", "Path", "Layer", "Owner", "Contract", "Status"],
    (exp?.bindings ?? []).map((b) => {
      const op = ops.get(b.operationId);
      return [
        exp?.screens.find((s) => s.id === b.screenId)?.name ?? b.screenId,
        b.componentId ? (exp?.components.find((c) => c.id === b.componentId)?.name ?? b.componentId) : "",
        b.actionId ? (exp?.actions.find((a) => a.id === b.actionId)?.name ?? b.actionId) : "",
        op?.method ?? "", op?.path ?? "", op?.layer ?? "", op?.owner ?? "",
        op ? (op.requestContractId || op.responseContractId ? "attached" : "missing") : "",
        b.status,
      ];
    })
  );
}

export function screenApiMatrixTsv(scope: DocScope): { text: string; count: number } {
  const exp = scope.experience;
  const ops = new Map((scope.apiCatalog?.operations ?? []).map((o) => [o.id, o]));
  const header = ["Screen", "Component", "Action", "Method", "Path", "Layer", "Owner", "Contract", "Status"];
  const flat = (v: string) => v.replace(/\t/g, " ").replace(/\r?\n/g, " ");
  const lines = [header.join("\t")];
  for (const b of exp?.bindings ?? []) {
    const op = ops.get(b.operationId);
    lines.push(
      [
        exp?.screens.find((s) => s.id === b.screenId)?.name ?? b.screenId,
        b.componentId ? (exp?.components.find((c) => c.id === b.componentId)?.name ?? b.componentId) : "",
        b.actionId ? (exp?.actions.find((a) => a.id === b.actionId)?.name ?? b.actionId) : "",
        op?.method ?? "", op?.path ?? "", op?.layer ?? "", op?.owner ?? "",
        op ? (op.requestContractId || op.responseContractId ? "attached" : "missing") : "",
        b.status,
      ]
        .map(flat)
        .join("\t")
    );
  }
  return { text: lines.join("\n"), count: exp?.bindings.length ?? 0 };
}

export function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
