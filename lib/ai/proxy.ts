import { screenTargetHost } from "@/lib/salesforce/url";

/**
 * Server-side target validation for the AI proxy routes
 * (app/api/ai/models, app/api/ai/chat).
 *
 * The browser cannot reach every provider directly (CORS/egress), so our
 * worker forwards the user's session key per request - exactly like the
 * Salesforce token proxy. Keys are forwarded, never stored, never logged.
 * Guards: https only, no credentials in URL, no internal/literal hosts.
 */

export type ProxyTarget = { ok: true; base: string } | { ok: false; error: string };

export function resolveProxyBase(baseURL: unknown): ProxyTarget {
  if (typeof baseURL !== "string" || !baseURL.trim()) {
    return { ok: false, error: "Set the endpoint URL first." };
  }
  const trimmed = baseURL.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "Endpoint must be an http(s) URL." };
  }
  if (url.protocol !== "https:") return { ok: false, error: "Endpoint must be https." };
  if (url.username || url.password) return { ok: false, error: "Credentials in the URL are not allowed." };
  const blocked = screenTargetHost(url.hostname);
  if (blocked) return { ok: false, error: blocked };
  const path = url.pathname.replace(/\/+$/, "");
  return { ok: true, base: `${url.origin}${path}` };
}
