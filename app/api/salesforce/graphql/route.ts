import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSalesforceUrl } from "@/lib/salesforce/url";
import { sfTimeoutSignal, isAbortError, sfTimeoutMessage } from "@/lib/salesforce/client";

const schema = z.object({
  instanceUrl: z.string().min(1),
  token: z.string().min(1),
  apiVersion: z.string().min(1),
  // Salesforce GraphQL is query-only - reject mutations defense-in-depth.
  query: z
    .string()
    .min(1)
    .max(25000)
    .refine((q) => !/\bmutation\b/i.test(q), "Only queries are supported - mutations are rejected"),
});

const SAFE_RESPONSE_HEADERS = new Set([
  "content-type",
  "x-sfdc-request-id",
  "x-restforce-limit-info",
  "sforce-limit-info",
  "date",
]);

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

  const { instanceUrl, token, apiVersion, query } = parsed.data;

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeSalesforceUrl(instanceUrl);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid instance URL" },
      { status: 400 }
    );
  }

  const ver = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
  const endpoint = `${normalizedUrl}/services/data/${ver}/graphql`;

  const startTime = Date.now();
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query }),
      signal: sfTimeoutSignal(),
    });
  } catch (err) {
    if (isAbortError(err)) {
      return NextResponse.json({ error: sfTimeoutMessage(), success: false }, { status: 504 });
    }
    return NextResponse.json(
      {
        error: `Network error: ${err instanceof Error ? err.message : "unknown"}`,
        success: false,
      },
      { status: 502 }
    );
  }

  const responseTime = Date.now() - startTime;

  // Filter headers - never expose Authorization or sensitive headers
  const safeHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (SAFE_RESPONSE_HEADERS.has(key.toLowerCase())) {
      safeHeaders[key] = value;
    }
  });

  let responseBody: unknown;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }
  } else {
    responseBody = await response.text();
  }

  return NextResponse.json({
    success: response.ok,
    status: response.status,
    statusText: response.statusText,
    responseTime,
    body: responseBody,
    headers: safeHeaders,
    endpoint,
  });
}
