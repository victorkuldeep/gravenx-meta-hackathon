import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSalesforceUrl } from "@/lib/salesforce/url";
import { sfTimeoutSignal, isAbortError, sfTimeoutMessage } from "@/lib/salesforce/client";
import { ApiVersionInfo } from "@/lib/salesforce/types";

const schema = z.object({
  instanceUrl: z.string().min(1),
  token: z.string().min(1),
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

  const { instanceUrl, token } = parsed.data;

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeSalesforceUrl(instanceUrl);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid instance URL" },
      { status: 400 }
    );
  }

  const url = `${normalizedUrl}/services/data/`;

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
    return NextResponse.json(
      { error: `${response.status} ${response.statusText}` },
      { status: response.status }
    );
  }

  try {
    const data = (await response.json()) as ApiVersionInfo[];
    // Return in descending order (newest first)
    const sorted = [...data].sort((a, b) => {
      const aNum = parseFloat(a.version);
      const bNum = parseFloat(b.version);
      return bNum - aNum;
    });
    return NextResponse.json({ versions: sorted });
  } catch {
    return NextResponse.json({ error: "Failed to parse versions response" }, { status: 502 });
  }
}
