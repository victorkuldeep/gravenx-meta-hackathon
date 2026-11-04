import { z } from "zod";
import {
  buildStudioPayload,
  computeRequestLayers,
  isValidReferenceId,
  newStudioId,
  nextReferenceId,
  validateStudio,
  type StudioDocument,
  type StudioFieldValue,
  type StudioRequest,
} from "@/lib/composite/studio";
import { claimFile, findRecords, listKind, writeJson } from "../workspace";
import type { McpTool, ToolResult } from "./types";

const KIND = "composite";
export const COMPOSITE_FORMAT = "gravenx-composite";
export const COMPOSITE_FORMAT_VERSION = 1;

interface CompositeFile {
  format: string;
  formatVersion: number;
  exportedAt: string;
  document: StudioDocument;
}

function asDocument(data: unknown): StudioDocument | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { document?: unknown };
  const doc = (d.document && typeof d.document === "object" ? d.document : data) as Partial<StudioDocument>;
  if (typeof doc.name !== "string" || !Array.isArray(doc.requests) || !Array.isArray(doc.mappings)) return null;
  return doc as StudioDocument;
}

function resolveOne(dir: string, ref: string): { file: string; doc: StudioDocument } {
  const hits = findRecords(dir, KIND, ref, (data) => {
    const d = asDocument(data);
    if (!d) return null;
    return { id: d.name, name: d.name };
  });
  if (hits.length === 0) throw new Error(`No composite batch matches "${ref}" - create one first or check the filename.`);
  if (hits.length > 1) throw new Error(`Ambiguous ref "${ref}" - ${hits.length} matches. Use the exact filename.`);
  const doc = asDocument(hits[0].data);
  if (!doc) throw new Error(`File ${hits[0].file} is not a composite batch.`);
  return { file: hits[0].file, doc };
}

function persist(file: string, doc: StudioDocument): void {
  const out: CompositeFile = {
    format: COMPOSITE_FORMAT,
    formatVersion: COMPOSITE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    document: doc,
  };
  writeJson(file, out);
}

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

function toField(apiName: string, value: unknown, from: string | undefined, property: string | undefined): StudioFieldValue {
  if (from) {
    return { apiName, fieldLabel: apiName, fieldType: "reference", mode: "reference", literal: null, mappingId: `pending:${from}.${property || "id"}` };
  }
  if (value === null) {
    return { apiName, fieldLabel: apiName, fieldType: "any", mode: "null", literal: null, mappingId: null };
  }
  return { apiName, fieldLabel: apiName, fieldType: typeof value === "number" ? "double" : typeof value === "boolean" ? "boolean" : "string", mode: "literal", literal: value, mappingId: null };
}

export async function buildPayload(args: {
  method: string;
  objectApiName: string;
  fields?: { apiName: string; value: unknown }[];
  recordId?: string;
  apiVersion?: string;
  name?: string;
  save?: boolean;
  dir?: string;
  overwrite?: boolean;
}): Promise<ToolResult & { file?: string }> {
  const method = args.method.toUpperCase();
  if (!["POST", "PATCH", "GET", "DELETE"].includes(method)) {
    return { ok: false, summary: "Bad method.", error: "Method must be POST, PATCH, GET or DELETE." };
  }
  if (!args.objectApiName) return { ok: false, summary: "Missing object.", error: "objectApiName is required." };
  if ((method === "PATCH" || method === "DELETE" || method === "GET") && !args.recordId) {
    return { ok: false, summary: "Missing record id.", error: `${method} needs recordId.` };
  }
  const ver = (args.apiVersion ?? "v66.0").startsWith("v") ? (args.apiVersion ?? "v66.0") : `v${args.apiVersion}`;
  const warnings: string[] = [];
  const body: Record<string, unknown> = {};
  for (const f of args.fields ?? []) {
    if (!FIELD_NAME.test(f.apiName)) warnings.push(`Suspicious field name "${f.apiName}" - kept as-is, verify against the org.`);
    if (method === "POST" || method === "PATCH") body[f.apiName] = f.value;
  }
  const url = `/services/data/${ver}/sobjects/${args.objectApiName}${args.recordId ? `/${args.recordId}` : ""}`;
  const payload = { method, url, ...(method === "POST" || method === "PATCH" ? { body } : {}) };
  let file: string | undefined;
  if (args.save && args.dir) {
    file = claimFile(args.dir, "payload", args.name ?? `${args.objectApiName}-${method.toLowerCase()}`, args.overwrite);
    writeJson(file, { format: "gravenx-payload", formatVersion: 1, exportedAt: new Date().toISOString(), payload });
  }
  return {
    ok: true,
    file,
    summary: `${method} ${url} ready${file ? " - saved" : ""} - paste into the REST Builder to run.`,
    data: { payload, warnings },
  };
}

