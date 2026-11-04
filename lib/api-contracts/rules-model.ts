import type { ApiProject, BusinessRule } from "./types";

/**
 * Declarative business rules. Only constrained, typed kinds execute -
 * anything else stays a documented note the runtime must implement.
 */

export interface RuleFinding {
  ruleId: string;
  message: string;
}

/**
 * Evaluate conditional-required rules against a candidate payload
 * (external names). Pure and side-effect free.
 */
export function evaluateRules(
  rules: BusinessRule[],
  payload: Record<string, unknown>
): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const r of rules) {
    if (r.kind !== "conditional-required") continue;
    if (!r.whenField || !r.requireFields || r.requireFields.length === 0) continue;
    const actual = payload[r.whenField];
    const hit = Array.isArray(r.whenEquals)
      ? r.whenEquals.includes(actual)
      : actual === r.whenEquals;
    if (!hit) continue;
    for (const target of r.requireFields) {
      const v = payload[target];
      if (v === undefined || v === "" || v === null) {
        findings.push({
          ruleId: r.id,
          message: `${target} is required when ${r.whenField} is ${JSON.stringify(r.whenEquals)}.`,
        });
      }
    }
  }
  return findings;
}

export interface OwnershipConflict {
  targetObject: string;
  targetField: string;
  owners: string[];
  message: string;
}

/**
 * Flag overlapping ownership: two mappings writing one Salesforce field
 * from different owners without an approved shared-ownership decision.
 */
export function detectOwnershipConflicts(
  mappings: { targetObject: string; targetField: string; ownership: string }[]
): OwnershipConflict[] {
  const byTarget = new Map<string, Set<string>>();
  for (const m of mappings) {
    const key = `${m.targetObject}.${m.targetField}`;
    if (!byTarget.has(key)) byTarget.set(key, new Set());
    byTarget.get(key)?.add(m.ownership);
  }
  const out: OwnershipConflict[] = [];
  for (const [key, owners] of byTarget) {
    const distinct = [...owners].filter((o) => o !== "shared");
    if (distinct.length > 1) {
      const [object, field] = key.split(".");
      out.push({
        targetObject: object,
        targetField: field,
        owners: distinct,
        message: `${key} has conflicting writers (${distinct.join(" vs ")}) - approve shared ownership or pick one.`,
      });
    }
  }
  return out;
}

/** Collect every property mapping across all project schemas. */
export function collectMappings(project: ApiProject): {
  targetObject: string;
  targetField: string;
  ownership: string;
}[] {
  const out: { targetObject: string; targetField: string; ownership: string }[] = [];
  for (const s of project.schemas) {
    for (const p of s.properties) {
      if (!p.mapping) continue;
      out.push({
        targetObject: p.mapping.targetObject,
        targetField: p.mapping.targetField,
        ownership: p.mapping.ownership,
      });
    }
  }
  return out;
}
