/**
 * Org-wide metadata lens: cheap aggregate reads (LIMIT 1 + totalSize, GROUP BY)
 * that answer "how much automation does this org carry, and where does it
 * pile up?" without pulling a single full record.
 */
import type { CoverageRunner } from "./coverage";

export interface LensCounts {
  triggersActive: number | null;
  triggersInactive: number | null;
  flowActiveVersions: number | null;
  validationActive: number | null;
  validationInactive: number | null;
  approvals: number | null;
  duplicateRules: number | null;
  queues: number | null;
}

export interface DensityRow {
  objectName: string;
  triggers: number;
  flows: number;
  validation: number;
  total: number;
}

async function count(run: CoverageRunner, soql: string): Promise<number | null> {
  try {
    const res = await run(`${soql} LIMIT 1`);
    if (!res.ok) return null;
    return typeof res.totalSize === "number" ? res.totalSize : (res.records?.length ?? null);
  } catch {
    return null;
  }
}

export async function fetchLensCounts(run: CoverageRunner): Promise<LensCounts> {
  const [triggersActive, triggersInactive, flowActiveVersions, validationActive, validationInactive, approvals, duplicateRules, queues] =
    await Promise.all([
      count(run, "SELECT Id FROM ApexTrigger WHERE Status = 'Active'"),
      count(run, "SELECT Id FROM ApexTrigger WHERE Status != 'Active'"),
      count(run, "SELECT Id FROM Flow WHERE Status = 'Active'"),
      count(run, "SELECT Id FROM ValidationRule WHERE Active = true"),
      count(run, "SELECT Id FROM ValidationRule WHERE Active = false"),
      count(run, "SELECT Id FROM ProcessDefinition WHERE Type = 'Approval'"),
      count(run, "SELECT Id FROM DuplicateRule"),
      count(run, "SELECT QueueId FROM QueueSobject"),
    ]);
  return { triggersActive, triggersInactive, flowActiveVersions, validationActive, validationInactive, approvals, duplicateRules, queues };
}

async function groupCount(run: CoverageRunner, soql: string, keyField: string, valueField: string): Promise<Map<string, number> | null> {
  try {
    const res = await run(soql);
    if (!res.ok || !res.records) return null;
    const m = new Map<string, number>();
    for (const r of res.records) {
      const k = typeof r[keyField] === "string" ? (r[keyField] as string) : "";
      const v = typeof r[valueField] === "number" ? (r[valueField] as number) : 0;
      if (k) m.set(k, (m.get(k) ?? 0) + v);
    }
    return m;
  } catch {
    return null;
  }
}

/** Top objects by automation load (triggers + flows + validation). Null when aggregates are unavailable. */
export async function fetchDensity(run: CoverageRunner, limit = 12): Promise<DensityRow[] | null> {
  const [byTrigger, byFlow, byValidation, entities] = await Promise.all([
    groupCount(run, "SELECT SobjectType, COUNT(Id) n FROM ApexTrigger GROUP BY SobjectType", "SobjectType", "n"),
    groupCount(run, "SELECT TriggerObjectOrEvent, COUNT(Id) n FROM Flow GROUP BY TriggerObjectOrEvent", "TriggerObjectOrEvent", "n"),
    groupCount(run, "SELECT EntityDefinitionId, COUNT(Id) n FROM ValidationRule GROUP BY EntityDefinitionId", "EntityDefinitionId", "n"),
    (async () => {
      try {
        const res = await run("SELECT QualifiedApiName, DurableId FROM EntityDefinition");
        if (!res.ok || !res.records) return null;
        const m = new Map<string, string>();
        for (const r of res.records) {
          if (typeof r["DurableId"] === "string" && typeof r["QualifiedApiName"] === "string") m.set(r["DurableId"] as string, r["QualifiedApiName"] as string);
        }
        return m;
      } catch {
        return null;
      }
    })(),
  ]);
  if (!byTrigger && !byFlow && !byValidation) return null;
  const totals = new Map<string, DensityRow>();
  const bump = (name: string, field: "triggers" | "flows" | "validation", n: number) => {
    const row = totals.get(name) ?? { objectName: name, triggers: 0, flows: 0, validation: 0, total: 0 };
    row[field] += n;
    row.total += n;
    totals.set(name, row);
  };
  for (const [k, n] of byTrigger ?? []) bump(k, "triggers", n);
  for (const [k, n] of byFlow ?? []) bump(k, "flows", n);
  for (const [prefix, n] of byValidation ?? []) bump(entities?.get(prefix) ?? prefix, "validation", n);
  return [...totals.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}
