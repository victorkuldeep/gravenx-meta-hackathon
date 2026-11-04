import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSalesforceUrl } from "@/lib/salesforce/url";
import { sfTimeoutSignal, isAbortError, sfTimeoutMessage } from "@/lib/salesforce/client";
import { SalesforceObject } from "@/lib/salesforce/types";

const schema = z.object({
  instanceUrl: z.string().min(1),
  token: z.string().min(1),
  apiVersion: z.string().min(1),
});

interface RawSobject {
  name: string;
  label: string;
  labelPlural: string;
  custom: boolean;
  customSetting?: boolean;
  createable: boolean;
  updateable: boolean;
  queryable: boolean;
  deletable: boolean;
  urls: Record<string, string>;
}

interface SobjectsResponse {
  sobjects: RawSobject[];
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
    if (response.status === 401) {
      message = "401 Unauthorized - the access token may be expired or invalid.";
    } else {
      try {
        const errBody = (await response.json()) as Array<{ message: string }> | { message: string };
        const first = Array.isArray(errBody) ? errBody[0] : errBody;
        if (first?.message) message = first.message;
      } catch {
        /* ignore */
      }
    }
    return NextResponse.json({ error: message }, { status: response.status });
  }

  try {
    const data = (await response.json()) as SobjectsResponse;
    const objects: SalesforceObject[] = (data.sobjects ?? []).map((s) => ({
      name: s.name,
      label: s.label,
      labelPlural: s.labelPlural,
      custom: s.custom,
      ...(s.customSetting ? { customSetting: true as const } : {}),
      createable: s.createable,
      updateable: s.updateable,
      queryable: s.queryable,
      deletable: s.deletable,
      urls: s.urls,
    }));

    // Sort: standard first, then custom, then alphabetical within each group
    objects.sort((a, b) => {
      if (a.custom !== b.custom) return a.custom ? 1 : -1;
      return a.label.localeCompare(b.label);
    });

    return NextResponse.json({ objects });
  } catch {
    return NextResponse.json({ error: "Failed to parse Salesforce response" }, { status: 502 });
  }
}
