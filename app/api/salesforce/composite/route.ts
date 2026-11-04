import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSalesforceUrl } from "@/lib/salesforce/url";
import { sfTimeoutSignal, isAbortError, sfTimeoutMessage } from "@/lib/salesforce/client";

const compositeRequestItemSchema = z.object({
  method: z.enum(["POST", "PATCH", "GET", "DELETE"]),
  url: z.string().min(1),
  referenceId: z.string().min(1),
  body: z.record(z.string(), z.unknown()).optional(),
});

const schema = z.object({
  instanceUrl: z.string().min(1),
  token: z.string().min(1),
  apiVersion: z.string().min(1),
  allOrNone: z.boolean(),
  compositeRequest: z.array(compositeRequestItemSchema).min(1).max(25),
});

const SAFE_RESPONSE_HEADERS = new Set([
  "content-type",
  "x-sfdc-request-id",
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

  const { instanceUrl, token, apiVersion, allOrNone, compositeRequest } = parsed.data;

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
  const endpoint = `${normalizedUrl}/services/data/${ver}/composite`;

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
      body: JSON.stringify({ allOrNone, compositeRequest }),
      signal: sfTimeoutSignal(),
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

  const responseTime = Date.now() - startTime;

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
  });
}
