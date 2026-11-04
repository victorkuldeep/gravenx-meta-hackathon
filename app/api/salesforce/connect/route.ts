import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSalesforceUrl } from "@/lib/salesforce/url";
import { sfTimeoutSignal, isAbortError, sfTimeoutMessage } from "@/lib/salesforce/client";

const connectSchema = z.object({
  instanceUrl: z.string().min(1, "Instance URL is required"),
  token: z.string().min(1, "Access token is required"),
  apiVersion: z.string().min(1, "API version is required"),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { instanceUrl, token, apiVersion } = parsed.data;

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
  const url = `${normalizedUrl}/services/data/${ver}/sobjects/`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: sfTimeoutSignal(),
    });
  } catch (err) {
    if (isAbortError(err)) {
      return NextResponse.json({ error: sfTimeoutMessage() }, { status: 504 });
    }
    return NextResponse.json(
      { error: `Network error: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 }
    );
  }

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const errBody = (await response.json()) as
        | Array<{ message: string; errorCode: string }>
        | { message: string; errorCode: string };
      const first = Array.isArray(errBody) ? errBody[0] : errBody;
      if (first?.message) message = first.message;
    } catch {
      /* ignore */
    }

    if (response.status === 401) {
      return NextResponse.json(
        { error: "401 Unauthorized - the access token may be expired or invalid." },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: message }, { status: response.status });
  }

  try {
    const data = (await response.json()) as { sobjects?: unknown[] };
    return NextResponse.json({
      success: true,
      objectCount: data.sobjects?.length ?? 0,
    });
  } catch {
    return NextResponse.json({ error: "Failed to parse Salesforce response" }, { status: 502 });
  }
}
