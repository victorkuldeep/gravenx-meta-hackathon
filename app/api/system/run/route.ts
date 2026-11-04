import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import dns from "node:dns/promises";
import { screenTargetHost } from "@/lib/salesforce/url";
import { isAbortError } from "@/lib/salesforce/client";
import {
  clampTimeoutMs,
  normalizeAuthToken,
  redactHeaders,
  endpointForStorage,
  RUNNER_MAX_REQUEST_BYTES,
  RUNNER_MAX_RESPONSE_BYTES,
  RUNNER_MAX_REDIRECTS,
} from "@/lib/system-design/runner";

/**
 * Phase-3 test execution boundary. Structural guards enforced server-side,
 * independent of anything the client claims:
 * - https only; destination hostname must equal the declared allowHost
 * - literal internal names/IPs blocked (screenTargetHost)
 * - resolved IPs re-checked (DNS-rebinding guard), incl. IPv6 private ranges
 * - redirects: same-host only, capped; cross-host stops with a note
 * - timeouts clamped, request/response size caps, auth headers redacted
 * No credentials are stored. Nothing is logged with bodies.
 */

const headerSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.string().max(8000),
});

const schema = z.object({
  url: z.string().min(1).max(4000),
  allowHost: z.string().min(1).max(253),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  headers: z.array(headerSchema).max(20).optional().default([]),
  body: z.string().max(RUNNER_MAX_REQUEST_BYTES + 1024).optional().default(""),
  timeoutMs: z.number().optional(),
  authToken: z.string().max(5000).optional().default(""),
});

function isBlockedIp(ip: string): boolean {
  // IPv4 literal ranges via the shared screen (covers 10/127/0/172.16-31/192.168/169.254).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return screenTargetHost(ip) !== null;
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // unique-local
  if (v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb")) return true; // link-local
  return false;
}

async function assertResolvable(hostname: string): Promise<string | null> {
  try {
    const records = await dns.lookup(hostname, { all: true });
    for (const r of records) {
      if (isBlockedIp(r.address)) {
        return `DNS for ${hostname} resolves to a blocked address (${r.address}).`;
      }
    }
    return null;
  } catch {
    return `Could not resolve ${hostname}.`;
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid run request." }, { status: 400 });
  }
  const { method, headers, timeoutMs, authToken } = parsed.data;
  const allowHost = parsed.data.allowHost.trim().toLowerCase();
  const timeout = clampTimeoutMs(timeoutMs);
  let bodyText = parsed.data.body ?? "";
  if (new TextEncoder().encode(bodyText).length > RUNNER_MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Request body exceeds the 1 MB cap." }, { status: 413 });
  }

  let target: URL;
  try {
    target = new URL(parsed.data.url);
  } catch {
    return NextResponse.json({ error: "Destination is not a valid URL." }, { status: 400 });
  }
  if (target.protocol !== "https:") {
    return NextResponse.json({ error: "Only https destinations are allowed in Test runs." }, { status: 400 });
  }
  if (target.hostname.toLowerCase() !== allowHost || !allowHost) {
    return NextResponse.json(
      { error: `Destination host must equal the declared host (${allowHost || "none"}).` },
      { status: 400 }
    );
  }
  const screened = screenTargetHost(target.hostname);
  if (screened) {
    return NextResponse.json({ error: screened }, { status: 400 });
  }
  const dnsBlock = await assertResolvable(target.hostname);
  if (dnsBlock) {
    return NextResponse.json({ error: dnsBlock }, { status: 400 });
  }

  const outHeaders: Record<string, string> = { "Content-Type": "application/json" };
  for (const h of headers) {
    const k = h.key.toLowerCase();
    if (["host", "content-length", "connection", "authorization", "cookie"].includes(k)) continue;
    outHeaders[h.key] = h.value;
  }
  const cleanToken = normalizeAuthToken(authToken);
  if (cleanToken) outHeaders["Authorization"] = `Bearer ${cleanToken}`;

  const started = Date.now();
  let response: Response;
  let current = target.toString();
  let redirects = 0;
  try {
    for (;;) {
      const ctrl = AbortSignal.timeout(timeout);
      response = await fetch(current, {
        method,
        headers: outHeaders,
        body: method === "GET" ? undefined : bodyText || undefined,
        signal: ctrl,
        redirect: "manual",
      });
      const location = response.headers.get("location");
      const isRedirect = response.status >= 300 && response.status < 400 && location;
      if (!isRedirect) break;
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        break;
      }
      if (next.hostname.toLowerCase() !== target.hostname.toLowerCase() || redirects >= RUNNER_MAX_REDIRECTS) {
        break;
      }
      // Same-host hop: re-verify DNS (rebinding guard) and continue.
      const recheck = await assertResolvable(next.hostname);
      if (recheck) break;
      current = next.toString();
      redirects++;
      // GET-ify 301/302/303 with a body, per fetch semantics.
      if ([301, 302, 303].includes(response.status) && method !== "GET") {
        bodyText = "";
      }
    }
  } catch (err) {
    if (isAbortError(err)) {
      return NextResponse.json(
        { error: `Destination did not respond within ${timeout / 1000}s.`, success: false },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: `Network error: ${err instanceof Error ? err.message : "unknown"}.`, success: false },
      { status: 502 }
    );
  }

  const durationMs = Date.now() - started;
  const safeHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (["content-type", "date", "x-request-id", "sforce-limit-info"].includes(k)) {
      safeHeaders[key] = value;
    }
  });

  let text = "";
  let truncated = false;
  try {
    const reader = response.body?.getReader();
    if (reader) {
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > RUNNER_MAX_RESPONSE_BYTES) {
          truncated = true;
          break;
        }
        chunks.push(value);
      }
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }
      text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
    } else {
      text = await response.text();
      if (text.length > RUNNER_MAX_RESPONSE_BYTES) {
        text = text.slice(0, RUNNER_MAX_RESPONSE_BYTES);
        truncated = true;
      }
    }
  } catch {
    text = "";
  }

  return NextResponse.json({
    success: response.ok,
    status: response.status,
    statusText: response.statusText,
    durationMs,
    endpoint: endpointForStorage(current),
    redirects,
    requestHeaders: redactHeaders({ ...Object.fromEntries(Object.entries(outHeaders)), ...(authToken ? { Authorization: "provided" } : {}) }),
    requestBodyPreview: bodyText.slice(0, 10000),
    responseHeaders: redactHeaders(safeHeaders),
    responseBodyPreview: text.slice(0, 50000),
    truncated,
  });
}
