import { z } from "zod";
import { parseStoredProfileImport, serializeStoredProfile } from "@/lib/contracts/persistence";
import type { ContractFieldConfig, ContractProfile, FieldMapping, OperationConfig } from "@/lib/contracts/types";
import { claimFile, findRecords, listKind, readJson, writeJson } from "../workspace";
import type { McpTool, ToolResult } from "./types";

const KIND = "contract";

function asProfile(data: unknown): ContractProfile | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { profile?: unknown };
  const p = (d.profile && typeof d.profile === "object" ? d.profile : data) as Partial<ContractProfile>;
  if (typeof p.id !== "string" || typeof p.name !== "string" || !Array.isArray(p.operations)) return null;
  return p as ContractProfile;
}

function resolveOne(dir: string, ref: string): { file: string; profile: ContractProfile; snapshot: unknown } {
  const hits = findRecords(dir, KIND, ref, (data) => {
    const p = asProfile(data);
    if (!p) return null;
    return { id: p.id, name: p.name };
  });
  if (hits.length === 0) throw new Error(`No contract matches "${ref}" - create one first or check the filename.`);
  if (hits.length > 1) throw new Error(`Ambiguous ref "${ref}" - ${hits.length} matches. Use the exact filename.`);
  const p = asProfile(hits[0].data);
  if (!p) throw new Error(`File ${hits[0].file} is not a contract profile.`);
  const snap = (hits[0].data as { snapshot?: unknown }).snapshot ?? null;
  return { file: hits[0].file, profile: p, snapshot: snap };
}

function persist(file: string, profile: ContractProfile, snapshot: unknown): void {
  // Same envelope the Contracts tab exports/imports.
  writeJson(file, JSON.parse(serializeStoredProfile({ id: profile.id, profile, snapshot: (snapshot ?? null) as never })));
}

function opConfig(op: "POST" | "PATCH", summary: string): OperationConfig {
  return {
    operation: op,
    enabled: true,
    operationId: `${op.toLowerCase()}_${Date.now().toString(36)}`,
    summary,
    description: "",
    tags: [],
  };
}

export async function createContract(
  dir: string,
  args: {
    name: string;
    targetObject: string;
    consumer?: string;
    direction?: string;
    apiVersion?: string;
    description?: string;
    overwrite?: boolean;
  },
): Promise<ToolResult> {
  const dir2 = args.direction ?? "inbound";
  if (!["inbound", "outbound", "bidirectional"].includes(dir2)) {
    return { ok: false, summary: "Bad direction.", error: "Direction must be inbound, outbound or bidirectional." };
  }
  if (!args.targetObject) return { ok: false, summary: "Missing object.", error: "targetObject is required." };
  if (!args.consumer?.trim()) return { ok: false, summary: "Missing consumer.", error: "consumer is required - who calls this contract?" };
  const now = Date.now();
  const profile: ContractProfile = {
    id: `contract_${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: args.name,
    description: args.description ?? "",
    targetObjectApiName: args.targetObject,
    orgId: "",
    consumer: args.consumer!.trim(),
    direction: dir2 as ContractProfile["direction"],
    apiTitle: args.name,
    apiVersion: args.apiVersion ?? "1.0.0",
    salesforceApiVersion: "v66.0",
    baseUrl: "",
    resourcePath: "",
    operations: [opConfig("POST", `Create ${args.targetObject}`), opConfig("PATCH", `Update ${args.targetObject}`)],
    fields: [],
    security: { type: "none", description: "" },
    revision: 1,
    createdAt: now,
    updatedAt: now,
    metadataSnapshotRef: null,
    metadataCapturedAt: null,
  };
  const file = claimFile(dir, KIND, args.name, args.overwrite);
  persist(file, profile, null);
  return {
    ok: true,
    file,
    summary: `Contract "${args.name}" for ${args.targetObject} created - open it via Contracts Import.`,
    data: { id: profile.id, name: profile.name },
  };
}

export async function addContractField(
  dir: string,
  args: {
    ref: string;
    apiName: string;
    external?: string;
    label?: string;
    description?: string;
    operations?: string[];
    required?: boolean;
    nullable?: boolean;
    ownership?: string;
    transform?: string;
  },
): Promise<ToolResult> {
  const { file, profile, snapshot } = resolveOne(dir, args.ref);
  if (profile.fields.some((f) => f.salesforceApiName === args.apiName)) {
    return { ok: false, summary: "Duplicate field.", error: `${args.apiName} is already in this contract.` };
  }
  const ops = args.operations ?? ["POST", "PATCH"];
  for (const o of ops) {
    if (o !== "POST" && o !== "PATCH") {
      return { ok: false, summary: "Bad operation.", error: `Operations must be POST and/or PATCH - got "${o}".` };
    }
  }
  const field: ContractFieldConfig = {
    salesforceApiName: args.apiName,
    externalName: args.external ?? args.apiName,
    label: args.label ?? args.apiName,
    description: args.description ?? "",
    operations: ops as ("POST" | "PATCH")[],
    integrationRequired: args.required ?? false,
    nullable: args.nullable ?? false,
    ownership: (["consumer", "salesforce", "shared"].includes(args.ownership ?? "") ? args.ownership : "salesforce") as ContractFieldConfig["ownership"],
    mapping: {
      externalName: args.external ?? args.apiName,
      targetField: args.apiName,
      transform: (["direct", "trim", "lowercase", "uppercase", "date-format", "enum-map"].includes(args.transform ?? "") ? args.transform : "direct") as FieldMapping["transform"],
      direction: "inbound",
      ownership: "salesforce",
    },
  };
  profile.fields.push(field);
  profile.updatedAt = Date.now();
  persist(file, profile, snapshot);
  return {
    ok: true,
    file,
    summary: `Field ${args.apiName} added to "${profile.name}".`,
    data: { fields: profile.fields.length },
  };
}

export async function validateContract(dir: string, args: { ref: string }): Promise<ToolResult> {
  const { file } = resolveOne(dir, args.ref);
  try {
    const stored = parseStoredProfileImport(JSON.stringify(readJson(file)));
    return {
      ok: true,
      file,
      summary: `Valid: "${stored.profile.name}" with ${stored.profile.fields.length} field(s), ${stored.profile.operations.filter((o) => o.enabled).length} enabled operation(s).`,
      data: { id: stored.profile.id, name: stored.profile.name, target: stored.profile.targetObjectApiName },
    };
  } catch (e) {
    return { ok: false, file, summary: "Invalid contract.", error: e instanceof Error ? e.message : "Validation failed." };
  }
}

export async function specContract(dir: string, args: { ref: string }): Promise<ToolResult> {
  const { profile } = resolveOne(dir, args.ref);
  const lines = [
    `# API Contract - ${profile.name}`,
    ``,
    `${profile.description ?? ""}`,
    ``,
    `Target: ${profile.targetObjectApiName} · Consumer: ${profile.consumer || "-"} · Direction: ${profile.direction} · Version: ${profile.apiVersion}`,
    ``,
    `## Operations`,
  ];
  for (const o of profile.operations) {
    lines.push(`- ${o.enabled ? "✓" : "✗"} ${o.operation}: ${o.summary || o.operationId}`);
  }
  lines.push(``, `## Fields (${profile.fields.length})`, ``, `| Salesforce | External | Ops | Required | Ownership | Notes |`, `| --- | --- | --- | --- | --- | --- |`);
  for (const f of profile.fields) {
    const cell = (v: string) => v.replace(/\|/g, "\\|");
    lines.push(`| ${cell(f.salesforceApiName)} | ${cell(f.externalName)} | ${f.operations.join("+")} | ${f.integrationRequired ? "yes" : "no"} | ${f.ownership} | ${cell(f.description ?? "")} |`);
  }
  const markdown = lines.join("\n");
  return { ok: true, summary: `${profile.fields.length} field(s) specified.`, data: { markdown } };
}

