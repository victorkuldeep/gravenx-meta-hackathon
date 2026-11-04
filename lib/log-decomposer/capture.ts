import { apiFetch } from "@/lib/api";
import {
  apexLogListSoql,
  debugLevelListSoql,
  debugLevelPayload,
  defaultExpirationIso,
  guessTargetKind,
  parseTraceTargetRows,
  traceTargetSearchSoql,
  type TraceTargetRow,
  parseApexLogRows,
  parseDebugLevelRows,
  parseTraceFlagRows,
  traceFlagListSoql,
  traceFlagPayload,
  type ApexLogRow,
  type TraceFlagRow,
  type TracePreset,
} from "./tooling";

/**
 * Typed client for Log Decomposer capture. Calls the same-origin
 * tooling-trace + apex-log proxies; the caller supplies instanceUrl +
 * token from the live Salesforce connection (server never sees a token
 * except inside the POST body). fetchImpl is injectable for tests.
 */

export interface SfConnection {
  instanceUrl: string;
  token: string;
  apiVersion: string;
}

type FetchImpl = typeof fetch;

/**
 * Ride the shared apiFetch rails (timeout + abort) instead of raw fetch.
 * The capture functions stay fetchImpl-injectable for tests.
 */
export function viaApiFetch(timeoutMs = 60000): FetchImpl {
  return (input, init) => apiFetch(String(input), JSON.parse(String(init?.body ?? "{}")), timeoutMs);
}

async function postJson<T>(path: string, payload: unknown, fetchImpl: FetchImpl): Promise<T> {
  const res = await fetchImpl(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string; success?: boolean }) | null;
  if (!res.ok || !data || data.success === false) {
    throw new Error(data && typeof data.error === "string" ? data.error : `Capture request failed (${res.status}).`);
  }
  return data;
}

async function toolingQuery(conn: SfConnection, sobject: string, soql: string, fetchImpl: FetchImpl): Promise<unknown[]> {
  const data = await postJson<{ records: unknown[] }>(
    "/api/salesforce/tooling-trace",
    { instanceUrl: conn.instanceUrl, token: conn.token, apiVersion: conn.apiVersion, op: "query", sobject, soql },
    fetchImpl
  );
  return Array.isArray(data.records) ? data.records : [];
}

export async function listApexLogs(conn: SfConnection, limit = 25, fetchImpl: FetchImpl = fetch): Promise<ApexLogRow[]> {
  const records = await toolingQuery(conn, "ApexLog", apexLogListSoql(limit), fetchImpl);
  return parseApexLogRows(records);
}

export async function getApexLogBody(
  conn: SfConnection,
  id: string,
  fetchImpl: FetchImpl = fetch
): Promise<{ body: string; truncated: boolean }> {
  const data = await postJson<{ body: string; truncated: boolean }>("/api/salesforce/apex-log", {
    instanceUrl: conn.instanceUrl,
    token: conn.token,
    apiVersion: conn.apiVersion,
    op: "body",
    id,
  }, fetchImpl);
  return { body: data.body ?? "", truncated: data.truncated === true };
}

const TARGET_SOBJECT = { user: "User", class: "ApexClass", trigger: "ApexTrigger" } as const;

/** Search traceable targets by name - powers the picker so nobody pastes raw ids. */
export async function searchTraceTargets(
  conn: SfConnection,
  kind: "user" | "class" | "trigger",
  query: string,
  fetchImpl: FetchImpl = fetch
): Promise<TraceTargetRow[]> {
  if (!query.trim()) return [];
  const records = await toolingQuery(conn, TARGET_SOBJECT[kind], traceTargetSearchSoql(kind, query), fetchImpl);
  return parseTraceTargetRows(kind, records);
}

/** Create a DebugLevel for the preset; returns the new id. */
export async function createDebugLevel(conn: SfConnection, preset: TracePreset, fetchImpl: FetchImpl = fetch): Promise<string> {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const data = await postJson<{ id: string }>("/api/salesforce/tooling-trace", {
    instanceUrl: conn.instanceUrl,
    token: conn.token,
    apiVersion: conn.apiVersion,
    op: "create",
    sobject: "DebugLevel",
    fields: debugLevelPayload(`GRAVENX_${preset}_${stamp}`, `GRAVENX ${preset} ${stamp}`, preset),
  }, fetchImpl);
  if (!data.id) throw new Error("Salesforce did not return a DebugLevel id.");
  return data.id;
}

/** Point a TraceFlag at the target; returns the flag id. */
export async function setTraceFlag(
  conn: SfConnection,
  tracedEntityId: string,
  debugLevelId: string,
  expirationIso = defaultExpirationIso(),
  fetchImpl: FetchImpl = fetch
): Promise<string> {
  const data = await postJson<{ id: string }>("/api/salesforce/tooling-trace", {
    instanceUrl: conn.instanceUrl,
    token: conn.token,
    apiVersion: conn.apiVersion,
    op: "create",
    sobject: "TraceFlag",
    fields: traceFlagPayload(tracedEntityId, debugLevelId, expirationIso),
  }, fetchImpl);
  if (!data.id) throw new Error("Salesforce did not return a TraceFlag id.");
  return data.id;
}

