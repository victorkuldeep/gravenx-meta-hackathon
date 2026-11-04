import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSalesforceUrl, screenTargetHost } from "@/lib/salesforce/url";
import { sfTimeoutSignal, isAbortError, sfTimeoutMessage } from "@/lib/salesforce/client";
import { encodePath } from "@/lib/rest/encode";

const headerSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.string().max(2000),
});

// Headers the proxy owns - never accepted from the client.
const BLOCKED_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "transfer-encoding",
  "expect",
  "trailer",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
]);

const schema = z.object({
  instanceUrl: z.string().min(1),
  token: z.string().min(1),
  scope: z.enum(["org", "custom"]).optional().default("org"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  // Org scope: path under the connected org. Custom scope: full URL below.
  path: z.string().max(2000).optional().default(""),
  url: z.string().max(2000).optional().default(""),
  headers: z.array(headerSchema).max(10).optional().default([]),
  body: z.string().max(1000000).optional().default(""),
  auth: z
    .object({
      type: z.enum(["none", "bearer", "basic"]),
      token: z.string().max(5000).optional().default(""),
      user: z.string().max(500).optional().default(""),
      pass: z.string().max(500).optional().default(""),
    })
    .optional()
    .default({ type: "none", token: "", user: "", pass: "" }),
});

const SAFE_RESPONSE_HEADERS = new Set([
  "content-type",
  "x-sfdc-request-id",
  "x-restforce-limit-info",
  "sforce-limit-info",
  "date",
]);

const MAX_BODY_CHARS = 1500000;

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

  const { instanceUrl, token, scope, method, path, url, headers, body: reqBody, auth } = parsed.data;

  let endpoint: string;
  const outHeaders: Record<string, string> = {
    Accept: "application/json",
  };

  if (scope === "org") {
    if (!path.startsWith("/services/")) {
      return NextResponse.json(
        { error: "Path must start with /services/ (locked to this org)." },
        { status: 400 }
      );
    }
    let origin: string;
    try {
      origin = new URL(normalizeSalesforceUrl(instanceUrl)).origin;
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid instance URL" },
        { status: 400 }
      );
    }
    endpoint = `${origin}${encodePath(path)}`;
    outHeaders["Authorization"] = `Bearer ${token}`;
  } else {
    if (!url.trim()) {
      return NextResponse.json({ error: "Custom scope needs a full https:// URL." }, { status: 400 });
    }
    let target: URL;
    try {
      target = new URL(url.trim());
    } catch {
      return NextResponse.json({ error: "Custom URL is not a valid URL." }, { status: 400 });
    }
    if (target.protocol !== "https:") {
      return NextResponse.json(
        { error: "Custom scope requires https:// URLs." },
        { status: 400 }
      );
    }
    const blocked = screenTargetHost(target.hostname);
    if (blocked) {
      return NextResponse.json({ error: blocked }, { status: 400 });
    }
    // WHATWG serialization is already correctly encoded - a second pass
    // would double-encode pasted input (%20 -> %2520).
    endpoint = target.toString();
    // Explicit auth wins; otherwise a hand-typed Authorization header passes through
    // (persona testing). The Salesforce session token is NEVER attached here.
    if (auth.type === "bearer" && auth.token) {
      outHeaders["Authorization"] = `Bearer ${auth.token}`;
    } else if (auth.type === "basic") {
      const raw = `${auth.user}:${auth.pass}`;
      const b64 =
        typeof btoa !== "undefined"
          ? btoa(unescape(encodeURIComponent(raw)))
          : Buffer.from(raw, "utf8").toString("base64");
      outHeaders["Authorization"] = `Basic ${b64}`;
    }
  }

  if (method !== "GET" && reqBody && reqBody.trim() !== "") {
    try {
      JSON.parse(reqBody);
    } catch {
      return NextResponse.json(
        { error: "Request body is not valid JSON." },
        { status: 400 }
      );
    }
  }

  if (method !== "GET") {
    outHeaders["Content-Type"] = "application/json";
  }
  for (const h of headers) {
    const k = h.key.toLowerCase();
    if (BLOCKED_HEADERS.has(k)) continue;
    if (k === "authorization" && outHeaders["Authorization"]) continue;
    outHeaders[h.key] = h.value;
  }

  const startTime = Date.now();
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method,
      headers: outHeaders,
      body: method === "GET" ? undefined : reqBody || undefined,
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

  let responseBody: unknown = null;
  let truncated = false;
  const contentType = response.headers.get("content-type") ?? "";
  try {
    const text = await response.text();
    if (text.length > MAX_BODY_CHARS) {
      responseBody = text.slice(0, MAX_BODY_CHARS);
      truncated = true;
    } else if (contentType.includes("application/json") && text) {
      try {
        responseBody = JSON.parse(text);
      } catch {
        responseBody = text;
      }
    } else {
      responseBody = text;
    }
  } catch {
    responseBody = null;
  }

  return NextResponse.json({
    success: response.ok,
    status: response.status,
    statusText: response.statusText,
    responseTime,
    body: responseBody,
    truncated,
    headers: safeHeaders,
    endpoint,
  });
}
