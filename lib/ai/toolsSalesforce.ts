import { z } from "zod";
import { apiFetch } from "@/lib/api";
import { markSessionExpired, readLiveSession, type LiveSession } from "./gate";
import { policyCaps } from "@/lib/setup/policy";
import { looksLikeSosl } from "@/lib/salesforce/sosl";
import { LOG_LEVELS } from "@/lib/salesforce/apex";
import { looksLikeSoql } from "./toolsStudio";
import type { AgentTool, ToolOutcome } from "./tools";

/**
 * Session-bound Salesforce tools: the tab's live connection, never the
 * model's words. Reads (SOQL/SOSL) auto-execute capped to a first page;
 * apex_run executes arbitrary code as the connected user, so it always
 * pauses for the user's explicit Apply. No session -> honest error, never
 * a token ask: the gate + connect flow own credentials.
 */

/** Live connection via the shared gate reader (cache, else the tab restore record). */
function liveSession(): LiveSession | { error: string } {
  return readLiveSession() ?? { error: "No live Salesforce connection - connect on the Studio home first, then ask again." };
}

function isSession(o: LiveSession | { error: string }): o is LiveSession {
  return (o as LiveSession).token !== undefined;
}

/** Salesforce error bodies are a string or a field-errors map. */
function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body) return body;
  if (body && typeof body === "object") {
    const e = (body as { error?: unknown }).error;
    if (typeof e === "string" && e) return e;
    try {
      return JSON.stringify(body).slice(0, 400);
    } catch {
      /* fall through */
    }
  }
  return fallback;
}

/** Drop the per-row attributes envelope - it burns context and adds nothing. */
function stripAttrs(row: unknown): unknown {
  if (Array.isArray(row)) return row.map(stripAttrs);
  if (row && typeof row === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      if (k === "attributes") continue;
      out[k] = stripAttrs(v);
    }
    return out;
  }
  return row;
}

/**
 * Shared SOQL executor (REST + Tooling). First page only, model gets up to
 * the policy row cap of stripped rows plus totals - never a full table dump.
 */
async function runSoqlQuery(statement: string, useTooling: boolean): Promise<ToolOutcome> {
  const noun = useTooling ? "Tooling query" : "Query";
  const clean = statement.trim();
  if (!looksLikeSoql(clean)) {
    return { ok: false, error: "That does not look like SOQL - it should read SELECT <fields> FROM <Object>." };
  }
  const session = liveSession();
  if (!isSession(session)) return { ok: false, error: session.error };
  let res: Response;
  try {
    res = await apiFetch(
      "/api/salesforce/soql",
      {
        instanceUrl: session.instanceUrl,
        token: session.token,
        apiVersion: session.apiVersion,
        soql: clean,
        ...(useTooling ? { tooling: true } : {}),
      },
      60000
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : `${noun} request failed.` };
  }
  if (res.status === 401) {
    try {
      markSessionExpired();
    } catch {
      /* gate flag alone still closes AI */
    }
    return { ok: false, error: "Salesforce session expired - reconnect on the Studio home, then ask again." };
  }
  let body: { success?: boolean; error?: unknown; records?: unknown[]; totalSize?: number; done?: boolean; nextRecordsUrl?: string | null };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { ok: false, error: `${noun} failed (HTTP ${res.status}).` };
  }
  if (!res.ok) return { ok: false, error: errorMessage(body, `${noun} failed (HTTP ${res.status}).`) };
  if (typeof body.error === "string" && body.error) return { ok: false, error: body.error };
  const records = Array.isArray(body.records) ? body.records : [];
  const total = typeof body.totalSize === "number" ? body.totalSize : records.length;
  const hasMore = body.nextRecordsUrl != null || body.done === false;
  const rows = records.slice(0, policyCaps().maxRows).map(stripAttrs);
  return {
    ok: true,
    result: {
      totalSize: total,
      returned: rows.length,
      hasMore,
      records: rows,
      ...(total > rows.length
        ? { note: `First ${rows.length} of ${total} - narrow with LIMIT / WHERE, or open the result in /query for paging.` }
        : {}),
    },
  };
}

const soqlRunArgs = z.object({
  soql: z.string().min(1).max(10000).describe("Full SOQL statement, e.g. SELECT Id, Name FROM Account LIMIT 10"),
});

const soqlRun: AgentTool = {
  name: "query_soql_run",
  orgTouch: true,
  description:
    "Execute a read-only SOQL query on the CONNECTED org and report the first page (totalSize plus up to 25 rows back to the model). Use for data questions; never for writes. Requires a live connection.",
  parameters: {
    type: "object",
    properties: { soql: { type: "string" } },
    required: ["soql"],
    additionalProperties: false,
  },
  needsApproval: false,
  label: () => "Run SOQL",
  schema: soqlRunArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof soqlRunArgs>;
    return runSoqlQuery(args.soql, false);
  },
};

const toolingRunArgs = z.object({
  soql: z.string().min(1).max(10000).describe("Tooling API SOQL, e.g. SELECT Id, Name FROM ApexClass LIMIT 10"),
});

