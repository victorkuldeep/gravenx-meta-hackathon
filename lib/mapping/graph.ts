/**
 * Mapping Studio - visualization model for the Graph tab.
 *
 * Pure projection of a MappingProject into left-to-right flow: one JSON
 * source node, one constants box, one box per target sObject, one edge per
 * flowing mapping row. No store access, no side effects - the canvas draws
 * exactly what this computes. Excluded rows never flow, so they stay out.
 */

import { freeConstants } from "./constants";
import {
  STATUS_LABELS,
  type MappingProject,
  type MappingStatus,
  type RecordPlan,
} from "./types";

export const GRAPH_EDGE_COLOR: Record<MappingStatus, string> = {
  mapped: "#32815B",
  hardcoded: "#A98450",
  unmapped: "#C9BFAE",
  excluded: "#C9BFAE",
  "needs-transformation": "#B98335",
  "needs-decision": "#8A6A2F",
  incompatible: "#B84C42",
  "stale-target": "#777168",
  invalid: "#B84C42",
};

export function statusLabel(status: MappingStatus): string {
  return STATUS_LABELS[status];
}

/** Worst-first rollup when several rows hit the same field. */
const SEVERITY: Record<MappingStatus, number> = {
  incompatible: 8,
  invalid: 7,
  "needs-decision": 6,
  "needs-transformation": 5,
  "stale-target": 4,
  unmapped: 3,
  mapped: 2,
  hardcoded: 1,
  excluded: 0,
};

export interface GraphFieldRow {
  apiName: string;
  label: string;
  status: MappingStatus;
  plans: string[];
  /** Author workflow: field missing from the snapshot (freehand future
   * field, renamed, or stale). Renders amber, never silently. */
  pending: boolean;
}

export interface GraphObjectBox {
  id: string;
  objectName: string;
  label: string;
  custom: boolean;
  /** No snapshot aboard: labels fall back to API names, honestly badged. */
  blind: boolean;
  /** Author workflow: object missing from the snapshot entirely. */
  pending: boolean;
  plans: Pick<RecordPlan, "id" | "name" | "intent">[];
  fields: GraphFieldRow[];
}

export interface GraphConstantRow {
  id: string;
  label: string;
  value: string;
}

export type GraphEdgeKind = "field" | "constant";

export interface GraphEdge {
  id: string;
  kind: GraphEdgeKind;
  /** JSON leaf path (field edges) or null. */
  sourceLeaf: string | null;
  /** Constant row id (constant edges) or null. */
  constantId: string | null;
  objectName: string;
  fieldName: string;
  status: MappingStatus;
  rationale?: string;
}

export interface MappingGraphModel {
  hasSource: boolean;
  sourceName: string;
  leafCount: number;
  unmappedCount: number;
  /** OpenAPI operation when the sample was derived from a spec. */
  sourceOrigin: string | null;
  constants: GraphConstantRow[];
  objects: GraphObjectBox[];
  edges: GraphEdge[];
}

export function buildMappingGraph(project: MappingProject): MappingGraphModel {
  const paths = project.source?.paths ?? [];
  const flowing = project.mappings.filter(
    (m) => m.status !== "excluded" && m.objectName !== "" && m.fieldName !== ""
  );
  const covered = new Set(
    flowing.filter((m) => m.sourcePath !== "(constant)").map((m) => m.sourcePath)
  );
  const unmappedCount = paths.filter((p) => !covered.has(p.path)).length;

  const snapByName = new Map((project.sfSnapshot?.objects ?? []).map((o) => [o.name, o]));
  const plansByObject = new Map<string, Pick<RecordPlan, "id" | "name" | "intent">[]>();
  for (const plan of project.recordPlans) {
    const list = plansByObject.get(plan.objectName) ?? [];
    list.push({ id: plan.id, name: plan.name, intent: plan.intent });
    plansByObject.set(plan.objectName, list);
  }

  // One box per target object, fields in first-seen order.
  const boxOrder: string[] = [];
  const boxFields = new Map<string, Map<string, { statuses: MappingStatus[]; plans: Set<string> }>>();
  for (const m of flowing) {
    if (!boxFields.has(m.objectName)) {
      boxFields.set(m.objectName, new Map());
      boxOrder.push(m.objectName);
    }
    const fields = boxFields.get(m.objectName)!;
    const hit = fields.get(m.fieldName) ?? { statuses: [], plans: new Set<string>() };
    hit.statuses.push(m.status);
    const plan = project.recordPlans.find((p) => p.id === m.planId);
    hit.plans.add(plan ? plan.name : "No plan");
    fields.set(m.fieldName, hit);
  }
  const objects: GraphObjectBox[] = boxOrder.map((objectName) => {
    const snap = snapByName.get(objectName);
    const fields: GraphFieldRow[] = [...(boxFields.get(objectName) ?? new Map<string, { statuses: MappingStatus[]; plans: Set<string> }>()).entries()].map(
      ([apiName, info]) => {
        const known = snap?.fields.find((f) => f.name === apiName);
        const status = [...info.statuses].sort((a, b) => SEVERITY[b] - SEVERITY[a])[0] ?? "unmapped";
        return { apiName, label: known?.label ?? apiName, status, plans: [...info.plans], pending: !snap ? false : !known };
      }
    );
    return {
      id: `obj:${objectName}`,
      objectName,
      label: snap?.label ?? objectName,
      custom: snap?.custom ?? objectName.endsWith("__c"),
      blind: !snap,
      pending: !snap,
      plans: plansByObject.get(objectName) ?? [],
      fields,
    };
  });

  const constants: GraphConstantRow[] = freeConstants(project.mappings).map((c) => ({
    id: c.id,
    label: (typeof c.notes === "string" && c.notes.trim()) || String(c.hardcodedValue ?? ""),
    value: String(c.hardcodedValue ?? ""),
  }));
  const constantByValue = new Map<string, string>();
  for (const c of freeConstants(project.mappings)) {
    constantByValue.set(JSON.stringify(c.hardcodedValue ?? null), c.id);
  }

  const edges: GraphEdge[] = [];
  for (const m of flowing) {
    if (m.kind === "hardcoded") {
      // Leaf rows that copied a maintained constant draw from the box;
      // free rows themselves and unmatched literals draw from the source.
      const match =
        m.sourcePath !== "(constant)"
          ? constantByValue.get(JSON.stringify(m.hardcodedValue ?? null)) ?? null
          : null;
      if (match) {
        edges.push({
          id: m.id, kind: "constant", sourceLeaf: m.sourcePath, constantId: match,
          objectName: m.objectName, fieldName: m.fieldName, status: m.status, rationale: m.rationale,
        });
        continue;
      }
    }
    if (m.sourcePath === "(constant)") continue;
    edges.push({
      id: m.id, kind: "field", sourceLeaf: m.sourcePath, constantId: null,
      objectName: m.objectName, fieldName: m.fieldName, status: m.status, rationale: m.rationale,
    });
  }

  return {
    hasSource: project.source !== null,
    sourceName: project.source?.name ?? "No source",
    leafCount: paths.length,
    unmappedCount,
    sourceOrigin: project.sourceApi ?? project.sourceSystem ?? null,
    constants,
    objects,
    edges,
  };
}
