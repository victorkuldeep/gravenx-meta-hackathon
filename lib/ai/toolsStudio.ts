import { z } from "zod";
import { buildSearchUrl, looksLikeSosl } from "@/lib/salesforce/sosl";
import { listSnapshotsByOrg } from "@/lib/erd/snapshotDb";
import type { AgentTool } from "./tools";

/**
 * Studio packs for tabs without a live canvas bridge (Phase 3).
 * All headless and read-only: SOSL drafting over existing lib helpers,
 * ERD snapshot listing from IDB, and JSON structural inspection of
 * pasted content. Mapping/Validate/Draw/Architect/Contracts stay in
 * advisor mode until their bridges exist.
 */

const soslArgs = z.object({
  sosl: z.string().min(1).max(4000).describe("Full SOSL statement, e.g. {Acme} FIND ..."),
  instanceUrl: z.string().optional().describe("Org instance URL - only needed to build the runnable /search URL"),
  apiVersion: z.string().optional().describe("API version like v60.0 - only needed with instanceUrl"),
});

const soslBuild: AgentTool = {
  name: "query_sosl_build",
  description: "Validate a SOSL statement and, when an org instance URL is given, build the runnable /search REST URL. Read-only - never executes.",
  parameters: {
    type: "object",
    properties: {
      sosl: { type: "string" },
      instanceUrl: { type: "string" },
      apiVersion: { type: "string" },
    },
    required: ["sosl"],
    additionalProperties: false,
  },
  needsApproval: false,
  label: () => "Validate SOSL",
  schema: soslArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof soslArgs>;
    const statement = args.sosl.trim();
    if (!looksLikeSosl(statement)) {
      return { ok: false, error: "That does not look like SOSL - it should start with FIND {term} and name RETURNING objects." };
    }
    if (args.instanceUrl?.trim()) {
      const host = args.instanceUrl.trim().replace(/\/+$/, "");
      if (!/^https:\/\/[a-z0-9.-]+$/i.test(host)) {
        return { ok: false, error: "instanceUrl must be a plain https origin (no paths, no tokens)." };
      }
      const version = (args.apiVersion?.trim() || "v60.0").replace(/^v?/, "v");
      return { ok: true, result: { valid: true, searchUrl: buildSearchUrl(host, version, statement) } };
    }
    return { ok: true, result: { valid: true, hint: "Pass instanceUrl + apiVersion and I will build the runnable /search URL." } };
  },
};

const snapArgs = z.object({
  orgDomain: z.string().min(1).max(200).describe("Org hostname snapshots were saved under, e.g. myorg.my.salesforce.com"),
});

const erdSnapshots: AgentTool = {
  name: "erd_snapshots",
  description: "List saved ERD snapshots for one org: names, root object, node counts and saved dates. Read-only.",
  parameters: {
    type: "object",
    properties: { orgDomain: { type: "string" } },
    required: ["orgDomain"],
    additionalProperties: false,
  },
  needsApproval: false,
  label: () => "List ERD snapshots",
  schema: snapArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof snapArgs>;
    let snaps;
    try {
      snaps = await listSnapshotsByOrg(args.orgDomain.trim());
    } catch {
      return { ok: false, error: "Snapshot store is unavailable here - open the studio in a browser to list snapshots." };
    }
    if (snaps.length === 0) return { ok: true, result: "No snapshots for that org yet." };
    return {
      ok: true,
      result: snaps.map((s) => ({
        name: s.name,
        root: s.root,
        objects: s.nodes.length,
        savedAt: new Date(s.createdAt).toISOString(),
      })),
    };
  },
};

const MAX_INSPECT_CHARS = 200000;

const inspectArgs = z.object({
  json: z.string().min(1).max(MAX_INSPECT_CHARS).describe("Raw JSON document text"),
  maxDepth: z.number().int().min(1).max(12).optional().describe("Key census depth - default 3"),
});

interface Census {
  nodes: number;
  maxDepth: number;
  keysByDepth: Record<string, string[]>;
}

