import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSalesforceUrl } from "@/lib/salesforce/url";
import { sfTimeoutSignal, isAbortError, sfTimeoutMessage } from "@/lib/salesforce/client";

const schema = z.object({
  instanceUrl: z.string().min(1),
  token: z.string().min(1),
  apiVersion: z.string().min(1),
  soql: z.string().min(1).max(20000),
});

export interface QueryPlanNote {
  fields?: string[];
  /** Dev Console / explain API uses `description`; tolerate legacy `text`. */
  description?: string;
  text?: string;
  tableEnumOrId?: string;
}

export interface QueryPlan {
  cardinality: number | null;
  fields?: string[];
  leadingOperationType: string;
  relativeCost: number;
  sobjectCardinality: number;
  sobjectType: string;
  notes: QueryPlanNote[];
}

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

  const { instanceUrl, token, apiVersion, soql } = parsed.data;

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
  const url = `${normalizedUrl}/services/data/${ver}/query/?explain=${encodeURIComponent(soql)}`;

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
      return NextResponse.json({ error: sfTimeoutMessage(), success: false }, { status: 504 });
    }
    return NextResponse.json(
      { error: `Network error: ${err instanceof Error ? err.message : "unknown"}`, success: false },
      { status: 502 }
    );
  }

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

  try {
    const data = (await response.json()) as { plans?: QueryPlan[] };
    return NextResponse.json({ success: true, plans: data.plans ?? [] });
  } catch {
    return NextResponse.json({ error: "Failed to parse query plan response" }, { status: 502 });
  }
}