export type { TraceTargetRow } from "./tooling";

export interface OrgTraceFlag extends TraceFlagRow {
  /** Resolved level label, or the raw id when unknown. */
  debugLevelName: string;
  targetKind: "user" | "class" | "trigger" | "other";
  /** True when this studio session created it (same tab vault, same id). */
  ours: boolean;
}

/** Resolve user ids to display names for the logs table (one bounded query). */
export async function resolveUserNames(
  conn: SfConnection,
  ids: string[],
  fetchImpl: FetchImpl = fetch
): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter((id) => /^[a-zA-Z0-9]{15,18}$/.test(id)))].slice(0, 50);
  if (uniq.length === 0) return {};
  const list = uniq.map((id) => `'${id}'`).join(",");
  const records = await toolingQuery(conn, "User", `SELECT Id, Name FROM User WHERE Id IN (${list})`, fetchImpl);
  const out: Record<string, string> = {};
  for (const r of records) {
    if (typeof r === "object" && r !== null) {
      const o = r as Record<string, unknown>;
      if (typeof o.Id === "string" && typeof o.Name === "string") out[o.Id] = o.Name;
    }
  }
  return out;
}

/** Delete a log from the org (logs are ephemeral; Setup does the same in one click). */
export async function deleteApexLog(conn: SfConnection, id: string, fetchImpl: FetchImpl = fetch): Promise<void> {
  if (!/^[a-zA-Z0-9]{15,18}$/.test(id)) throw new Error("Invalid ApexLog id.");
  await postJson("/api/salesforce/tooling-trace", {
    instanceUrl: conn.instanceUrl,
    token: conn.token,
    apiVersion: conn.apiVersion,
    op: "delete",
    sobject: "ApexLog",
    id,
  }, fetchImpl);
}

/** Who owns this token - powers the one-click "trace me" tab. */
export async function getMyIdentity(
  conn: SfConnection,
  fetchImpl: FetchImpl = fetch
): Promise<{ userId: string; username: string | null; name: string | null }> {
  const data = await postJson<{ success?: boolean; userId?: string; username?: string | null; name?: string | null; error?: string }>(
    "/api/salesforce/me",
    { instanceUrl: conn.instanceUrl, token: conn.token },
    fetchImpl
  );
  if (!data.success || !data.userId || !/^[a-zA-Z0-9]{15,18}$/.test(data.userId)) {
    throw new Error(typeof data.error === "string" ? data.error : "Could not resolve the logged-in user.");
  }
  return { userId: data.userId, username: data.username ?? null, name: data.name ?? null };
}

/**
 * Every TraceFlag on the org - Dev Console, Setup, other sessions, ours.
 * Level names resolve through a second bounded query; unknown ids fall
 * back to the raw DebugLevel id so a row never renders blank.
 *
 * ownFlagId accepts one id or many - multi-target sessions mark every
 * flag they created. Kept backward compatible with a single id.
 */
export async function listOrgTraceFlags(
  conn: SfConnection,
  ownFlagId: string | string[] | undefined,
  fetchImpl: FetchImpl = fetch
): Promise<OrgTraceFlag[]> {
  const [flagRecords, levelRecords] = await Promise.all([
    toolingQuery(conn, "TraceFlag", traceFlagListSoql(), fetchImpl),
    toolingQuery(conn, "DebugLevel", debugLevelListSoql(), fetchImpl),
  ]);
  const names = parseDebugLevelRows(levelRecords);
  const now = Date.now();
  const ours = new Set(Array.isArray(ownFlagId) ? ownFlagId : ownFlagId ? [ownFlagId] : []);
  return parseTraceFlagRows(flagRecords)
    .filter((f) => !f.ExpirationDate || new Date(f.ExpirationDate).getTime() > now - 60 * 60 * 1000)
    .map((f) => ({
      ...f,
      debugLevelName: names.get(f.DebugLevelId) ?? f.DebugLevelId,
      targetKind: guessTargetKind(f.TracedEntityId),
      ours: ours.has(f.Id),
    }));
}

/** Remove a TraceFlag; teardown after capture. */
export async function clearTraceFlag(conn: SfConnection, flagId: string, fetchImpl: FetchImpl = fetch): Promise<void> {
  await postJson("/api/salesforce/tooling-trace", {
    instanceUrl: conn.instanceUrl,
    token: conn.token,
    apiVersion: conn.apiVersion,
    op: "delete",
    sobject: "TraceFlag",
    id: flagId,
  }, fetchImpl);
}
