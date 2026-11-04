import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAbortError, sfTimeoutMessage, sfTimeoutSignal } from "@/lib/salesforce/client";
import { normalizeJiraSite } from "@/lib/pmo/jira";

/**
 * POST /api/pmo/jira - JIRA Cloud push through our worker.
 * The user's email + API token are forwarded per request - never stored,
 * never logged. Target is pinned to *.atlassian.net (validated here again
 * even though the client pre-validates).
 *
 * JSON actions: createmeta, create, get.
 * Multipart action: attach (fields: site/email/token/issueKey, file: Blob).
 */

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** ASCII-safe Basic credential - btoa alone throws on non-latin1 emails. */
function basicAuth(email: string, token: string): string {
  const bytes = new TextEncoder().encode(`${email}:${token}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `Basic ${btoa(bin)}`;
}

const credsSchema = z.object({
  site: z.string().min(1).max(200),
  email: z.string().min(1).max(320),
  token: z.string().min(1).max(2000),
});

const createSchema = credsSchema.extend({
  projectKey: z.string().min(1).max(32),
  issueTypeId: z.string().min(1).max(64),
  summary: z.string().min(1).max(255),
  description: z.unknown(),
  labels: z.array(z.string().max(64)).max(16).optional(),
});

function resolveSite(site: string): string | null {
  const norm = normalizeJiraSite(site);
  return norm.ok ? norm.site : null;
}

function errorMessage(status: number, fallback: string): string {
  if (status === 401 || status === 403) return "JIRA rejected the credentials (401/403) - check email + API token.";
  if (status === 404) return "Not found (404) - check the project key / issue type.";
  if (status === 400) return "JIRA refused the payload (400) - required fields may differ on this site.";
  return fallback;
}

async function handleJson(body: Record<string, unknown>) {
  const action = body.action;
  if (action === "createmeta") {
    const parsed = credsSchema.safeParse(body);
    if (!parsed.success) return fail("Site, email and token are required.");
    const site = resolveSite(parsed.data.site);
    if (!site) return fail("Only *.atlassian.net Cloud sites are supported.");
    let res: Response;
    try {
      res = await fetch(`${site}/rest/api/v3/issue/createmeta?expand=projects.issuetypes`, {
        headers: { Authorization: basicAuth(parsed.data.email, parsed.data.token), Accept: "application/json" },
        signal: sfTimeoutSignal(),
      });
    } catch (e) {
      return fail(isAbortError(e) ? sfTimeoutMessage() : "JIRA unreachable from the worker.", 502);
    }
    if (!res.ok) return fail(errorMessage(res.status, `Project list failed (${res.status}).`), 502);
    const meta: unknown = await res.json().catch(() => null);
    return NextResponse.json({ ok: true, meta });
  }
  if (action === "create") {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return fail("Site, email, token, project, issue type and summary are required.");
    const site = resolveSite(parsed.data.site);
    if (!site) return fail("Only *.atlassian.net Cloud sites are supported.");
    let res: Response;
    try {
      res = await fetch(`${site}/rest/api/v3/issue`, {
        method: "POST",
        headers: {
          Authorization: basicAuth(parsed.data.email, parsed.data.token),
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            project: { key: parsed.data.projectKey },
            issuetype: { id: parsed.data.issueTypeId },
            summary: parsed.data.summary,
            description: parsed.data.description,
            ...(parsed.data.labels && parsed.data.labels.length > 0 ? { labels: parsed.data.labels } : {}),
          },
        }),
        signal: sfTimeoutSignal(),
      });
    } catch (e) {
      return fail(isAbortError(e) ? sfTimeoutMessage() : "JIRA unreachable from the worker.", 502);
    }
    if (!res.ok) {
      let detail = "";
      try {
        const errJson: unknown = await res.json();
        const msgs = (errJson as { errorMessages?: string[] })?.errorMessages;
        if (Array.isArray(msgs) && msgs.length > 0) detail = ` ${msgs.slice(0, 2).join(" ")}`;
      } catch {
        /* keep generic */
      }
      return fail(`${errorMessage(res.status, `Create failed (${res.status}).`)}${detail}`, 502);
    }
    const created = (await res.json().catch(() => null)) as { key?: unknown } | null;
    const key = typeof created?.key === "string" ? created.key : "";
    if (!key) return fail("JIRA answered without an issue key.", 502);
    return NextResponse.json({ ok: true, key, url: `${site}/browse/${key}` });
  }
  if (action === "get") {
    const parsed = credsSchema
      .extend({ issueKey: z.string().min(1).max(32) })
      .safeParse(body);
    if (!parsed.success) return fail("Site, email, token and ticket key are required.");
    const ticket = parsed.data.issueKey.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(ticket)) return fail("That is not a ticket key - use ABC-123.");
    const site = resolveSite(parsed.data.site);
    if (!site) return fail("Only *.atlassian.net Cloud sites are supported.");
    let res: Response;
    try {
      res = await fetch(
        `${site}/rest/api/v3/issue/${ticket}?fields=summary,description,status,issuetype,priority,labels,comment`,
        {
          headers: { Authorization: basicAuth(parsed.data.email, parsed.data.token), Accept: "application/json" },
          signal: sfTimeoutSignal(),
        }
      );
    } catch (e) {
      return fail(isAbortError(e) ? sfTimeoutMessage() : "JIRA unreachable from the worker.", 502);
    }
    if (res.status === 404) return fail(`Ticket ${ticket} not found - check the key.`, 502);
    if (!res.ok) return fail(errorMessage(res.status, `Ticket read failed (${res.status}).`), 502);
    return NextResponse.json({ ok: true, issue: await res.json().catch(() => null) });
  }
  return fail("Unknown action.");
}

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  // Screenshot upload arrives multipart - forward it to JIRA untouched.
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail("Could not read the upload.");
    }
    const get = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : "";
    };
    const creds = credsSchema.safeParse({ site: get("site"), email: get("email"), token: get("token") });
    if (!creds.success) return fail("Site, email and token are required.");
    const site = resolveSite(creds.data.site);
    if (!site) return fail("Only *.atlassian.net Cloud sites are supported.");
    const issueKey = get("issueKey").trim();
    const file = form.get("file");
    if (!issueKey || !(file instanceof Blob)) return fail("Issue key and file are required.");
    const out = new FormData();
    out.set("file", file, (file as File).name || "screenshot.png");
    let res: Response;
    try {
      res = await fetch(`${site}/rest/api/v3/issue/${encodeURIComponent(issueKey)}/attachments`, {
        method: "POST",
        headers: {
          Authorization: basicAuth(creds.data.email, creds.data.token),
          Accept: "application/json",
          "X-Atlassian-Token": "nocheck",
        },
        body: out,
        signal: sfTimeoutSignal(),
      });
    } catch (e) {
      return fail(isAbortError(e) ? sfTimeoutMessage() : "JIRA unreachable from the worker.", 502);
    }
    if (!res.ok) return fail(errorMessage(res.status, `Attachment upload failed (${res.status}).`), 502);
    return NextResponse.json({ ok: true });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid JSON body.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Invalid JSON body.");
  return handleJson(body as Record<string, unknown>);
}
