import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSalesforceUrl } from "@/lib/salesforce/url";
import { sfTimeoutSignal, isAbortError, sfTimeoutMessage } from "@/lib/salesforce/client";
import { SalesforceField, SalesforceChildRelationship, SalesforceDescribeResult } from "@/lib/salesforce/types";

const schema = z.object({
  instanceUrl: z.string().min(1),
  token: z.string().min(1),
  apiVersion: z.string().min(1),
  objectName: z.string().min(1).regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "Invalid object name"),
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

  const { instanceUrl, token, apiVersion, objectName } = parsed.data;

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
  const url = `${normalizedUrl}/services/data/${ver}/sobjects/${objectName}/describe`;

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
    } else if (response.status === 404) {
      message = `404 Not Found - object "${objectName}" does not exist or is not accessible.`;
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
    const data = (await response.json()) as {
      name: string;
      label: string;
      labelPlural: string;
      custom: boolean;
      customSetting?: unknown;
      createable: boolean;
      updateable: boolean;
      fields: SalesforceField[];
      childRelationships?: (SalesforceChildRelationship & { cascadeDelete?: unknown })[];
      recordTypeInfos?: {
        recordTypeId?: unknown;
        developerName?: unknown;
        name?: unknown;
        active?: unknown;
        master?: unknown;
        defaultRecordTypeMapping?: unknown;
      }[];
    };

    const result: SalesforceDescribeResult = {
      name: data.name,
      label: data.label,
      labelPlural: data.labelPlural,
      custom: data.custom,
      customSetting: data.customSetting === true,
      createable: data.createable,
      updateable: data.updateable,
      fields: data.fields,
      childRelationships: Array.isArray(data.childRelationships)
        ? data.childRelationships
            .filter((r) => r && typeof r.childSObject === "string" && typeof r.field === "string")
            .map((r) => ({
              childSObject: r.childSObject,
              field: r.field,
              relationshipName: r.relationshipName ?? null,
              cascadeDelete: r.cascadeDelete === true,
            }))
        : [],
      recordTypeInfos: Array.isArray(data.recordTypeInfos)
        ? data.recordTypeInfos
            .filter((r) => r && typeof r.recordTypeId === "string" && r.recordTypeId)
            .map((r) => ({
              recordTypeId: r.recordTypeId as string,
              developerName: typeof r.developerName === "string" && r.developerName ? r.developerName : (r.recordTypeId as string),
              name: typeof r.name === "string" && r.name ? r.name : (r.recordTypeId as string),
              active: r.active !== false,
              master: r.master === true,
              defaultRecordTypeMapping: r.defaultRecordTypeMapping === true,
            }))
        : [],
    };

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Failed to parse Salesforce describe response" }, { status: 502 });
  }
}
