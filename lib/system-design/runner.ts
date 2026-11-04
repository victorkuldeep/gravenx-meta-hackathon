/**
 * Test-runner policy (pure, shared by UI preflight and documentation).
 * Server re-verifies everything - the client verdict is advisory only.
 * Phase 3 posture: structural guards (https, declared host, no internal
 * names/IPs), explicit timeouts and size caps. Org-wide allowlists and
 * credential vaults are Phase 8 enterprise scope.
 */

export const RUNNER_MAX_TIMEOUT_MS = 60000;
export const RUNNER_DEFAULT_TIMEOUT_MS = 25000;
export const RUNNER_MAX_REQUEST_BYTES = 1024 * 1024;
export const RUNNER_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const RUNNER_MAX_REDIRECTS = 2;

const SENSITIVE_HEADER = /^(authorization|cookie|set-cookie|proxy-authorization|x-api-key|token|api-key)$/i;

export function clampTimeoutMs(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : RUNNER_DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(n, 1000), RUNNER_MAX_TIMEOUT_MS);
}

export interface PreflightInput {
  baseUrl: string;
  path: string;
  method: string;
  allowHost: string;
  timeoutMs: number;
  bodyBytes: number;
}

export interface PreflightVerdict {
  ok: boolean;
  url: string;
  reasons: string[];
}

/** Structural preflight: https, host pins to the declared host, no internals, caps. */
export function preflightRun(input: PreflightInput): PreflightVerdict {
  const reasons: string[] = [];
  let url = "";
  try {
    const base = input.baseUrl.trim().replace(/\/+$/, "");
    const path = input.path.trim().startsWith("/") ? input.path.trim() : `/${input.path.trim()}`;
    const u = new URL(base + path);
    url = u.toString();
    if (u.protocol !== "https:") reasons.push("Only https destinations are allowed in Test runs.");
    if (u.hostname.toLowerCase() !== input.allowHost.trim().toLowerCase() || !input.allowHost.trim()) {
      reasons.push(`Destination host must equal the declared host (${input.allowHost || "none declared"}).`);
    }
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(u.hostname)) {
      reasons.push("Loopback, private and link-local destinations are blocked.");
    }
    if (/(^|\.)(localhost|local|internal|lan|home|invalid)$/i.test(u.hostname)) {
      reasons.push("Internal-style hostnames are blocked.");
    }
  } catch {
    reasons.push("Base URL + path do not form a valid URL.");
  }
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(input.method)) {
    // EVENT/QUERY are first-class operation types but have no HTTP wire form
    // in this tool (no event-broker transport): they can seed a chain as the
    // first op, but they can never be fired directly. Say so plainly instead
    // of failing them as a generic "bad method".
    reasons.push(
      input.method === "EVENT" || input.method === "QUERY"
        ? `Method ${input.method} is not HTTP-callable - it can seed a chain run but cannot be fired directly. Bind a GET/POST/PUT/PATCH/DELETE operation to run it.`
        : "Method must be GET, POST, PUT, PATCH or DELETE."
    );
  }
  if (clampTimeoutMs(input.timeoutMs) !== Math.floor(input.timeoutMs) && input.timeoutMs > RUNNER_MAX_TIMEOUT_MS) {
    reasons.push(`Timeout is capped at ${RUNNER_MAX_TIMEOUT_MS / 1000}s.`);
  }
  if (input.bodyBytes > RUNNER_MAX_REQUEST_BYTES) {
    reasons.push(`Request body exceeds the ${(RUNNER_MAX_REQUEST_BYTES / 1024 / 1024).toFixed(0)} MB cap.`);
  }
  return { ok: reasons.length === 0, url, reasons };
}

/** Redact secret-bearing headers for display and run history. */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADER.test(k.trim()) ? "•••redacted•••" : v;
  }
  return out;
}

/** Normalize a pasted token: users habitually paste the whole
 * `Bearer <key>` header value into token fields - the route adds the scheme
 * itself, so strip it (plus stray whitespace) at the trust boundary. */
export function normalizeAuthToken(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  return s.replace(/^Bearer\s+/i, "").trim();
}

/** Strip query strings before persisting endpoint references. */
export function endpointForStorage(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url.split("?")[0];
  }
}
