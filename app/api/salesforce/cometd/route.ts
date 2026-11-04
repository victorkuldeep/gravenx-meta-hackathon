import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSalesforceUrl } from "@/lib/salesforce/url";
import { isAbortError } from "@/lib/salesforce/client";
import type { BayeuxMessage } from "@/lib/salesforce/bayeux";

const schema = z.object({
  instanceUrl: z.string().min(1),
  token: z.string().min(1),
  apiVersion: z.string().min(1),
  messages: z.array(z.record(z.string(), z.unknown())).min(1).max(20),
  cookie: z.string().max(500).nullable().optional(),
});

/** Pull BAYEUX_BROWSER out of the upstream Set-Cookie headers. */
function extractBayeuxCookie(headers: Headers): string | null {
  const all: string[] =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (() => {
          const single = headers.get("set-cookie");
          return single ? [single] : [];
        })();
  for (const c of all) {
    const m = c.match(/^BAYEUX_BROWSER=([^;]+)/i);
    if (m) return m[1];
  }
  return null;
}

/**
 * CometD proxy: browsers cannot POST to /cometd cross-origin (no CORS
 * headers), so every Bayeux message rides this same-origin route and the
 * token never leaves the server leg. Deliberately NO short timeout: a
 * healthy long-poll hangs server-side until Salesforce answers (up to
 * ~110s). A 115s abort only catches a truly hung upstream; the client
 * treats any transport error as a reconnect trigger anyway.
 */
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

  const { instanceUrl, token, apiVersion, messages, cookie } = parsed.data;
  const jar = typeof cookie === "string" ? cookie.replace(/[;\s]/g, "") : "";

  let origin: string;
  try {
    origin = new URL(normalizeSalesforceUrl(instanceUrl)).origin;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid instance URL" },
      { status: 400 }
    );
  }

  const ver = apiVersion.startsWith("v") ? apiVersion.slice(1) : apiVersion;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 115000);
  try {
    const response = await fetch(`${origin}/cometd/${ver}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(jar ? { Cookie: `BAYEUX_BROWSER=${jar}` } : {}),
      },
      body: JSON.stringify(messages),
      signal: ctrl.signal,
    });
    const replies = (await response.json()) as BayeuxMessage[];
    if (!response.ok) {
      const first = Array.isArray(replies) ? replies[0] : undefined;
      const detail = first && typeof first.error === "string" && first.error ? `: ${first.error}` : "";
      return NextResponse.json(
        { error: `Stream request failed (${response.status}${detail})` },
        { status: response.status }
      );
    }
    if (!Array.isArray(replies)) {
      return NextResponse.json({ error: "Stream returned a non-batch reply" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, replies, cookie: extractBayeuxCookie(response.headers) });
  } catch (err) {
    if (isAbortError(err)) {
      return NextResponse.json({ error: "Stream request timed out - reconnecting" }, { status: 504 });
    }
    return NextResponse.json(
      { error: `Network error: ${err instanceof Error ? err.message : "unknown"}` },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
