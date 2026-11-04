import { z } from "zod";
import {
  ALL_STATUSES,
  blankProject,
  // (format comes from the serialized envelope)
  type MappingKind,
  type MappingProject,
  type MappingRow,
  type MappingStatus,
  type OperationIntent,
  type PortableProject,
  type RecordPlan,
} from "@/lib/mapping/types";
import { serializeProject, validateImport } from "@/lib/mapping/exchange";
import { claimFile, findRecords, listKind, readJson, writeJson } from "../workspace";
import type { McpTool, ToolResult } from "./types";

const KIND = "mapping";

function asProject(data: unknown): MappingProject | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { project?: unknown };
  const p = (d.project && typeof d.project === "object" ? d.project : data) as Partial<MappingProject>;
  if (typeof p.id !== "string" || typeof p.name !== "string" || !Array.isArray(p.mappings)) return null;
  return p as MappingProject;
}

function matchMapping(data: unknown) {
  const p = asProject(data);
  if (!p) return null;
  return { id: p.id, name: p.name };
}

function resolveOne(dir: string, ref: string): { file: string; project: MappingProject } {
  const hits = findRecords(dir, KIND, ref, matchMapping);
  if (hits.length === 0) throw new Error(`No mapping project matches "${ref}" - create one first or check the filename.`);
  if (hits.length > 1) {
    throw new Error(`Ambiguous ref "${ref}" - ${hits.length} matches. Use the exact filename.`);
  }
  const project = asProject(hits[0].data);
  if (!project) throw new Error(`File ${hits[0].file} is not a mapping project.`);
  return { file: hits[0].file, project };
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function persist(file: string, project: MappingProject): void {
  const portable: PortableProject = {
    // format comes from the canonical serializer spread below.
    // Reuse the canonical serializer so agent files are byte-identical in
    // shape to studio exports (validated by the same import path).
    ...(JSON.parse(serializeProject({ ...project, updatedAt: new Date().toISOString() }, "full", new Date().toISOString())) as PortableProject),
  };
  writeJson(file, portable);
}

const INTENTS: OperationIntent[] = ["create", "update", "upsert", "lookup"];
const KINDS: MappingKind[] = ["direct", "hardcoded", "excluded", "enum"];

export async function createMappingProject(
  dir: string,
  args: { name: string; description?: string; sourceSystem?: string; sourceApi?: string; domain?: string; overwrite?: boolean },
): Promise<ToolResult> {
  const now = new Date().toISOString();
  const project = blankProject({
    id: newId("map"),
    name: args.name,
    description: args.description,
    sourceSystem: args.sourceSystem,
    sourceApi: args.sourceApi,
    domain: args.domain,
    now,
  });
  const file = claimFile(dir, KIND, args.name, args.overwrite);
  persist(file, project);
  return {
    ok: true,
    file,
    summary: `Mapping project "${args.name}" saved - open it in Mapping Studio via Import mapping JSON.`,
    data: { id: project.id, name: project.name },
  };
}

export async function addRecordPlan(
  dir: string,
  args: { ref: string; name: string; objectName: string; intent: string; sourcePath?: string; matchKey?: string; notes?: string },
): Promise<ToolResult> {
  if (!INTENTS.includes(args.intent as OperationIntent)) {
    return { ok: false, summary: "Bad intent.", error: `Intent must be one of ${INTENTS.join(", ")}.` };
  }
  const { file, project } = resolveOne(dir, args.ref);
  const sourcePath = args.sourcePath ?? "";
  const plan: RecordPlan = {
    id: newId("plan"),
    name: args.name,
    objectName: args.objectName,
    intent: args.intent as OperationIntent,
    sourcePath,
    cardinality: sourcePath.includes("[]") ? "many" : "one",
    parentPlanId: null,
    matchKey: args.matchKey,
    notes: args.notes,
  };
  project.recordPlans.push(plan);
  persist(file, project);
  return {
    ok: true,
    file,
    summary: `Plan "${args.name}" (${args.objectName} ${args.intent}) added.`,
    data: { planId: plan.id, plans: project.recordPlans.length },
  };
}

function defaultStatus(kind: MappingKind): MappingStatus {
  if (kind === "direct" || kind === "hardcoded") return "mapped";
  if (kind === "excluded") return "excluded";
  return "unmapped";
}

export async function addMappingRule(
  dir: string,
  args: {
    ref: string;
    sourcePath: string;
    objectName: string;
    fieldName: string;
    kind: string;
    status?: string;
    plan?: string;
    value?: unknown;
    enumMap?: { sourceValue: string; targetValue: string }[];
    notes?: string;
  },
): Promise<ToolResult> {
  if (!KINDS.includes(args.kind as MappingKind)) {
    return { ok: false, summary: "Bad kind.", error: `Kind must be one of ${KINDS.join(", ")}.` };
  }
  if (args.status && !ALL_STATUSES.includes(args.status as MappingStatus)) {
    return { ok: false, summary: "Bad status.", error: `Status must be one of ${ALL_STATUSES.join(", ")}.` };
  }
  const { file, project } = resolveOne(dir, args.ref);
  let planId: string | null = null;
  if (args.plan) {
    const q = args.plan.trim().toLowerCase();
    const hit = project.recordPlans.find((p) => p.id === args.plan || p.name.toLowerCase() === q);
    if (!hit) {
      return {
        ok: false,
        summary: "Unknown plan.",
        error: `No plan "${args.plan}" in this project - add it with mapping_add_plan first.`,
      };
    }
    planId = hit.id;
  }
  const kind = args.kind as MappingKind;
  const row: MappingRow = {
    id: newId("row"),
    sourcePath: args.sourcePath,
    planId,
    objectName: args.objectName,
    fieldName: args.fieldName,
    kind,
    status: (args.status as MappingStatus | undefined) ?? defaultStatus(kind),
    updatedAt: new Date().toISOString(),
  };
  if (kind === "hardcoded" && args.value !== undefined) row.hardcodedValue = args.value;
  if (kind === "enum" && args.enumMap) {
    row.enumMap = args.enumMap.map((e) => ({ sourceValue: e.sourceValue, targetValue: e.targetValue, decided: false }));
    if (args.enumMap.length > 0) row.status = "needs-decision";
  }
  if (args.notes) row.notes = args.notes;
  project.mappings.push(row);
  persist(file, project);
  return {
    ok: true,
    file,
    summary: `Rule ${args.sourcePath} -> ${args.objectName}.${args.fieldName || "(no field)"} [${kind}/${row.status}] added.`,
    data: { rowId: row.id, rules: project.mappings.length },
  };
}

export async function validateMappingProject(dir: string, args: { ref: string }): Promise<ToolResult> {
  const { file } = resolveOne(dir, args.ref);
  const raw = readJson(file);
  const r = validateImport(JSON.stringify(raw));
  if (!r.ok) {
    return { ok: false, file, summary: "Invalid mapping project.", error: r.errors.join(" "), data: { errors: r.errors } };
  }
  return {
    ok: true,
    file,
    summary: `Valid: ${r.preview?.mappings ?? 0} rule(s), ${r.preview?.plans ?? 0} plan(s), ${r.preview?.decisions ?? 0} decision(s).`,
    data: { preview: r.preview, warnings: r.warnings },
  };
}

export async function specMappingProject(dir: string, args: { ref: string }): Promise<ToolResult> {
  const { project } = resolveOne(dir, args.ref);
  const lines = [
    `# Mapping - ${project.name}`,
    ``,
    `${project.description ?? ""}`,
    ``,
    `Source: ${project.sourceSystem ?? "?"}${project.sourceApi ? ` (${project.sourceApi})` : ""} -> Salesforce`,
    ``,
    `## Record plans (${project.recordPlans.length})`,
  ];
  for (const p of project.recordPlans) {
    lines.push(`- ${p.name}: ${p.intent.toUpperCase()} ${p.objectName}${p.sourcePath ? ` from \`${p.sourcePath}\`` : ""}${p.matchKey ? ` match on ${p.matchKey}` : ""}`);
  }
  lines.push(``, `## Rules by object`);
  const byObj = new Map<string, MappingRow[]>();
  for (const m of project.mappings) {
    const list = byObj.get(m.objectName) ?? [];
    list.push(m);
    byObj.set(m.objectName, list);
  }
  for (const [obj, rows] of [...byObj.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`### ${obj} (${rows.length})`, ``, `| Source path | Field | Kind | Status | Notes |`, `| --- | --- | --- | --- | --- |`);
    for (const m of rows) {
      const cell = (v: string) => v.replace(/\|/g, "\\|");
      lines.push(`| \`${cell(m.sourcePath)}\` | ${cell(m.fieldName || "-")} | ${m.kind} | ${m.status} | ${cell(m.notes ?? "")} |`);
    }
    lines.push(``);
  }
  const open = project.decisions.filter((d) => d.status === "open").length;
  lines.push(`## Open decisions: ${open}`, ``);
  for (const d of project.decisions.filter((x) => x.status === "open")) {
    lines.push(`- ${d.title}${d.owner ? ` (owner: ${d.owner})` : ""}`);
  }
  const markdown = lines.join("\n");
  return { ok: true, summary: `${project.mappings.length} rule(s) across ${byObj.size} object(s).`, data: { markdown } };
}

export async function listMappingProjects(dir: string): Promise<ToolResult> {
  const items = listKind(dir, KIND).map(({ file, data }) => {
    const p = asProject(data);
    return {
      file,
      id: p?.id,
      name: p?.name ?? "(unreadable)",
      plans: p?.recordPlans.length ?? 0,
      rules: p?.mappings.length ?? 0,
      decisions: p?.decisions.length ?? 0,
      updatedAt: p?.updatedAt,
    };
  });
  return { ok: true, summary: `${items.length} mapping project(s).`, data: { projects: items } };
}

export const mappingTools: McpTool[] = [
  {
    name: "mapping_create",
    description: "Create a mapping project file (screen/payload source -> Salesforce). The studio Mapping Import opens the file directly.",
    shape: {
      name: z.string().min(1).max(160),
      description: z.string().max(500).optional(),
      sourceSystem: z.string().max(120).optional().describe("Upstream system, e.g. Middleware"),
      sourceApi: z.string().max(160).optional().describe("Upstream API/contract name"),
      domain: z.string().max(120).optional(),
      overwrite: z.boolean().optional(),
    },
    run: (dir, args) =>
      createMappingProject(dir, args as { name: string; description?: string; sourceSystem?: string; sourceApi?: string; domain?: string; overwrite?: boolean }),
  },
  {
    name: "mapping_add_plan",
    description: "Add a record plan (one target object + intent: create/update/upsert/lookup) to a mapping project.",
    shape: {
      ref: z.string().min(1).describe("Filename, id, or name substring"),
      name: z.string().min(1).max(160),
      objectName: z.string().min(1).max(80).describe("Target sObject api name"),
      intent: z.enum(["create", "update", "upsert", "lookup"]),
      sourcePath: z.string().max(300).optional().describe("Source collection path, e.g. $.lines[]; empty = single root record"),
      matchKey: z.string().max(120).optional().describe("External-id / match field for upsert"),
      notes: z.string().max(500).optional(),
    },
    run: (dir, args) =>
      addRecordPlan(dir, args as { ref: string; name: string; objectName: string; intent: string; sourcePath?: string; matchKey?: string; notes?: string }),
  },
  {
    name: "mapping_add_rule",
    description: "Add one field rule: source path -> Object.field (direct/hardcoded/excluded/enum). Attach to a plan by name or id.",
    shape: {
      ref: z.string().min(1).describe("Filename, id, or name substring"),
      sourcePath: z.string().min(1).max(300),
      objectName: z.string().min(1).max(80),
      fieldName: z.string().max(80).describe("Target field api name; empty for record-level rows"),
      kind: z.enum(["direct", "hardcoded", "excluded", "enum"]),
      status: z.enum(["unmapped", "mapped", "hardcoded", "excluded", "needs-transformation", "needs-decision", "incompatible", "stale-target", "invalid"]).optional(),
      plan: z.string().max(160).optional().describe("Plan name or id"),
      value: z.unknown().optional().describe("Constant for hardcoded rules"),
      enumMap: z.array(z.object({ sourceValue: z.string(), targetValue: z.string() })).max(100).optional(),
      notes: z.string().max(500).optional(),
    },
    run: (dir, args) =>
      addMappingRule(
        dir,
        args as {
          ref: string; sourcePath: string; objectName: string; fieldName: string; kind: string;
          status?: string; plan?: string; value?: unknown;
          enumMap?: { sourceValue: string; targetValue: string }[]; notes?: string;
        },
      ),
  },
  {
    name: "mapping_validate",
    description: "Validate a mapping project file the same way studio import does (ids, plan refs, required arrays).",
    shape: { ref: z.string().min(1).describe("Filename, id, or name substring") },
    run: (dir, args) => validateMappingProject(dir, args as { ref: string }),
  },
  {
    name: "mapping_spec",
    description: "Render a mapping project as Markdown (plans + rules by object + open decisions) for JIRA stories and dev handoff.",
    shape: { ref: z.string().min(1).describe("Filename, id, or name substring") },
    run: (dir, args) => specMappingProject(dir, args as { ref: string }),
  },
  {
    name: "mapping_list",
    description: "List stored mapping projects with plan/rule/decision counts.",
    shape: {},
    run: (dir) => listMappingProjects(dir),
  },
];