const toolingRun: AgentTool = {
  name: "query_tooling_run",
  orgTouch: true,
  description:
    "Execute a Tooling API SOQL query on the CONNECTED org for live metadata: ApexClass, ApexTrigger, EntityDefinition, FieldDefinition, ValidationRule, WorkflowRule, RecordType, FlowDefinition and friends. Same first-page cap as query_soql_run. Requires a live connection.",
  parameters: {
    type: "object",
    properties: { soql: { type: "string" } },
    required: ["soql"],
    additionalProperties: false,
  },
  needsApproval: false,
  label: () => "Run Tooling query",
  schema: toolingRunArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof toolingRunArgs>;
    return runSoqlQuery(args.soql, true);
  },
};

const soslRunArgs = z.object({
  sosl: z.string().min(1).max(10000).describe("Full SOSL statement, e.g. FIND {Acme} RETURNING Account(Id, Name)"),
});

const soslRun: AgentTool = {
  name: "query_sosl_run",
  orgTouch: true,
  description:
    "Execute a SOSL search on the CONNECTED org and report matches grouped by object (up to 25 rows back to the model). Requires a live connection.",
  parameters: {
    type: "object",
    properties: { sosl: { type: "string" } },
    required: ["sosl"],
    additionalProperties: false,
  },
  needsApproval: false,
  label: () => "Run SOSL",
  schema: soslRunArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof soslRunArgs>;
    const statement = args.sosl.trim();
    if (!looksLikeSosl(statement)) {
      return { ok: false, error: "That does not look like SOSL - it should start with FIND {term} and name RETURNING objects." };
    }
    const session = liveSession();
    if (!isSession(session)) return { ok: false, error: session.error };
    let res: Response;
    try {
      res = await apiFetch(
        "/api/salesforce/sosl",
        { instanceUrl: session.instanceUrl, token: session.token, apiVersion: session.apiVersion, sosl: statement },
        60000
      );
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Search request failed." };
    }
    if (res.status === 401) {
      try {
        markSessionExpired();
      } catch {
        /* gate flag alone still closes AI */
      }
      return { ok: false, error: "Salesforce session expired - reconnect on the Studio home, then ask again." };
    }
    let body: { success?: boolean; error?: unknown; searchRecords?: unknown[]; totalSize?: number };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return { ok: false, error: `Search failed (HTTP ${res.status}).` };
    }
    if (!res.ok) return { ok: false, error: errorMessage(body, `Search failed (HTTP ${res.status}).`) };
    if (typeof body.error === "string" && body.error) return { ok: false, error: body.error };
    const rows = Array.isArray(body.searchRecords) ? body.searchRecords : [];
    const byObject: Record<string, number> = {};
    for (const r of rows) {
      const t = r && typeof r === "object" ? ((r as { attributes?: { type?: unknown } }).attributes?.type ?? null) : null;
      if (typeof t === "string" && t) byObject[t] = (byObject[t] ?? 0) + 1;
    }
    return {
      ok: true,
      result: {
        total: typeof body.totalSize === "number" ? body.totalSize : rows.length,
        byObject,
        records: rows.slice(0, policyCaps().maxRows).map(stripAttrs),
      },
    };
  },
};

/** Mirrors the /api/salesforce/apex route schema - the route re-validates. */
const APEX_CATEGORIES = ["Db", "Workflow", "Validation", "Callout", "ApexCode", "ApexProfiling"] as const;

const apexRunArgs = z.object({
  code: z.string().min(1).max(8000).describe("Anonymous Apex block, e.g. System.debug('hi');"),
  logCategory: z.enum(APEX_CATEGORIES).optional().describe("Debug log category - default ApexCode"),
  logLevel: z.enum(LOG_LEVELS).optional().describe("Debug log level - default Debug"),
});