function censusOf(value: unknown, depth: number, maxDepth: number, out: Census): void {
  out.nodes++;
  out.maxDepth = Math.max(out.maxDepth, depth);
  if (Array.isArray(value)) {
    for (const v of value.slice(0, 50)) {
      if (v !== null && typeof v === "object") censusOf(v, depth + 1, maxDepth, out);
      else out.nodes++;
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (depth <= maxDepth) {
      const bucket = out.keysByDepth[String(depth)] ?? [];
      for (const k of keys) if (!bucket.includes(k) && bucket.length < 60) bucket.push(k);
      out.keysByDepth[String(depth)] = bucket;
    }
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (v !== null && typeof v === "object") censusOf(v, depth + 1, maxDepth, out);
      else out.nodes++;
    }
  }
}

const jsonInspect: AgentTool = {
  name: "json_inspect",
  description: "Parse pasted JSON and report structure: node count, depth, array sizes and the key census per level. Read-only - content never stored.",
  parameters: {
    type: "object",
    properties: {
      json: { type: "string" },
      maxDepth: { type: "number" },
    },
    required: ["json"],
    additionalProperties: false,
  },
  needsApproval: false,
  label: () => "Inspect JSON structure",
  schema: inspectArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof inspectArgs>;
    let value: unknown;
    try {
      value = JSON.parse(args.json) as unknown;
    } catch (e) {
      return { ok: false, error: `Invalid JSON: ${e instanceof Error ? e.message : "parse error"}` };
    }
    const out: Census = { nodes: 0, maxDepth: 0, keysByDepth: {} };
    censusOf(value, 0, args.maxDepth ?? 3, out);
    const top = Array.isArray(value) ? { kind: "array", length: value.length } : { kind: typeof value, keys: value && typeof value === "object" ? Object.keys(value).length : 0 };
    return { ok: true, result: { top, totalNodes: out.nodes, maxDepth: out.maxDepth, keysByDepth: out.keysByDepth } };
  },
};

const soqlArgs = z.object({
  soql: z.string().min(1).max(10000).describe("Full SOQL statement, e.g. SELECT Id FROM Account LIMIT 10"),
  instanceUrl: z.string().optional().describe("Org instance URL - only needed to build the runnable /query URL"),
  apiVersion: z.string().optional().describe("API version like v60.0 - only needed with instanceUrl"),
});

export function looksLikeSoql(statement: string): boolean {
  const s = statement.trim();
  return /^\s*select\b/i.test(s) && /\bfrom\s+[a-z0-9_]+/i.test(s);
}

const soqlBuild: AgentTool = {
  name: "query_soql_build",
  description: "Validate a SOQL statement shape (SELECT ... FROM <Object>) and, when an org instance URL is given, build the runnable /query REST URL. Read-only - never executes.",
  parameters: {
    type: "object",
    properties: {
      soql: { type: "string" },
      instanceUrl: { type: "string" },
      apiVersion: { type: "string" },
    },
    required: ["soql"],
    additionalProperties: false,
  },
  needsApproval: false,
  label: () => "Validate SOQL",
  schema: soqlArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof soqlArgs>;
    const statement = args.soql.trim();
    if (!looksLikeSoql(statement)) {
      return { ok: false, error: "That does not look like SOQL - it should read SELECT <fields> FROM <Object>." };
    }
    if (args.instanceUrl?.trim()) {
      const host = args.instanceUrl.trim().replace(/\/+$/, "");
      if (!/^https:\/\/[a-z0-9.-]+$/i.test(host)) {
        return { ok: false, error: "instanceUrl must be a plain https origin (no paths, no tokens)." };
      }
      const version = (args.apiVersion?.trim() || "v60.0").replace(/^v?/, "v");
      return { ok: true, result: { valid: true, queryUrl: `${host}/services/data/${version}/query?q=${encodeURIComponent(statement)}` } };
    }
    return { ok: true, result: { valid: true, hint: "Pass instanceUrl + apiVersion and I will build the runnable /query URL." } };
  },
};

export const STUDIO_TOOLS: AgentTool[] = [soslBuild, soqlBuild, erdSnapshots];
export const JSON_TOOLS: AgentTool[] = [jsonInspect];
