import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSalesforceUrl } from "@/lib/salesforce/url";
import { isAbortError, sfTimeoutMessage, sfTimeoutSignal } from "@/lib/salesforce/client";
import { SalesforceApiError } from "@/lib/salesforce/types";
import { MAX_RAW_BYTES } from "@/lib/log-decomposer/model";

/**
 * POST-only ApexLog proxy for Log Decomposer capture.
 * - list: Tooling query for ApexLog rows (bounded server-side, max 100).
 * - body: raw log text for one ApexLog id, capped at MAX_RAW_BYTES.
 * Token arrives in the POST body, never in a URL; the Body path is
 * rebuilt server-side from the validated id (no client paths).
 */

const bodySchema = z.object({
  instanceUrl: z.string().min(1),
  token: z.string().min(1),
  apiVersion: z.string().min(1),
  op: z.enum(["list", "body"]),
  soql: z.string().min(1).max(20000).optional(),
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

  const { instanceUrl, token, apiVersion, op, soql, id } = parsed.data;

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeSalesforceUrl(instanceUrl);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Invalid instance URL" }, { status: 400 });
  }
  const ver = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };

  try {
    if (op === "list") {
      if (!soql) return NextResponse.json({ error: "soql is required for list.", success: false }, { status: 400 });
      const res = await fetch(`${normalizedUrl}/services/data/${ver}/tooling/query?q=${encodeURIComponent(soql)}`, {
        headers,
        signal: sfTimeoutSignal(),
      });
      if (!res.ok) {
        let message = `${res.status} ${res.statusText}`;
        try {
          const errBody = (await res.json()) as Array<{ message: string }> | { message: string };
          const first = Array.isArray(errBody) ? errBody[0] : errBody;
          if (first?.message) message = first.message;
        } catch {
          /* ignore */
        }
        throw new SalesforceApiError(message, res.status);
      }
      const data = (await res.json()) as { records?: unknown[]; totalSize?: number };
      return NextResponse.json({ success: true, records: Array.isArray(data.records) ? data.records : [], totalSize: data.totalSize ?? 0 });
    }

    if (!id) return NextResponse.json({ error: "id is required for body.", success: false }, { status: 400 });
    if (!/^[a-zA-Z0-9]{15,18}$/.test(id)) {
      return NextResponse.json({ error: "Invalid ApexLog id.", success: false }, { status: 400 });
    }
    const res = await fetch(`${normalizedUrl}/services/data/${ver}/tooling/sobjects/ApexLog/${id}/Body`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: sfTimeoutSignal(),
    });
    if (!res.ok) {
      throw new SalesforceApiError(`Log body unavailable: ${res.status} ${res.statusText}`, res.status);
    }
    const text = await res.text();
    const truncated = text.length > MAX_RAW_BYTES;
    return NextResponse.json({ success: true, body: truncated ? text.slice(0, MAX_RAW_BYTES) : text, truncated });
  } catch (err) {
    return errorResponse(err);
  }
}
