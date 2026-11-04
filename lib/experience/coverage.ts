/**
 * Experience Mapping - deterministic coverage + gap analysis (pure).
 * Descriptive counts and stable findings. No scores, no LLM.
 */

import { checkDependencies } from "./bridge";
import { validateBindings } from "./apiCatalog";
import type { WorkspaceScope } from "../studio/types";
import type { ExperienceModule } from "./types";

export type FindingSeverity = "info" | "warning" | "blocking";

export interface CoverageFinding {
  key: string;
  severity: FindingSeverity;
  type: string;
  entityId: string;
  message: string;
  action: string;
}

export interface CoverageCounts {
  screens: number;
  screensWithImages: number;
  screensWithComponents: number;
  components: number;
  componentsWithBindings: number;
  componentsWithRequirements: number;
  operations: number;
  operationsWithContracts: number;
  orphanOperations: number;
  requirementsWithoutPath: number;
  brokenReferences: number;
  openDecisions: number;
  openQuestions: number;
}

export function analyzeCoverage(project: WorkspaceScope): { counts: CoverageCounts; findings: CoverageFinding[] } {
  const exp = project.experience;
  const ops = project.apiCatalog?.operations ?? [];
  const bindings = exp?.bindings ?? [];
  const findings: CoverageFinding[] = [];

  const screens = exp?.screens ?? [];
  const withImages = screens.filter((s) => s.assetId).length;
  const withComps = screens.filter((s) => (exp?.components ?? []).some((c) => c.screenId === s.id)).length;

  for (const s of screens) {
    // A live wireframe ref is a design source - don't cry wolf about the screenshot.
    if (!s.assetId && !s.wireframeRef) findings.push({ key: `screen-no-image:${s.id}`, severity: "warning", type: "screen-no-image", entityId: s.id, message: `Screen "${s.name}" has no screenshot.`, action: "Upload or paste a screenshot." });
    if (!(exp?.components ?? []).some((c) => c.screenId === s.id) && !s.wireframeRef) findings.push({ key: `screen-no-components:${s.id}`, severity: "info", type: "screen-no-components", entityId: s.id, message: `Screen "${s.name}" has no components yet.`, action: "Annotate regions on the canvas." });
  }

  for (const c of exp?.components ?? []) {
    if (!c.purpose) findings.push({ key: `comp-no-purpose:${c.id}`, severity: "info", type: "component-no-purpose", entityId: c.id, message: `Component "${c.name}" has no recorded purpose.`, action: "Capture what this region is for." });
    const compBindings = bindings.filter((b) => b.componentId === c.id);
    if (compBindings.length === 0) findings.push({ key: `comp-no-binding:${c.id}`, severity: "warning", type: "component-no-binding", entityId: c.id, message: `Component "${c.name}" has no API binding.`, action: "Bind what powers this component." });
    const compReqs = (exp?.requirements ?? []).filter((r) => r.componentId === c.id);
    if (compReqs.length === 0) findings.push({ key: `comp-no-req:${c.id}`, severity: "info", type: "component-no-requirements", entityId: c.id, message: `Component "${c.name}" has no data requirements.`, action: "Propose what it displays or submits." });
  }

  const usedOps = new Set(bindings.map((b) => b.operationId));
  for (const o of ops) {
    if (!o.owner) findings.push({ key: `op-no-owner:${o.id}`, severity: "warning", type: "operation-no-owner", entityId: o.id, message: `Operation ${o.method} ${o.path} has no owner.`, action: "Assign BFF / Salesforce / middleware ownership." });
    if (!o.requestContractId && !o.responseContractId) findings.push({ key: `op-no-contract:${o.id}`, severity: "warning", type: "operation-no-contract", entityId: o.id, message: `Operation ${o.method} ${o.path} has no contracts attached.`, action: "Reference request/response contracts." });
    if (!usedOps.has(o.id)) findings.push({ key: `op-orphan:${o.id}`, severity: "info", type: "operation-unused", entityId: o.id, message: `Operation ${o.method} ${o.path} has no screen consumers.`, action: "Bind it or confirm it is out of scope." });
    if (o.lifecycle === "proposed" || o.status === "proposed") findings.push({ key: `op-proposed:${o.id}`, severity: "info", type: "operation-unreviewed", entityId: o.id, message: `Operation ${o.method} ${o.path} is still proposed.`, action: "Review and confirm the design." });
  }

  for (const r of exp?.requirements ?? []) {
    if (r.direction !== "local-only" && !r.propertyPath) findings.push({ key: `req-no-path:${r.id}`, severity: "warning", type: "requirement-no-path", entityId: r.id, message: `Requirement "${r.name}" has no property path.`, action: "Record the proposed contract property." });
  }

  for (const t of exp?.transitions ?? []) {
    const fromOk = screens.some((s) => s.id === t.fromScreenId);
    const toOk = screens.some((s) => s.id === t.toScreenId);
    if (!fromOk || !toOk) findings.push({ key: `transition-missing:${t.id}`, severity: "blocking", type: "transition-missing-screen", entityId: t.id, message: `Transition references a missing screen.`, action: "Repair the journey step." });
  }

  for (const b of validateBindings(exp ?? blankExp(), ops)) {
    findings.push({ key: `binding:${b.bindingId}:${b.message.slice(0, 24)}`, severity: "blocking", type: "binding-broken", entityId: b.bindingId, message: b.message, action: "Repair or remove the binding." });
  }
  for (const d of checkDependencies(project)) {
    findings.push({ key: `dep:${d.dependencyId}`, severity: "blocking", type: "dependency-broken", entityId: d.dependencyId, message: d.message, action: "Repair the reference explicitly." });
  }

  const counts: CoverageCounts = {
    screens: screens.length,
    screensWithImages: withImages,
    screensWithComponents: withComps,
    components: exp?.components.length ?? 0,
    componentsWithBindings: new Set(bindings.filter((b) => b.componentId).map((b) => b.componentId as string)).size,
    componentsWithRequirements: new Set((exp?.requirements ?? []).filter((r) => r.componentId).map((r) => r.componentId as string)).size,
    operations: ops.length,
    operationsWithContracts: ops.filter((o) => o.requestContractId || o.responseContractId).length,
    orphanOperations: ops.filter((o) => !usedOps.has(o.id)).length,
    requirementsWithoutPath: (exp?.requirements ?? []).filter((r) => r.direction !== "local-only" && !r.propertyPath).length,
    brokenReferences: findings.filter((f) => f.severity === "blocking").length,
    openDecisions: (project.archDecisions ?? []).filter((d) => d.status === "open" || d.status === "proposed").length,
    openQuestions: (project.assumptions ?? []).filter((a) => a.status === "open").length,
  };
  return { counts, findings };
}

function blankExp(): ExperienceModule {
  return { id: "x", version: 1, screens: [], assets: [], components: [], annotations: [], actions: [], journeys: [], transitions: [], bindings: [], requirements: [], states: [], createdAt: "", updatedAt: "" };
}
