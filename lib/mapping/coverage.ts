/**
 * Mapping Studio - coverage queue.
 *
 * Finishing pass: every required target field with no mapping, ordered so
 * the architect works top-down and stops at a clean zero. Candidates come
 * from the same name-similarity core as auto-suggest, reversed to
 * target-first. Type-incompatible sources are excluded up front.
 */

import { checkType } from "./compatibility";
import { normName, tokensOf } from "./suggest";
import type { MappingProject, SnapshotField, SourcePath } from "./types";

export interface CoverageItem {
  objectName: string;
  field: SnapshotField;
  planId: string | null;
}

export interface SourceCandidate {
  path: SourcePath;
  confidence: "exact" | "close";
}

/** Required target fields with no mapping yet. Plans first, then direct-mapped objects. */
export function requiredTargets(project: MappingProject): CoverageItem[] {
  const objects = new Set<string>();
  for (const plan of project.recordPlans) objects.add(plan.objectName);
  for (const m of project.mappings) objects.add(m.objectName);
  const planOf = (objectName: string): string | null =>
    project.recordPlans.find((p) => p.objectName === objectName)?.id ?? null;

  const out: CoverageItem[] = [];
  for (const objectName of objects) {
    const obj = project.sfSnapshot?.objects.find((o) => o.name === objectName);
    if (!obj) continue;
    const mappedFields = new Set(
      project.mappings.filter((m) => m.objectName === objectName).map((m) => m.fieldName)
    );
    for (const field of obj.fields) {
      const required = !field.nillable && !field.defaultedOnCreate && field.createable;
      if (required && !mappedFields.has(field.name)) {
        out.push({ objectName, field, planId: planOf(objectName) });
      }
    }
  }
  return out;
}

function isClose(fieldTokens: string[], sourceTokens: string[]): boolean {
  if (fieldTokens.length === 0 || sourceTokens.length === 0) return false;
  const [short, long] =
    fieldTokens.length <= sourceTokens.length ? [fieldTokens, sourceTokens] : [sourceTokens, fieldTokens];
  return short.every((t) => long.includes(t));
}

/** Ranked unmapped source paths for one target field. Empty = nothing worth proposing. */
export function candidateSources(project: MappingProject, field: SnapshotField, limit = 8): SourceCandidate[] {
  if (!project.source) return [];
  const mapped = new Set(project.mappings.filter((m) => m.kind !== "excluded").map((m) => m.sourcePath));
  const normField = normName(field.name);
  const fieldTokens = tokensOf(field.name);
  const out: SourceCandidate[] = [];
  for (const path of project.source.paths) {
    if (path.kind !== "scalar" && path.kind !== "null") continue;
    if (mapped.has(path.id)) continue;
    const normPath = normName(path.key);
    if (!normPath || !normField) continue;
    let confidence: SourceCandidate["confidence"] | null = null;
    if (normPath === normField) confidence = "exact";
    else if (isClose(fieldTokens, tokensOf(path.key))) confidence = "close";
    if (!confidence) continue;
    // A candidate the type checker would condemn is worse than no candidate.
    if (checkType(path.jsonType, field.type).level === "incompatible") continue;
    out.push({ path, confidence });
    if (out.length >= limit * 3) break;
  }
  out.sort((a, b) => (a.confidence === b.confidence ? a.path.id.localeCompare(b.path.id) : a.confidence === "exact" ? -1 : 1));
  return out.slice(0, limit);
}

/** Unmapped scalar source paths - informational tail once required targets hit zero. */
export function unmappedSourceCount(project: MappingProject): number {
  if (!project.source) return 0;
  const mapped = new Set(project.mappings.filter((m) => m.kind !== "excluded").map((m) => m.sourcePath));
  return project.source.paths.filter(
    (p) => (p.kind === "scalar" || p.kind === "null") && !mapped.has(p.id)
  ).length;
}
