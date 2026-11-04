/**
 * Mapping Studio - name-similarity auto-suggest.
 *
 * Proposes target fields for unmapped source paths by normalized name
 * match. Deterministic, snapshot-grounded (never invents fields), and
 * type-checked: incompatible candidates are skipped, so applying a
 * suggestion never creates a row the diagnostics engine would condemn.
 * Every applied row carries its provenance in rationale.
 */

import { checkType } from "./compatibility";
import type { JsonType } from "./types";
import type { MappingProject, SnapshotField } from "./types";

export type SuggestConfidence = "exact" | "close";

export interface Suggestion {
  sourcePath: string;
  sourceKey: string;
  objectName: string;
  fieldName: string;
  fieldLabel: string;
  confidence: SuggestConfidence;
  reason: string;
}

/** Lowercase alnum; Salesforce custom suffixes (__c, __pc…) ignored for comparison. */
export function normName(name: string): string {
  return name
    .toLowerCase()
    .replace(/__(c|pc|s|b)$/, "")
    .replace(/[^a-z0-9]/g, "");
}

/** Split camelCase / snake / digits into tokens: orderNumber -> [order, number]. */
export function tokensOf(name: string): string[] {
  const spaced = name.replace(/__/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function isClose(sourceTokens: string[], targetTokens: string[]): boolean {
  if (sourceTokens.length === 0 || targetTokens.length === 0) return false;
  const [short, long] = sourceTokens.length <= targetTokens.length ? [sourceTokens, targetTokens] : [targetTokens, sourceTokens];
  return short.every((t) => long.includes(t));
}

interface Candidate {
  objectName: string;
  field: SnapshotField;
  confidence: SuggestConfidence;
  reason: string;
}

function candidatesFor(
  key: string,
  sourceTokens: string[],
  objects: { name: string; fields: SnapshotField[] }[],
  checkJsonType: JsonType
): Candidate[] {
  const out: Candidate[] = [];
  const normKey = normName(key);
  if (!normKey) return out;
  for (const obj of objects) {
    for (const field of obj.fields) {
      const normField = normName(field.name);
      if (!normField) continue;
      let confidence: SuggestConfidence | null = null;
      let reason = "";
      if (normField === normKey) {
        confidence = "exact";
        reason = `Name matches ${obj.name}.${field.name} exactly.`;
      } else if (isClose(sourceTokens, tokensOf(field.name))) {
        confidence = "close";
        reason = `Name overlaps ${obj.name}.${field.name} (${tokensOf(field.name).join(", ")}).`;
      }
      if (!confidence) continue;
      // Never propose a row the type checker would condemn.
      if (checkType(checkJsonType, field.type).level === "incompatible") continue;
      out.push({ objectName: obj.name, field, confidence, reason });
    }
  }
  return out;
}

/**
 * Suggest targets for unmapped scalar/null source paths.
 * When planObject is set, its object wins ties and non-plan objects are
 * skipped - the architect is mapping one record at a time.
 */
export function suggestMappings(
  project: MappingProject,
  opts?: { planObject?: string | null; limit?: number }
): Suggestion[] {
  const snapshotObjects = project.sfSnapshot?.objects ?? [];
  if (snapshotObjects.length === 0 || !project.source) return [];
  const limit = opts?.limit ?? 200;
  const planObject = opts?.planObject ?? null;

  const mapped = new Set(project.mappings.filter((m) => m.kind !== "excluded").map((m) => m.sourcePath));
  const pool = planObject ? snapshotObjects.filter((o) => o.name === planObject) : snapshotObjects;
  if (pool.length === 0) return [];

  const out: Suggestion[] = [];
  for (const path of project.source.paths) {
    if (out.length >= limit) break;
    if ((path.kind !== "scalar" && path.kind !== "null") || mapped.has(path.id)) continue;
    const cands = candidatesFor(path.key, tokensOf(path.key), pool, path.jsonType);
    if (cands.length === 0) continue;
    cands.sort((a, b) => {
      if (a.confidence !== b.confidence) return a.confidence === "exact" ? -1 : 1;
      if (a.objectName !== b.objectName) return a.objectName.localeCompare(b.objectName);
      return a.field.name.localeCompare(b.field.name);
    });
    const best = cands[0];
    out.push({
      sourcePath: path.id,
      sourceKey: path.key,
      objectName: best.objectName,
      fieldName: best.field.name,
      fieldLabel: best.field.label,
      confidence: best.confidence,
      reason: best.reason,
    });
  }
  return out;
}