const apexRun: AgentTool = {
  name: "apex_run",
  orgTouch: true,
  description:
    "Execute an anonymous Apex block on the CONNECTED org (Workbench-style: debug log comes back inline). Executes ARBITRARY code as the connected user - use for exploration and diagnostics; DML only when the user explicitly asked for it. Always pauses for Apply. Requires a live connection.",
  parameters: {
    type: "object",
    properties: {
      code: { type: "string" },
      logCategory: { type: "string" },
      logLevel: { type: "string" },
    },
    required: ["code"],
    additionalProperties: false,
  },
  needsApproval: true,
  approvalHint: "Runs on the live org - code executes as your user",
  label: (args) => {
    const code = (args as z.infer<typeof apexRunArgs>).code ?? "";
    return `Run anonymous Apex (${code.length} chars)`;
  },
  schema: apexRunArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof apexRunArgs>;
    if (args.code.length > policyCaps().maxApexChars) {
      return { ok: false, error: `Code block is ${args.code.length} chars - the workspace cap is ${policyCaps().maxApexChars}. Split it and run in parts.` };
    }
    const session = liveSession();
    if (!isSession(session)) return { ok: false, error: session.error };
    let res: Response;
    try {
      res = await apiFetch(
        "/api/salesforce/apex",
        {
          instanceUrl: session.instanceUrl,
          token: session.token,
          apiVersion: session.apiVersion,
          code: args.code,
          logCategory: args.logCategory ?? "ApexCode",
          logLevel: args.logLevel ?? "Debug",
        },
        120000
      );
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Apex execution failed." };
    }
    if (res.status === 401) {
      try {
        markSessionExpired();
      } catch {
        /* gate flag alone still closes AI */
      }
      return { ok: false, error: "Salesforce session expired - reconnect on the Studio home, then ask again." };
    }
    let body: {
      ok?: boolean;
      error?: unknown;
      result?: {
        compiled?: boolean;
        success?: boolean;
        line?: number | null;
        column?: number | null;
        compileProblem?: string | null;
        exceptionMessage?: string | null;
        exceptionStackTrace?: string | null;
        debugLog?: string | null;
      };
    };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return { ok: false, error: `Apex execution failed (HTTP ${res.status}).` };
    }
    if (!res.ok) return { ok: false, error: errorMessage(body, `Apex execution failed (HTTP ${res.status}).`) };
    if (typeof body.error === "string" && body.error) return { ok: false, error: body.error };
    const r = body.result ?? {};
    const log = typeof r.debugLog === "string" ? r.debugLog : "";
    return {
      ok: true,
      result: {
        compiled: !!r.compiled,
        success: !!r.success,
        line: r.line ?? null,
        column: r.column ?? null,
        problem: r.compileProblem ?? r.exceptionMessage ?? null,
        stack: typeof r.exceptionStackTrace === "string" ? r.exceptionStackTrace.slice(0, 2000) : null,
        debugLog: log.length > policyCaps().maxLogChars ? `${log.slice(0, policyCaps().maxLogChars)}\n…(truncated, full log in the Apex panel)` : log,
      },
    };
  },
};

const describeArgs = z.object({
  objectName: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Object name must start with a letter and hold letters, digits, underscores.")
    .describe("sObject API name, e.g. Account or Invoice__c"),
});

const metadataDescribe: AgentTool = {
  name: "metadata_describe",
  orgTouch: true,
  description:
    "Describe one sObject on the CONNECTED org: label, custom flags, field list with API names, labels, types, required and custom flags, plus child relationships. Grounds architecture answers in live metadata - never schema from memory. Requires a live connection.",
  parameters: {
    type: "object",
    properties: { objectName: { type: "string" } },
    required: ["objectName"],
    additionalProperties: false,
  },
  needsApproval: false,
  label: (args) => `Describe ${(args as z.infer<typeof describeArgs>).objectName ?? "object"}`,
  schema: describeArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof describeArgs>;
    const session = liveSession();
    if (!isSession(session)) return { ok: false, error: session.error };
    let res: Response;
    try {
      res = await apiFetch(
        "/api/salesforce/describe",
        { instanceUrl: session.instanceUrl, token: session.token, apiVersion: session.apiVersion, objectName: args.objectName },
        60000
      );
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Describe request failed." };
    }
    if (res.status === 401) {
      try {
        markSessionExpired();
      } catch {
        /* gate flag alone still closes AI */
      }
      return { ok: false, error: "Salesforce session expired - reconnect on the Studio home, then ask again." };
    }
    let body: {
      error?: unknown;
      name?: string;
      label?: string;
      labelPlural?: string;
      custom?: boolean;
      createable?: boolean;
      updateable?: boolean;
      fields?: { name?: unknown; label?: unknown; type?: unknown; nillable?: unknown; custom?: unknown }[];
      childRelationships?: { childSObject?: unknown; relationshipName?: unknown }[];
    };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return { ok: false, error: `Describe failed (HTTP ${res.status}).` };
    }
    if (!res.ok) return { ok: false, error: errorMessage(body, `Describe failed (HTTP ${res.status}).`) };
    if (typeof body.error === "string" && body.error) return { ok: false, error: body.error };
    const fields = Array.isArray(body.fields) ? body.fields : [];
    const children = Array.isArray(body.childRelationships) ? body.childRelationships : [];
    return {
      ok: true,
      result: {
        object: typeof body.name === "string" ? body.name : args.objectName,
        label: body.label ?? null,
        plural: body.labelPlural ?? null,
        custom: body.custom === true,
        createable: body.createable === true,
        updateable: body.updateable === true,
        fieldCount: fields.length,
        fields: fields.slice(0, policyCaps().maxFields).map((f) => ({
          api: typeof f.name === "string" ? f.name : "?",
          label: typeof f.label === "string" ? f.label : null,
          type: typeof f.type === "string" ? f.type : "?",
          required: f.nillable === false,
          custom: f.custom === true,
        })),
        ...(fields.length > policyCaps().maxFields
          ? { note: `First ${policyCaps().maxFields} of ${fields.length} fields - ask for a specific field or run targeted SOQL.` }
          : {}),
        childCount: children.length,
        children: children
          .slice(0, 20)
          .map((c) => (typeof c.relationshipName === "string" && c.relationshipName ? `${c.relationshipName} (${String(c.childSObject ?? "?")})` : String(c.childSObject ?? "?"))),
      },
    };
  },
};

export const SALESFORCE_TOOLS: AgentTool[] = [soqlRun, soslRun, toolingRun, metadataDescribe, apexRun];
