/**
 * Server-only helpers for webhook management routes. Thin by design: the
 * Durable Object re-validates every token itself, so routes only resolve the
 * owner name when they must address an `owner:<org>:<user>` index DO.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare/cloudflare-context";
import type { WebhookInboxNamespace, WebhookInboxStub } from "../../durable-objects/binding";
import { devNamespace } from "./dev-mesh";

export const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

function namespace(): WebhookInboxNamespace {
  try {
    const { env } = getCloudflareContext();
    const inbox = (env as unknown as { WEBHOOK_INBOX?: WebhookInboxNamespace }).WEBHOOK_INBOX;
    if (inbox) return inbox;
  } catch {
    /* not on the Cloudflare runtime - fall through to the dev mesh */
  }
  if (process.env.NODE_ENV !== "production") return devNamespace();
  throw Response.json({ ok: false, error: "webhook storage unavailable" }, { status: 503 });
}

export function getInbox(id: string): WebhookInboxStub {
  return namespace().getByName(id);
}

export function getOwnerInbox(owner: string): WebhookInboxStub {
  return namespace().getByName(`owner:${owner}`);
}

/** Synthetic POST aimed at a DO op handler (`claim`, `list`, `sync`, …). */
export function doRequest(op: string, body: unknown): Request {
  return new Request(`https://webhook-inbox/${op}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export async function doJson(
  stub: WebhookInboxStub,
  op: string,
  body: unknown
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await stub.fetch(doRequest(op, body));
  let data: Record<string, unknown> = { ok: false };
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* keep default */
  }
  return { status: res.status, data };
}

/**
 * Resolve `orgId:userId` for a Salesforce session. Throws a Response
 * (401/400) on any failure so routes can return it directly. Used only for
 * infrequent management calls; the hot feed path uses the DO-side cache.
 */
export async function resolveOwnerName(token: unknown, instanceUrl: unknown): Promise<string> {
  if (typeof token !== "string" || !token || typeof instanceUrl !== "string" || !instanceUrl.startsWith("https://")) {
    throw Response.json({ ok: false, error: "owner session required" }, { status: 401 });
  }
  let info: { organization_id?: string; user_id?: string };
  try {
    const res = await fetch(`${instanceUrl.replace(/\/$/, "")}/services/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      throw Response.json({ ok: false, error: "session expired" }, { status: 401 });
    }
    if (!res.ok) throw Response.json({ ok: false, error: "session check failed" }, { status: 401 });
    info = (await res.json()) as { organization_id?: string; user_id?: string };
  } catch (err) {
    if (err instanceof Response) throw err;
    throw Response.json({ ok: false, error: "session check failed" }, { status: 401 });
  }
  if (!info.organization_id || !info.user_id) {
    throw Response.json({ ok: false, error: "bad session" }, { status: 401 });
  }
  return `${info.organization_id}:${info.user_id}`;
}

export function badId(): Response {
  return Response.json({ error: "bad id" }, { status: 400 });
}