export async function createBatch(
  dir: string,
  args: { name: string; apiVersion?: string; allOrNone?: boolean; overwrite?: boolean },
): Promise<ToolResult> {
  const doc: StudioDocument = {
    name: args.name,
    apiVersion: args.apiVersion ?? "v66.0",
    allOrNone: args.allOrNone ?? true,
    requests: [],
    mappings: [],
  };
  const file = claimFile(dir, KIND, args.name, args.overwrite);
  persist(file, doc);
  return {
    ok: true,
    file,
    summary: `Composite batch "${args.name}" created - add requests with composite_add_request.`,
    data: { name: doc.name },
  };
}

export async function addBatchRequest(
  dir: string,
  args: {
    ref: string;
    objectApiName: string;
    label?: string;
    method?: string;
    referenceId?: string;
    recordId?: string;
    fields?: { apiName: string; value?: unknown; from?: string; property?: string }[];
  },
): Promise<ToolResult> {
  const method = (args.method ?? "POST").toUpperCase() as StudioRequest["method"];
  if (!["POST", "PATCH", "GET", "DELETE"].includes(method)) {
    return { ok: false, summary: "Bad method.", error: "Method must be POST, PATCH, GET or DELETE." };
  }
  if (!args.objectApiName) return { ok: false, summary: "Missing object.", error: "objectApiName is required." };
  const { file, doc } = resolveOne(dir, args.ref);
  // Validate all references before mutating so failures save nothing.
  for (const f of args.fields ?? []) {
    if (f.from && !doc.requests.some((r) => r.referenceId === f.from)) {
      return {
        ok: false,
        summary: "Unknown reference.",
        error: `No request with referenceId "${f.from}" - add it before referencing. Nothing was saved.`,
      };
    }
  }
  const taken = new Set(doc.requests.map((r) => r.referenceId).filter(Boolean));
  const referenceId = args.referenceId || nextReferenceId(args.objectApiName, taken);
  if (!isValidReferenceId(referenceId)) {
    return { ok: false, summary: "Bad referenceId.", error: `"${referenceId}" must match [A-Za-z][A-Za-z0-9_]*.` };
  }
  if (taken.has(referenceId)) {
    return { ok: false, summary: "Duplicate referenceId.", error: `"${referenceId}" is already used in this batch.` };
  }
  const req: StudioRequest = {
    id: newStudioId("req"),
    objectApiName: args.objectApiName,
    objectLabel: args.label ?? args.objectApiName,
    method,
    referenceId,
    displayName: args.label ?? args.objectApiName,
    recordId: args.recordId ?? "",
    fields: [],
  };
  doc.requests.push(req);
  for (const f of args.fields ?? []) {
    const field = toField(f.apiName, f.value, f.from, f.property);
    req.fields.push(field);
    if (f.from) {
      const src = doc.requests.find((r) => r.referenceId === f.from);
      if (!src) continue; // validated above; guards against races only
      const mappingId = newStudioId("map");
      field.mappingId = mappingId;
      doc.mappings.push({
        id: mappingId,
        sourceRequestId: src.id,
        sourceProperty: f.property || "id",
        targetRequestId: req.id,
        targetFieldApiName: f.apiName,
      });
    }
  }
  persist(file, doc);
  return {
    ok: true,
    file,
    summary: `${method} ${args.objectApiName} as @${referenceId} added (${req.fields.length} field(s)).`,
    data: { requestId: req.id, referenceId, requests: doc.requests.length },
  };
}

export async function validateBatch(dir: string, args: { ref: string }): Promise<ToolResult> {
  const { file, doc } = resolveOne(dir, args.ref);
  // Headless structural pass: empty describes skips org-required-field
  // warnings; reference integrity, dup refs and method rules still apply.
  const issues = validateStudio(doc, new Map());
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length > 0) {
    return {
      ok: false,
      file,
      summary: `${errors.length} error(s).`,
      error: errors.slice(0, 8).map((e) => e.message).join(" "),
      data: { issues },
    };
  }
  const warns = issues.filter((i) => i.level === "warning");
  return {
    ok: true,
    file,
    summary: `Structurally valid: ${doc.requests.length} request(s), ${doc.mappings.length} reference(s)${warns.length ? `, ${warns.length} warning(s)` : ""}.`,
    data: { warnings: warns },
  };
}

