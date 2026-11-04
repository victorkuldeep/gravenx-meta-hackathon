import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSalesforceUrl } from "@/lib/salesforce/url";
import { sfTimeoutSignal, isAbortError, sfTimeoutMessage } from "@/lib/salesforce/client";
import { buildSearchUrl } from "@/lib/salesforce/sosl";

const schema = z.object({
  instanceUrl: z.string().min(1),
  token: z.string().min(1),
  apiVersion: z.string().min(1),
  sosl: z.string().min(1).max(20000),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { instanceUrl, token, apiVersion, sosl } = parsed.data;

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeSalesforceUrl(instanceUrl);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid instance URL" },
      { status: 400 }
    );
  }

  const url = buildSearchUrl(normalizedUrl, apiVersion, sosl);
  const startTime = Date.now();

  try {
    // Search returns one page (searchRecords) - no pagination loop needed.
    const response: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: sfTimeoutSignal(),
    });
    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const errBody = (await response.json()) as Array<{ message: string }> | { message: string };
        const first = Array.isArray(errBody) ? errBody[0] : errBody;
        if (first?.message) message = first.message;
      } catch {
        /* ignore */
      }
      return NextResponse.json({ error: message }, { status: response.status });
    }
    const page = (await response.json()) as { searchRecords?: unknown[] };
    const searchRecords = Array.isArray(page.searchRecords) ? page.searchRecords : [];
    return NextResponse.json({
      success: true,
      searchRecords,
      totalSize: searchRecords.length,
      responseTime: Date.now() - startTime,
    });
  } catch (err) {
    if (isAbortError(err)) {
      return NextResponse.json({ error: sfTimeoutMessage(), success: false }, { status: 504 });
    }
    return NextResponse.json(
      { error: `Network error: ${err instanceof Error ? err.message : "unknown"}`, success: false },
      { status: 502 }
    );
  }
}
