/**
 * Automation footprint: everything that fires on one sObject - triggers,
 * record flows, queues, validation rules, approvals, duplicates, assignment.
 * Answers "can I safely change this object?" before the architect touches it.
 *
 * Each section declares query VARIANTS (full select first, minimal Id-only
 * last). Tooling field names differ across releases - the fetcher tries each
 * variant in order and marks the section unavailable only when all fail.
 * A failed section never fabricates a zero.
 */

export interface FootprintRow {
  id: string;
  name: string;
  detail: string;
  active: boolean | null;
}

export interface FootprintSection {
  key: string;
  label: string;
  status: "ok" | "unavailable";
  rows: FootprintRow[];
  note?: string;
}

export interface Footprint {
  apiName: string;
  sections: FootprintSection[];
  total: number;
}

export interface FootprintRunner {
  (soql: string): Promise<{ ok: boolean; records?: Record<string, unknown>[]; error?: string }>;
}

interface SectionDef {
  key: string;
  label: string;
  /** Variants tried in order. {O} = object api name, {P} = key prefix. */
  queries: (o: string, p: string) => string[];
  toRow: (r: Record<string, unknown>) => FootprintRow;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function pickName(r: Record<string, unknown>): string {
  for (const k of ["Name", "MasterLabel", "Label", "DeveloperName", "ValidationName", "ApiName", "FullName"]) {
    const v = str(r[k]);
    if (v) return v;
  }
  const nested = r["Queue"];
  if (nested && typeof nested === "object") {
    const n = pickName(nested as Record<string, unknown>);
    if (n) return n;
  }
  return str(r["Id"]) || "(unnamed)";
}

function pickActive(r: Record<string, unknown>): boolean | null {
  if (typeof r["Active"] === "boolean") return r["Active"];
  const s = str(r["Status"]).toLowerCase();
  if (!s) return null;
  return s === "active";
}

const SECTIONS: SectionDef[] = [
  {
    key: "triggers",
    label: "Triggers",
    queries: (o) => [`SELECT Id, Name, Status FROM ApexTrigger WHERE SobjectType = '${o}' ORDER BY Name`],
    toRow: (r) => ({ id: str(r["Id"]), name: pickName(r), detail: str(r["Status"]), active: pickActive(r) }),
  },
  {
    key: "flows",
    label: "Flows",
    queries: (o) => [
      `SELECT Id, MasterLabel, Status, ProcessType, TriggerType FROM Flow WHERE TriggerObjectOrEvent = '${o}' ORDER BY MasterLabel`,
      `SELECT Id, Label, Status, TriggerType FROM Flow WHERE TriggerObjectOrEvent = '${o}' ORDER BY Label`,
      `SELECT Id FROM Flow WHERE TriggerObjectOrEvent = '${o}'`,
    ],
    toRow: (r) => ({
      id: str(r["Id"]),
      name: pickName(r),
      detail: [str(r["TriggerType"]), str(r["ProcessType"])].filter(Boolean).join(" · "),
      active: pickActive(r),
    }),
  },
  {
    key: "queues",
    label: "Queues",
    queries: (o) => [
      `SELECT QueueId, Queue.Name, Queue.DeveloperName FROM QueueSobject WHERE SobjectType = '${o}' ORDER BY Queue.Name`,
      `SELECT QueueId FROM QueueSobject WHERE SobjectType = '${o}'`,
    ],
    toRow: (r) => ({ id: str(r["QueueId"]) || str(r["Id"]), name: pickName(r), detail: "ownership", active: null }),
  },
  {
    key: "validation",
    label: "Validation",
    queries: (o, p) => [
      `SELECT Id, ValidationName, Active, ErrorMessage FROM ValidationRule WHERE EntityDefinitionId = '${p}' ORDER BY ValidationName`,
      `SELECT Id, ValidationName, Active FROM ValidationRule WHERE EntityDefinitionId = '${p}' ORDER BY ValidationName`,
      // Key prefix unknown (no describe) - fall back to relationship filter.
      `SELECT Id, ValidationName, Active FROM ValidationRule WHERE EntityDefinition.QualifiedApiName = '${o}' ORDER BY ValidationName`,
    ],
    toRow: (r) => ({ id: str(r["Id"]), name: pickName(r), detail: str(r["ErrorMessage"]), active: pickActive(r) }),
  },
  {
    key: "approvals",
    label: "Approvals",
    queries: (o) => [
      `SELECT Id, Name, Active FROM ProcessDefinition WHERE TableEnumOrId = '${o}' AND Type = 'Approval' ORDER BY Name`,
      `SELECT Id, Name, Active FROM ProcessDefinition WHERE TableEnumOrId = '${o}' ORDER BY Name`,
    ],
    toRow: (r) => ({ id: str(r["Id"]), name: pickName(r), detail: str(r["Description"]), active: pickActive(r) }),
  },
  {
    key: "duplicates",
    label: "Duplicates",
    queries: (o) => [
      `SELECT Id, MasterLabel, SobjectType, IsActive FROM DuplicateRule WHERE SobjectType = '${o}' ORDER BY MasterLabel`,
      `SELECT Id FROM DuplicateRule WHERE SobjectType = '${o}'`,
    ],
    toRow: (r) => ({
      id: str(r["Id"]),
      name: pickName(r),
      detail: "",
      active: typeof r["IsActive"] === "boolean" ? (r["IsActive"] as boolean) : pickActive(r),
    }),
  },
  {
    key: "assignment",
    label: "Assignment",
    queries: (o) => [`SELECT Id, Name, Active, SobjectType FROM AssignmentRule WHERE SobjectType = '${o}' ORDER BY Name`],
    toRow: (r) => ({ id: str(r["Id"]), name: pickName(r), detail: "", active: pickActive(r) }),
  },
];

/** Key prefix (001, a00, …) for EntityDefinitionId filters - "" when unresolvable. */
export async function fetchKeyPrefix(apiName: string, run: FootprintRunner): Promise<string> {
  try {
    const res = await run(`SELECT KeyPrefix FROM EntityDefinition WHERE QualifiedApiName = '${apiName.trim()}' LIMIT 1`);
    if (res.ok && res.records && res.records.length > 0) return str(res.records[0]["KeyPrefix"]);
  } catch {
    /* fall through to relationship-filter variant */
  }
  return "";
}

/**
 * Save-order timeline: platform-fixed stages with the footprint sections
 * pinned where they fire. Triggers span before+after (phase lives in code,
 * not metadata); flows split by TriggerType when the org exposes it.
 */
export interface TimelineStage {
  stage: string;
  blurb: string;
  sections: string[];
  note?: string;
}

export const EXECUTION_TIMELINE: TimelineStage[] = [
  { stage: "1 · Validation", blurb: "Required, format and rule checks reject the save here.", sections: ["validation"] },
  { stage: "2 · Before triggers + flows", blurb: "Field updates before the record commits.", sections: ["triggers", "flows"], note: "Trigger phase is in code - flows split by start type below." },
  { stage: "3 · Assignment + ownership", blurb: "Lead/Case routing, then queue ownership.", sections: ["assignment", "queues"] },
  { stage: "4 · After triggers + flows", blurb: "Cross-object work after commit.", sections: ["triggers", "flows"], note: "Same records as stage 2 - phase per code and flow start element." },
  { stage: "5 · Async + evaluation", blurb: "Approvals, duplicate jobs and scheduled paths.", sections: ["approvals", "duplicates"] },
];

/** Lane for one flow row by its start trigger type. */
export function flowLane(detail: string): "before" | "after" | "other" {
  const d = detail.toLowerCase();
  if (d.includes("before")) return "before";
  if (d.includes("after")) return "after";
  return "other";
}

export interface FieldUsage {
  status: "ok" | "unavailable";
  deps: { name: string; type: string }[];
  note?: string;
}

/** "Where is this field used?" via the platform dependency index. */
export async function fetchFieldUsage(apiName: string, fieldName: string, run: FootprintRunner): Promise<FieldUsage> {
  try {
    const f = await run(
      `SELECT DurableId FROM FieldDefinition WHERE EntityDefinition.QualifiedApiName = '${apiName.trim()}' AND QualifiedApiName = '${fieldName.trim()}' LIMIT 1`
    );
    const id = f.ok && f.records && f.records.length > 0 ? str(f.records[0]["DurableId"]) : "";
    if (!id) return { status: "unavailable", deps: [], note: "Field not found in this org." };
    const d = await run(
      `SELECT MetadataComponentName, MetadataComponentType FROM MetadataComponentDependency WHERE RefMetadataComponentId = '${id}'`
    );
    if (!d.ok) return { status: "unavailable", deps: [], note: d.error || "Dependency index unavailable." };
    const deps = (d.records ?? []).map((r) => ({ name: str(r["MetadataComponentName"]) || "(unnamed)", type: str(r["MetadataComponentType"]) || "component" }));
    deps.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    return { status: "ok", deps };
  } catch (e) {
    return { status: "unavailable", deps: [], note: e instanceof Error ? e.message : "Dependency index unavailable." };
  }
}

/** One-page Markdown brief of the whole footprint - built for forwarding. */
export function footprintMarkdown(fp: Footprint): string {
  const lines = [`# Automation footprint · ${fp.apiName}`, ``, `Total: ${fp.total} records across ${fp.sections.length} sections. Live Tooling API read.`, ``];
  for (const s of fp.sections) {
    lines.push(`## ${s.label} (${s.status === "ok" ? s.rows.length : "unavailable"})`);
    if (s.status !== "ok") {
      lines.push(`Not readable in this org${s.note ? ` - ${s.note}` : "."}`, ``);
      continue;
    }
    if (s.rows.length === 0) {
      lines.push(`None.`, ``);
      continue;
    }
    for (const r of s.rows) lines.push(`- ${r.name}${r.detail ? ` - ${r.detail}` : ""}${r.active === true ? " (active)" : r.active === false ? " (inactive)" : ""}`);
    lines.push(``);
  }
  return lines.join("\n");
}

export function footprintSectionKeys(): string[] {
  return SECTIONS.map((s) => s.key);
}

export async function fetchFootprint(apiName: string, keyPrefix: string, run: FootprintRunner): Promise<Footprint> {
  const o = apiName.trim();
  const sections: FootprintSection[] = [];
  for (const def of SECTIONS) {
    let rows: FootprintRow[] | null = null;
    let lastError = "";
    for (const q of def.queries(o, keyPrefix.trim())) {
      try {
        const res = await run(q);
        if (res.ok) {
          rows = (res.records ?? []).map(def.toRow);
          break;
        }
        lastError = res.error || "query failed";
      } catch (e) {
        lastError = e instanceof Error ? e.message : "query failed";
      }
    }
    sections.push(
      rows
        ? { key: def.key, label: def.label, status: "ok", rows }
        : { key: def.key, label: def.label, status: "unavailable", rows: [], note: lastError || "Not exposed in this org." }
    );
  }
  return { apiName: o, sections, total: sections.reduce((n, s) => n + s.rows.length, 0) };
}