export async function listContracts(dir: string): Promise<ToolResult> {
  const items = listKind(dir, KIND).map(({ file, data }) => {
    const p = asProfile(data);
    return { file, id: p?.id, name: p?.name ?? "(unreadable)", target: p?.targetObjectApiName, fields: p?.fields.length ?? 0 };
  });
  return { ok: true, summary: `${items.length} contract(s).`, data: { contracts: items } };
}

export const contractTools: McpTool[] = [
  {
    name: "contract_create",
    description: "Create an API contract profile file (consumer <-> Salesforce object). The studio Contracts tab imports the file directly.",
    shape: {
      name: z.string().min(1).max(160),
      targetObject: z.string().min(1).max(80),
      consumer: z.string().min(1).max(160).describe("Calling system - required by the contract schema"),
      direction: z.enum(["inbound", "outbound", "bidirectional"]).optional(),
      apiVersion: z.string().max(20).optional(),
      description: z.string().max(500).optional(),
      overwrite: z.boolean().optional(),
    },
    run: (dir, args) =>
      createContract(
        dir,
        args as { name: string; targetObject: string; consumer?: string; direction?: string; apiVersion?: string; description?: string; overwrite?: boolean },
      ),
  },
  {
    name: "contract_add_field",
    description: "Add one field mapping to a contract (Salesforce api name <-> external name, ops, ownership, transform).",
    shape: {
      ref: z.string().min(1).describe("Filename or contract name"),
      apiName: z.string().min(1).max(80),
      external: z.string().max(80).optional(),
      label: z.string().max(160).optional(),
      description: z.string().max(500).optional(),
      operations: z.array(z.enum(["POST", "PATCH"])).optional(),
      required: z.boolean().optional(),
      nullable: z.boolean().optional(),
      ownership: z.enum(["consumer", "salesforce", "shared"]).optional(),
      transform: z.enum(["direct", "trim", "lowercase", "uppercase", "date-format", "enum-map"]).optional(),
    },
    run: (dir, args) =>
      addContractField(
        dir,
        args as {
          ref: string; apiName: string; external?: string; label?: string; description?: string;
          operations?: string[]; required?: boolean; nullable?: boolean; ownership?: string; transform?: string;
        },
      ),
  },
  {
    name: "contract_validate",
    description: "Validate a contract file the same way studio import does.",
    shape: { ref: z.string().min(1).describe("Filename or contract name") },
    run: (dir, args) => validateContract(dir, args as { ref: string }),
  },
  {
    name: "contract_spec",
    description: "Render a contract as Markdown (operations + field table) for reviews and JIRA handoff.",
    shape: { ref: z.string().min(1).describe("Filename or contract name") },
    run: (dir, args) => specContract(dir, args as { ref: string }),
  },
  {
    name: "contract_list",
    description: "List stored contracts with target objects and field counts.",
    shape: {},
    run: (dir) => listContracts(dir),
  },
];
