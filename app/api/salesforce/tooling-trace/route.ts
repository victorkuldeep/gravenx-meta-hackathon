import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSalesforceUrl } from "@/lib/salesforce/url";
import { sfFetch, sfFetchVersioned, sfTimeoutSignal, isAbortError, sfTimeoutMessage } from "@/lib/salesforce/client";
import { SalesforceApiError } from "@/lib/salesforce/types";
import { isDeletableSobject, isToolingSobject, isWritableSobject } from "@/lib/log-decomposer/tooling";

/**
 * POST-only Tooling API proxy for Log Decomposer capture.
 * Scoped to tracing setup/teardown + read-only discovery:
 * - query: Tooling SOQL over the allowlisted sobjects
 * - create/update: TraceFlag + DebugLevel only
 * - delete: TraceFlag + DebugLevel, plus ApexLog (ephemeral by nature)
 * Token arrives in the POST body, never in a URL; the instance URL is
 * normalized and every path is rebuilt server-side (no client paths).
 */

const bodySchema = z.object({
  instanceUrl: z.string().min(1),
  token: z.string().min(1),
  apiVersion: z.string().min(1),
  op: z.enum(["query", "create", "update", "delete"]),
  sobject: z.string().min(1),
  soql: z.string().min(1).max(20000).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  id: z.string().max(25).optional(),
});

function errorResponse(err: unknown) {
  if (err instanceof SalesforceApiError) {
    return NextResponse.json({ error: err.message, success: false }, { status: err.statusCode || 502 });
  }
  if (isAbortError(err)) {
    return NextResponse.json({ error: sfTimeoutMessage(), success: false }, { status: 504 });
  }
  return NextResponse.json(
    { error: `Network error: ${err instanceof Error ? err.message : "unknown"}`, success: false },
    { status: 502 }
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { instanceUrl, token, apiVersion, op, sobject, soql, fields, id } = parsed.data;

  if (!isToolingSobject(sobject)) {
    return NextResponse.json({ error: `Unsupported Tooling sobject: ${sobject}`, success: false }, { status: 400 });
  }
  if (op !== "query" && !isWritableSobject(sobject) && !(op === "delete" && isDeletableSobject(sobject))) {
    return NextResponse.json({ error: `${sobject} is read-only through this proxy.`, success: false }, { status: 400 });
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeSalesforceUrl(instanceUrl);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid instance URL" }, { status: 400 });
  }
  try {
    if (op === "query") {
      if (!soql) return NextResponse.json({ error: "soql is required for query.", success: false }, { status: 400 });
      const ver = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
      const data = await sfFetch<{ records?: unknown[]; totalSize?: number; done?: boolean }>(
        `${normalizedUrl}/services/data/${ver}/tooling/query?q=${encodeURIComponent(soql)}`,
        token,
        { signal: sfTimeoutSignal() }
      );
      return NextResponse.json({ success: true, records: Array.isArray(data.records) ? data.records : [], totalSize: data.totalSize ?? 0 });
    }

    if (op === "create") {
      if (!fields) return NextResponse.json({ error: "fields are required for create.", success: false }, { status: 400 });
      const data = await sfFetchVersioned<{ id: string; success: boolean }>(instanceUrl, token, apiVersion, `/tooling/sobjects/${sobject}`, {
        method: "POST",
        body: fields,
        signal: sfTimeoutSignal(),
      });
      return NextResponse.json({ success: true, id: data.id });
    }

    if (!id) return NextResponse.json({ error: "id is required for update/delete.", success: false }, { status: 400 });
    if (op === "update") {
      await sfFetchVersioned(instanceUrl, token, apiVersion, `/tooling/sobjects/${sobject}/${id}`, {
        method: "PATCH",
        body: fields ?? {},
        signal: sfTimeoutSignal(),
      });
      return NextResponse.json({ success: true });
    }

    await sfFetchVersioned(instanceUrl, token, apiVersion, `/tooling/sobjects/${sobject}/${id}`, {
      method: "DELETE",
      signal: sfTimeoutSignal(),
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