export async function batchPayload(dir: string, args: { ref: string }): Promise<ToolResult> {
  const { file, doc } = resolveOne(dir, args.ref);
  const payload = buildStudioPayload(doc);
  const layers = computeRequestLayers(doc);
  const order = [...doc.requests]
    .sort((a, b) => (layers.get(a.id) ?? 0) - (layers.get(b.id) ?? 0))
    .map((r) => `@${r.referenceId}`);
  return {
    ok: true,
    file,
    summary: `Composite payload: ${payload.compositeRequest.length} subrequest(s), execution order ${order.join(" -> ")}. Paste into the REST runner to execute.`,
    data: { payload, executionOrder: order },
  };
}

export async function listBatches(dir: string): Promise<ToolResult> {
  const items = listKind(dir, KIND).map(({ file, data }) => {
    const d = asDocument(data);
    return {
      file,
      name: d?.name ?? "(unreadable)",
      requests: d?.requests.length ?? 0,
      mappings: d?.mappings.length ?? 0,
    };
  });
  return { ok: true, summary: `${items.length} composite batch(es).`, data: { batches: items } };
}

export const builderTools: McpTool[] = [
  {
    name: "payload_build",
    description: "Build one REST payload (Builder tab shape): method + object + fields -> runnable URL + JSON body. Save it to replay later.",
    shape: {
      method: z.enum(["POST", "PATCH", "GET", "DELETE"]),
      objectApiName: z.string().min(1).max(80),
      fields: z.array(z.object({ apiName: z.string().min(1).max(80), value: z.unknown() })).max(200).optional(),
      recordId: z.string().max(30).optional(),
      apiVersion: z.string().max(10).optional(),
      name: z.string().max(160).optional().describe("Required when save=true"),
      save: z.boolean().optional(),
      overwrite: z.boolean().optional(),
    },
    run: (dir, args) =>
      buildPayload({
        ...(args as { method: string; objectApiName: string; fields?: { apiName: string; value: unknown }[]; recordId?: string; apiVersion?: string; name?: string; save?: boolean; overwrite?: boolean }),
        dir,
      }),
  },
  {
    name: "composite_create",
    description: "Create a composite batch file (up to 25 ordered subrequests with @{ref.id} references). Studio Composite tab runs the emitted payload.",
    shape: {
      name: z.string().min(1).max(160),
      apiVersion: z.string().max(10).optional(),
      allOrNone: z.boolean().optional(),
      overwrite: z.boolean().optional(),
    },
    run: (dir, args) =>
      createBatch(dir, args as { name: string; apiVersion?: string; allOrNone?: boolean; overwrite?: boolean }),
  },
  {
    name: "composite_add_request",
    description: "Add one subrequest to a batch. Link fields to earlier subrequests with {apiName, from: referenceId, property} to emit @{ref.id} references.",
    shape: {
      ref: z.string().min(1).describe("Filename or batch name"),
      objectApiName: z.string().min(1).max(80),
      label: z.string().max(160).optional(),
      method: z.enum(["POST", "PATCH", "GET", "DELETE"]).optional(),
      referenceId: z.string().max(60).optional().describe("Auto-generated when omitted"),
      recordId: z.string().max(30).optional(),
      fields: z
        .array(
          z.object({
            apiName: z.string().min(1).max(80),
            value: z.unknown().optional(),
            from: z.string().max(60).optional().describe("referenceId of an earlier subrequest"),
            property: z.string().max(80).optional().describe("Output property, default id"),
          })
        )
        .max(200)
        .optional(),
    },
    run: (dir, args) =>
      addBatchRequest(
        dir,
        args as {
          ref: string; objectApiName: string; label?: string; method?: string; referenceId?: string; recordId?: string;
          fields?: { apiName: string; value?: unknown; from?: string; property?: string }[];
        },
      ),
  },
  {
    name: "composite_validate",
    description: "Structural validation of a batch (reference integrity, dup refs, method/record rules). Org required-field checks need the live tab.",
    shape: { ref: z.string().min(1).describe("Filename or batch name") },
    run: (dir, args) => validateBatch(dir, args as { ref: string }),
  },
  {
    name: "composite_payload",
    description: "Emit the runnable Composite API JSON for a batch plus its dependency execution order. Paste into the REST runner.",
    shape: { ref: z.string().min(1).describe("Filename or batch name") },
    run: (dir, args) => batchPayload(dir, args as { ref: string }),
  },
  {
    name: "composite_list",
    description: "List stored composite batches with request/reference counts.",
    shape: {},
    run: (dir) => listBatches(dir),
  },
];
