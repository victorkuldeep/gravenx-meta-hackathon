/**
 * Experience Mapping - named architecture snapshots, comparison and
 * change-impact analysis. All deterministic, all keyed by stable IDs.
 * Snapshots reference image blobs by storage key; binaries stay in IDB
 * and are never duplicated per snapshot.
 */

import type { ApiCatalog, ArchitectureDecision, ArchitectureSnapshot, Assumption, ExperienceModule } from "./types";

export type { ArchitectureSnapshot };

export interface SnapshotScope {
  experience?: ExperienceModule | null;
  apiCatalog?: ApiCatalog | null;
  archDecisions?: ArchitectureDecision[];
  assumptions?: Assumption[];
}

export function takeSnapshot(scope: SnapshotScope, id: string, label: string, now: string): ArchitectureSnapshot {
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  return {
    id,
    label,
    createdAt: now,
    experience: scope.experience ? clone(scope.experience) : clone(blankExp()),
    apiCatalog: scope.apiCatalog ? clone(scope.apiCatalog) : null,
    archDecisions: clone(scope.archDecisions ?? []),
    assumptions: clone(scope.assumptions ?? []),
  };
}

function blankExp(): ExperienceModule {
  return { id: "x", version: 1, screens: [], assets: [], components: [], annotations: [], actions: [], journeys: [], transitions: [], bindings: [], requirements: [], states: [], createdAt: "", updatedAt: "" };
}

export interface SnapshotChange {
  key: string;
  area: string;
  summary: string;
}

/** Deterministic diff of two snapshots by stable id. */
export function compareSnapshots(a: ArchitectureSnapshot, b: ArchitectureSnapshot): SnapshotChange[] {
  const out: SnapshotChange[] = [];
  const diffList = <T extends { id: string }>(label: string, name: (x: T) => string, before: T[], after: T[]) => {
    const bm = new Map(before.map((x) => [x.id, x]));
    const am = new Map(after.map((x) => [x.id, x]));
    for (const [id, x] of am) {
      if (!bm.has(id)) out.push({ key: `${label}:added:${id}`, area: label, summary: `Added ${label}: ${name(x)}` });
      else if (JSON.stringify(bm.get(id)) !== JSON.stringify(x)) out.push({ key: `${label}:changed:${id}`, area: label, summary: `Changed ${label}: ${name(x)}` });
    }
    for (const [id, x] of bm) {
      if (!am.has(id)) out.push({ key: `${label}:removed:${id}`, area: label, summary: `Removed ${label}: ${name(x)}` });
    }
  };

  diffList("screen", (s) => (s as { name: string }).name, a.experience.screens, b.experience.screens);
  diffList("component", (s) => (s as { name: string }).name, a.experience.components, b.experience.components);
  diffList("operation", (s) => `${(s as { method: string }).method} ${(s as { path: string }).path}`, a.apiCatalog?.operations ?? [], b.apiCatalog?.operations ?? []);
  diffList("binding", (s) => (s as { id: string }).id, a.experience.bindings, b.experience.bindings);
  diffList("requirement", (s) => (s as { name: string }).name, a.experience.requirements, b.experience.requirements);
  diffList("decision", (s) => (s as { title: string }).title, a.archDecisions ?? [], b.archDecisions ?? []);

  // Binding set changes reported per operation.
  const bindSig = (x: { operationId: string; componentId?: string; actionId?: string }) => `${x.operationId}|${x.componentId ?? ""}|${x.actionId ?? ""}`;
  const aBinds = new Set(a.experience.bindings.map(bindSig));
  const bBinds = new Set(b.experience.bindings.map(bindSig));
  for (const sig of bBinds) {
    if (!aBinds.has(sig)) out.push({ key: `binding-link:added:${sig}`, area: "binding", summary: `New binding link: ${sig}` });
  }
  for (const sig of aBinds) {
    if (!bBinds.has(sig)) out.push({ key: `binding-link:removed:${sig}`, area: "binding", summary: `Removed binding link: ${sig}` });
  }
  return out;
}

export interface ImpactNode {
  kind: "screen" | "component" | "action" | "requirement" | "state" | "dependency" | "decision" | "operation" | "mapping";
  id: string;
  label: string;
}

/** Trace an API operation change to every dependent artifact (direct links only). */
export function operationImpact(
  scope: {
    experience?: ExperienceModule | null;
    apiCatalog?: { operations: { id: string; method: string; path: string; name: string }[]; dependencies: { id: string; operationId: string; label: string }[] } | null;
  },
  operationId: string
): ImpactNode[] {
  const exp = scope.experience;
  const out: ImpactNode[] = [];
  if (!exp) return out;
  const bindings = exp.bindings.filter((b) => b.operationId === operationId);
  const compIds = new Set(bindings.filter((b) => b.componentId).map((b) => b.componentId as string));
  const actIds = new Set(bindings.filter((b) => b.actionId).map((b) => b.actionId as string));
  const screenIds = new Set(bindings.map((b) => b.screenId));
  for (const s of exp.screens.filter((x) => screenIds.has(x.id))) out.push({ kind: "screen", id: s.id, label: s.name });
  for (const c of exp.components.filter((x) => compIds.has(x.id))) out.push({ kind: "component", id: c.id, label: c.name });
  for (const a of exp.actions.filter((x) => actIds.has(x.id))) out.push({ kind: "action", id: a.id, label: a.name });
  for (const r of exp.requirements.filter((x) => bindings.some((b) => b.requestRequirementIds.includes(x.id) || b.responseRequirementIds.includes(x.id)))) {
    out.push({ kind: "requirement", id: r.id, label: r.name });
  }
  for (const d of (scope.apiCatalog?.dependencies ?? []).filter((x) => x.operationId === operationId)) {
    out.push({ kind: "dependency", id: d.id, label: d.label });
  }
  return out;
}

/** Trace an integration artifact (mapping row / plan) to experience artifacts. */
export function integrationImpact(
  scope: {
    experience?: ExperienceModule | null;
    apiCatalog?: { operations: { id: string; method: string; path: string; name: string }[]; dependencies: { id: string; operationId: string; label: string; reference?: { artifactId?: string } }[] } | null;
  },
  artifactId: string,
  artifactLabel?: string
): ImpactNode[] {
  const out: ImpactNode[] = [];
  const exp = scope.experience;
  if (!exp) return out;
  const depOps = new Set((scope.apiCatalog?.dependencies ?? []).filter((d) => d.reference?.artifactId === artifactId).map((d) => d.operationId));
  for (const opId of depOps) {
    const op = scope.apiCatalog?.operations.find((o) => o.id === opId);
    out.push({ kind: "operation", id: opId, label: op ? `${op.method} ${op.path}` : opId });
    for (const n of operationImpact(scope, opId)) {
      if (!out.some((x) => x.kind === n.kind && x.id === n.id)) out.push(n);
    }
  }
  out.push({ kind: "mapping", id: artifactId, label: artifactLabel ?? artifactId });
  return out;
}
