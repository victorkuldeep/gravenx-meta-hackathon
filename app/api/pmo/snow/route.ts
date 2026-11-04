import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAbortError, sfTimeoutMessage, sfTimeoutSignal } from "@/lib/salesforce/client";
import { normalizeSnowInstance, normalizeSnowTable } from "@/lib/pmo/snow";

/**
 * POST /api/pmo/snow - ServiceNow Table API through our worker.
 * Username + password are forwarded per request - never stored, never
 * logged. Target is pinned to *.service-now.com (validated here again
 * even though the client pre-validates).
 *
 * Actions: probe (GET one row - table exists + sample fields),
 * create (POST the record - number + deep link come back).
 */

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** ASCII-safe Basic credential - btoa alone throws on non-latin1 input. */
function basicAuth(user: string, pass: string): string {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
}

const credsSchema = z.object({
  instance: z.string().min(1).max(200),
  user: z.string().min(1).max(320),
  pass: z.string().min(1).max(2000),
});

const tableSchema = z.object({ table: z.string().min(1).max(80) });

const createSchema = credsSchema.extend({
  table: z.string().min(1).max(80),
  fields: z.record(z.string().max(80), z.unknown()),
});

function errorMessage(status: number, fallback: string): string {
  if (status === 401 || status === 403) return "ServiceNow rejected the credentials (401/403) - check user + password, and the rest_service role.";
  if (status === 404) return "Table not found (404) - check the table name on this instance.";
  if (status === 400) return "ServiceNow refused the payload (400) - a mandatory field may be missing on this table.";
  return fallback;
}

function resolveTarget(instance: string, table: string): string | null {
  const i = normalizeSnowInstance(instance);
  const t = normalizeSnowTable(table);
  if (!i.ok || !t.ok) return null;
  return `${i.instance}/api/now/table/${t.table}`;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid JSON body.");
  const b = body as Record<string, unknown>;
  const action = b.action;

  if (action === "probe") {
    const parsed = credsSchema.merge(tableSchema).safeParse(b);
    if (!parsed.success) return fail("Instance, user, password and table are required.");
    const target = resolveTarget(parsed.data.instance, parsed.data.table);
    if (!target) return fail("Only *.service-now.com instances and plain table names are supported.");
    const { user, pass } = parsed.data;
    let res: Response;
    try {
      res = await fetch(`${target}?sysparm_limit=1&sysparm_display_value=false`, {
        headers: { Authorization: basicAuth(user, pass), Accept: "application/json" },
        signal: sfTimeoutSignal(),
      });
    } catch (e) {
      return fail(isAbortError(e) ? sfTimeoutMessage() : "ServiceNow unreachable from the worker.", 502);
    }
    if (!res.ok) return fail(errorMessage(res.status, `ServiceNow answered ${res.status}.`), 502);
    const json: unknown = await res.json().catch(() => null);
    const rows = (json as { result?: unknown }).result;
    const first = Array.isArray(rows) ? rows[0] : null;
    const sampleFields =
      first && typeof first === "object" && !Array.isArray(first) ? Object.keys(first).slice(0, 24) : [];
    return NextResponse.json({ ok: true, table: parsed.data.table, sampleFields });
  }

  if (action === "get") {
    const parsed = credsSchema
      .merge(tableSchema)
      .extend({ number: z.string().min(1).max(64) })
      .safeParse(b);
    if (!parsed.success) return fail("Instance, user, password, table and record number are required.");
    const target = resolveTarget(parsed.data.instance, parsed.data.table);
    if (!target) return fail("Only *.service-now.com instances and plain table names are supported.");
    const { user, pass } = parsed.data;
    let res: Response;
    try {
      const url = `${target}?number=${encodeURIComponent(parsed.data.number.trim())}&sysparm_limit=1&sysparm_display_value=false`;
      res = await fetch(url, {
        headers: { Authorization: basicAuth(user, pass), Accept: "application/json" },
        signal: sfTimeoutSignal(),
      });
    } catch (e) {
      return fail(isAbortError(e) ? sfTimeoutMessage() : "ServiceNow unreachable from the worker.", 502);
    }
    if (!res.ok) return fail(errorMessage(res.status, `ServiceNow answered ${res.status}.`), 502);
    const json: unknown = await res.json().catch(() => null);
    const rows = (json as { result?: unknown }).result;
    const record = Array.isArray(rows) ? rows[0] : null;
    if (!record || typeof record !== "object") return fail(`Record ${parsed.data.number.trim()} not found in ${parsed.data.table}.`, 502);
    return NextResponse.json({ ok: true, record });
  }

  if (action === "create") {
    const parsed = createSchema.safeParse(b);
    if (!parsed.success) return fail("Instance, user, password, table and fields are required.");
    const target = resolveTarget(parsed.data.instance, parsed.data.table);
    if (!target) return fail("Only *.service-now.com instances and plain table names are supported.");
    const { user, pass } = parsed.data;
    let res: Response;
    try {
      res = await fetch(target, {
        method: "POST",
        headers: {
          Authorization: basicAuth(user, pass),
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(parsed.data.fields),
        signal: sfTimeoutSignal(),
      });
    } catch (e) {
      return fail(isAbortError(e) ? sfTimeoutMessage() : "ServiceNow unreachable from the worker.", 502);
    }
    if (!res.ok) return fail(errorMessage(res.status, `ServiceNow answered ${res.status}.`), 502);
    const json: unknown = await res.json().catch(() => null);
    const result = (json as { result?: { number?: unknown; sys_id?: unknown } }).result;
    const number = typeof result?.number === "string" ? result.number : "";
    const sysId = typeof result?.sys_id === "string" ? result.sys_id : "";
    if (!number || !sysId) return fail("ServiceNow answered without a record number.", 502);
    const inst = normalizeSnowInstance(parsed.data.instance);
    const base = inst.ok ? inst.instance : "";
    return NextResponse.json({ ok: true, number, url: `${base}/nav_to.do?uri=${parsed.data.table}.do?sys_id=${sysId}` });
  }
  return fail("Unknown action.");
}
