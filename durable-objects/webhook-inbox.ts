/**
 * Live webhook inboxes + per-owner registries. One Durable Object per uuid
 * holds captured requests; one per owner (`owner:<orgId>:<userId>`) holds the
 * registry index. Receiving is open; every management/read op validates the
 * Salesforce session token and matches it against the owner.
 *
 * Types are deliberately local: no external type packages, so `next build`
 * typechecks identically on a laptop and in Cloudflare's build container.
 */

export interface WebhookCapture {
  reqId: string;
  at: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  bodyText: string;
  size: number;
  truncated: boolean;
}

export interface InboxResp {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface OwnerEntry {
  uuid: string;
  name: string;
  /** Optional description captured at registration. */
  note: string;
  active: boolean;
  expiresAt: number;
  lastAt: number;
}

interface InboxMeta {
  owner: string | null;
  expiresAt: number;
  received: number;
  throttled: number;
  windowStart: number;
  windowCount: number;
  order: string[];
  name: string;
  lastAt: number;
  paused: boolean;
  /** Custom response config; null = default fixed envelope. */
  resp: InboxResp | null;
}

interface OwnerIndex {
  entries: Record<string, OwnerEntry>;
}

interface CachedOwner {
  owner: string;
  exp: number;
}

export interface WebhookStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string | string[]): Promise<boolean | number>;
  deleteAll(): Promise<void>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
}

export interface WebhookContext {
  readonly storage: WebhookStorage;
  readonly id?: { name?: string };
}

interface TokenValidation {
  owner: string;
  instanceUrl: string;
}

const MAX_REQUESTS = 100;
const MAX_BODY_BYTES = 1024 * 1024;
const MIRROR_BODY_CHARS = 65536;
const BURST = 20;
const WINDOW_MS = 60_000;
const TTL_MS = 7 * 24 * 3600 * 1000;
const OWNER_CACHE_MS = 10 * 60_000;
const MAX_REGISTERED = 100;
const MAX_ACTIVE = 10;

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
]);

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const json = (data: unknown, status = 200, extra?: Record<string, string>): Response =>
  Response.json(data, { status, headers: { ...CORS, ...(extra ?? {}) } });

/** Default envelope is itself a template - one code path for every reply. */
const DEFAULT_RESP: InboxResp = { status: 200, headers: {}, body: '{"ok":true,"id":"{{reqId}}"}' };

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([A-Za-z0-9_.:-]+)\s*\}\}/g, (m, key: string) =>
    key in vars ? vars[key] : m
  );
}

const RESP_HEADER_RE = /^[A-Za-z0-9-]+$/;
const RESP_DROP_HEADERS = new Set(["content-length", "connection", "transfer-encoding"]);

/** Validate an owner-supplied response config; null when invalid. */
function sanitizeResp(cfg: unknown): InboxResp | null {
  const c = cfg as Partial<InboxResp> | null;
  if (!c || typeof c !== "object") return null;
  if (!Number.isInteger(c.status) || (c.status as number) < 100 || (c.status as number) > 599) return null;
  const headers: Record<string, string> = {};
  if (c.headers !== undefined) {
    if (!c.headers || typeof c.headers !== "object" || Array.isArray(c.headers)) return null;
    const rows = Object.entries(c.headers as Record<string, unknown>);
    if (rows.length > 10) return null;
    for (const [k, v] of rows) {
      if (!RESP_HEADER_RE.test(k) || k.length > 64 || typeof v !== "string" || v.length > 2048) return null;
      if (RESP_DROP_HEADERS.has(k.toLowerCase())) continue;
      headers[k] = v;
    }
  }
  if (typeof c.body !== "string" || c.body.length > MIRROR_BODY_CHARS) return null;
  return { status: c.status as number, headers, body: c.body };
}

const freshMeta = (now: number): InboxMeta => ({
  owner: null,
  expiresAt: 0,
  received: 0,
  throttled: 0,
  windowStart: now,
  windowCount: 0,
  order: [],
  name: "",
  lastAt: 0,
  paused: false,
  resp: null,
});

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class WebhookInbox {
  private readonly ctx: WebhookContext;

  constructor(ctx: WebhookContext) {
    this.ctx = ctx;
  }

  /** This DO's own name: a uuid, or `owner:<orgId>:<userId>` for an index. */
  private name(): string {
    const id = (this.ctx as unknown as { id?: { name?: string } }).id;
    return typeof id?.name === "string" ? id.name : "";
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const seg = url.pathname.split("/").filter(Boolean);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "POST") {
      if (request.method === "GET" && seg[2] === "feed") {
        return json({ ok: false, error: "feed requires POST with owner session" }, 405);
      }
      if (request.method === "GET") {
        return json({ ok: true, hint: "POST here to capture a request" });
      }
      return json({ error: "not found" }, 404);
    }
    // Owner-index DOs (name `owner:<org>:<user>`) serve registry ops by last
    // path segment; uuid inboxes serve ops the same way and treat any other
    // POST as a capture (sub-path preserved when the uuid is in the path).
    const myName = this.name();
    if (myName.startsWith("owner:")) {
      return this.ownerOp(seg[seg.length - 1], request);
    }
    const at = seg.indexOf(myName);
    const op = at >= 0 ? seg[at + 1] : seg[seg.length - 1];
    if (op === "feed") return this.feed(request);
    if (op === "claim") return this.claim(request);
    if (op === "heartbeat") return this.heartbeat(request);
    if (op === "release") return this.release(request);
    if (op === "setPaused") return this.setPaused(request);
    if (op === "response") return this.responseCfg(request);
    const subPath = at >= 0 ? "/" + seg.slice(at + 1).join("/") : "/" + seg.join("/");
    return this.receive(request, subPath, url);
  }

  async alarm(): Promise<void> {
    const meta = await this.ctx.storage.get<InboxMeta>("meta");
    if (!meta || Date.now() > meta.expiresAt) {
      await this.ctx.storage.deleteAll();
    }
  }

  // ---------- shared helpers ----------

  private async readBody(request: Request): Promise<{ bytes: Uint8Array } | { error: Response }> {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return { error: json({ ok: false, error: "payload too large" }, 413) };
    }
    let size = 0;
    const chunks: Uint8Array[] = [];
    if (request.body) {
      const reader = request.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          return { error: json({ ok: false, error: "payload too large" }, 413) };
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.byteLength;
    }
    return { bytes };
  }

  private async readJson<T>(request: Request): Promise<T | null> {
    try {
      return (await request.json()) as T;
    } catch {
      return null;
    }
  }

  /** Validate a Salesforce session token, cached 10 min per token hash. */
  private async resolveOwner(token: string, instanceUrl: string): Promise<TokenValidation> {
    if (!token || !instanceUrl.startsWith("https://")) throw json({ ok: false, error: "bad session" }, 401);
    const key = `tokcache:${await sha256Hex(`${instanceUrl}|${token}`)}`;
    const now = Date.now();
    const cached = await this.ctx.storage.get<CachedOwner>(key);
    if (cached && cached.exp > now) return { owner: cached.owner, instanceUrl };
    let info: { organization_id?: string; user_id?: string };
    try {
      const res = await fetch(`${instanceUrl.replace(/\/$/, "")}/services/oauth2/userinfo`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) throw json({ ok: false, error: "session expired" }, 401);
      if (!res.ok) throw json({ ok: false, error: "session check failed" }, 401);
      info = (await res.json()) as { organization_id?: string; user_id?: string };
    } catch (err) {
      if (err instanceof Response) throw err;
      throw json({ ok: false, error: "session check failed" }, 401);
    }
    if (!info.organization_id || !info.user_id) throw json({ ok: false, error: "bad session" }, 401);
    const owner = `${info.organization_id}:${info.user_id}`;
    await this.ctx.storage.put(key, { owner, exp: now + OWNER_CACHE_MS } satisfies CachedOwner);
    return { owner, instanceUrl };
  }

  private async readMeta(): Promise<InboxMeta> {
    const meta = await this.ctx.storage.get<InboxMeta>("meta");
    return meta ?? freshMeta(Date.now());
  }

  private async writeMeta(meta: InboxMeta): Promise<void> {
    await this.ctx.storage.put("meta", meta);
    if (meta.expiresAt > 0) {
      await this.ctx.storage.setAlarm(meta.expiresAt);
    }
  }

  private async readIndex(): Promise<OwnerIndex> {
    const idx = await this.ctx.storage.get<OwnerIndex>("index");
    return idx ?? { entries: {} };
  }

  private async writeIndex(idx: OwnerIndex): Promise<void> {
    await this.ctx.storage.put("index", idx);
  }

  // ---------- uuid inbox ops ----------

  private async receive(request: Request, subPath: string, url: URL): Promise<Response> {
    // Registered inboxes only: claiming (via /register, Salesforce-validated)
    // must come first. Random or paused uuids 404 without reading or
    // storing anything.
    const gate = await this.readMeta();
    if (!gate.owner || gate.paused) return json({ error: "not found" }, 404);
    const body = await this.readBody(request);
    if ("error" in body) return body.error;
    const text = new TextDecoder().decode(body.bytes);
    const now = Date.now();
    const meta = await this.readMeta();
    if (now - meta.windowStart > WINDOW_MS) {
      meta.windowStart = now;
      meta.windowCount = 0;
    }
    meta.windowCount += 1;
    if (meta.windowCount > BURST) {
      meta.throttled += 1;
      await this.writeMeta(meta);
      return json({ ok: false, error: "throttled" }, 429, { "Retry-After": "60" });
    }
    if (!meta.expiresAt) {
      meta.expiresAt = now + TTL_MS;
      await this.ctx.storage.setAlarm(meta.expiresAt);
    }
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      if (!SENSITIVE_HEADERS.has(key.toLowerCase()) && key.length < 128 && value.length < 8192) {
        headers[key] = value;
      }
    });
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      if (key.length < 256 && value.length < 8192) query[key] = value;
    });
    const rec: WebhookCapture = {
      reqId: crypto.randomUUID(),
      at: now,
      method: request.method,
      path: subPath || "/",
      headers,
      query,
      bodyText: text.slice(0, MIRROR_BODY_CHARS),
      size: body.bytes.byteLength,
      truncated: text.length > MIRROR_BODY_CHARS,
    };
    await this.ctx.storage.put(`req:${rec.reqId}`, rec);
    meta.order.push(rec.reqId);
    while (meta.order.length > MAX_REQUESTS) {
      const oldest = meta.order.shift();
      if (oldest) await this.ctx.storage.delete(`req:${oldest}`);
    }
    meta.received += 1;
    meta.lastAt = now;
    await this.writeMeta(meta);
    return this.reply(meta.resp ?? DEFAULT_RESP, rec, text, headers, query);
  }

  /** Build the sender-facing reply from the inbox response config. */
  private reply(
    cfg: InboxResp,
    rec: WebhookCapture,
    bodyText: string,
    headers: Record<string, string>,
    query: Record<string, string>
  ): Response {
    const vars: Record<string, string> = {
      method: rec.method,
      path: rec.path,
      reqId: rec.reqId,
      at: new Date(rec.at).toISOString(),
      size: String(rec.size),
      body: bodyText.slice(0, 32768),
    };
    for (const [k, v] of Object.entries(query)) vars[`query.${k}`] = v;
    for (const [k, v] of Object.entries(headers)) vars[`headers.${k.toLowerCase()}`] = v;
    const out = renderTemplate(cfg.body, vars);
    const outHeaders: Record<string, string> = { ...CORS };
    let hasContentType = false;
    for (const [k, v] of Object.entries(cfg.headers)) {
      outHeaders[k] = renderTemplate(v, vars);
      if (k.toLowerCase() === "content-type") hasContentType = true;
    }
    if (!hasContentType) {
      try {
        JSON.parse(out);
        outHeaders["content-type"] = "application/json";
      } catch {
        outHeaders["content-type"] = "text/plain;charset=utf-8";
      }
    }
    return new Response(out, { status: cfg.status, headers: outHeaders });
  }

  /** Owner-only response designer: read the config, or validate + store it. */
  private async responseCfg(request: Request): Promise<Response> {
    const body = await this.readJson<{ token?: string; instanceUrl?: string; config?: unknown }>(request);
    if (!body?.token || !body.instanceUrl) return json({ ok: false, error: "owner session required" }, 401);
    let owner: string;
    try {
      ({ owner } = await this.resolveOwner(body.token, body.instanceUrl));
    } catch (err) {
      if (err instanceof Response) return err;
      return json({ ok: false, error: "session check failed" }, 401);
    }
    const meta = await this.readMeta();
    if (!meta.owner || meta.owner !== owner) return json({ ok: false, error: "not found" }, 404);
    if (body.config === undefined) {
      return json({ ok: true, config: meta.resp ?? DEFAULT_RESP });
    }
    const clean = sanitizeResp(body.config);
    if (!clean) return json({ ok: false, error: "bad response config" }, 400);
    meta.resp = clean;
    await this.writeMeta(meta);
    return json({ ok: true, config: clean });
  }

  private async feed(request: Request): Promise<Response> {
    const body = await this.readJson<{ token?: string; instanceUrl?: string; since?: string; limit?: number }>(request);
    if (!body?.token || !body.instanceUrl) return json({ ok: false, error: "owner session required" }, 401);
    let owner: string;
    try {
      ({ owner } = await this.resolveOwner(body.token, body.instanceUrl));
    } catch (err) {
      if (err instanceof Response) return err;
      return json({ ok: false, error: "session check failed" }, 401);
    }
    const meta = await this.readMeta();
    if (!meta.owner || meta.owner !== owner) return json({ ok: false, error: "not found" }, 404);
    const limit = Math.min(Math.max(Number(body.limit) || 50, 1), 200);
    const order = meta.order;
    const since = typeof body.since === "string" ? body.since : undefined;
    let ids: string[];
    let hasMore: boolean;
    if (since) {
      const start = order.indexOf(since) + 1;
      ids = order.slice(start, start + limit);
      hasMore = start + ids.length < order.length;
    } else {
      ids = order.slice(-limit);
      hasMore = order.length > limit;
    }
    const rows =
      ids.length > 0 ? await this.ctx.storage.get<WebhookCapture>(ids.map((id) => `req:${id}`)) : new Map<string, WebhookCapture>();
    const requests = ids.map((id) => rows.get(`req:${id}`)).filter((r): r is WebhookCapture => r !== undefined);
    return json({ ok: true, requests, hasMore, expiresAt: meta.expiresAt, received: meta.received });
  }

  private async claim(request: Request): Promise<Response> {
    const body = await this.readJson<{ token?: string; instanceUrl?: string; name?: string }>(request);
    if (!body?.token || !body.instanceUrl) return json({ ok: false, error: "owner session required" }, 401);
    let owner: string;
    try {
      ({ owner } = await this.resolveOwner(body.token, body.instanceUrl));
    } catch (err) {
      if (err instanceof Response) return err;
      return json({ ok: false, error: "session check failed" }, 401);
    }
    const now = Date.now();
    const meta = await this.readMeta();
    if (meta.owner && meta.owner !== owner && now < meta.expiresAt) {
      return json({ ok: false, error: "taken" }, 409);
    }
    meta.owner = owner;
    meta.expiresAt = now + TTL_MS;
    if (typeof body.name === "string" && body.name.length > 0) meta.name = body.name.slice(0, 80);
    await this.writeMeta(meta);
    return json({ ok: true, state: "live", expiresAt: meta.expiresAt });
  }

  private async heartbeat(request: Request): Promise<Response> {
    const body = await this.readJson<{ token?: string; instanceUrl?: string }>(request);
    if (!body?.token || !body.instanceUrl) return json({ ok: false, error: "owner session required" }, 401);
    let owner: string;
    try {
      ({ owner } = await this.resolveOwner(body.token, body.instanceUrl));
    } catch (err) {
      if (err instanceof Response) return err;
      return json({ ok: false, error: "session check failed" }, 401);
    }
    const meta = await this.readMeta();
    if (!meta.owner || meta.owner !== owner) return json({ ok: false, error: "not found" }, 404);
    meta.expiresAt = Date.now() + TTL_MS;
    await this.writeMeta(meta);
    return json({ ok: true, expiresAt: meta.expiresAt });
  }

  private async release(request: Request): Promise<Response> {
    const body = await this.readJson<{ token?: string; instanceUrl?: string }>(request);
    if (!body?.token || !body.instanceUrl) return json({ ok: false, error: "owner session required" }, 401);
    let owner: string;
    try {
      ({ owner } = await this.resolveOwner(body.token, body.instanceUrl));
    } catch (err) {
      if (err instanceof Response) return err;
      return json({ ok: false, error: "session check failed" }, 401);
    }
    const meta = await this.readMeta();
    if (meta.owner && meta.owner !== owner) return json({ ok: false, error: "not found" }, 404);
    const order = meta.order;
    for (const id of order) {
      await this.ctx.storage.delete(`req:${id}`);
    }
    await this.writeMeta(freshMeta(Date.now()));
    return json({ ok: true, released: true });
  }

  /** Owner-only pause switch: paused inboxes stop capturing (receive 404s). */
  private async setPaused(request: Request): Promise<Response> {
    const body = await this.readJson<{ token?: string; instanceUrl?: string; paused?: boolean }>(request);
    if (!body?.token || !body.instanceUrl) return json({ ok: false, error: "owner session required" }, 401);
    let owner: string;
    try {
      ({ owner } = await this.resolveOwner(body.token, body.instanceUrl));
    } catch (err) {
      if (err instanceof Response) return err;
      return json({ ok: false, error: "session check failed" }, 401);
    }
    const meta = await this.readMeta();
    if (!meta.owner || meta.owner !== owner) return json({ ok: false, error: "not found" }, 404);
    meta.paused = body.paused === true;
    await this.writeMeta(meta);
    return json({ ok: true, paused: meta.paused });
  }

  // ---------- owner index ops (DO named `owner:<orgId>:<userId>`) ----------

  private async ownerOp(op: string | undefined, request: Request): Promise<Response> {
    const body = await this.readJson<{
      token?: string;
      instanceUrl?: string;
      uuid?: string;
      name?: string;
      note?: string;
      active?: boolean;
      uuids?: { uuid: string; active: boolean }[];
    }>(request);
    if (!body?.token || !body.instanceUrl) return json({ ok: false, error: "owner session required" }, 401);
    let owner: string;
    try {
      ({ owner } = await this.resolveOwner(body.token, body.instanceUrl));
    } catch (err) {
      if (err instanceof Response) return err;
      return json({ ok: false, error: "session check failed" }, 401);
    }
    if (owner !== this.name().slice("owner:".length)) return json({ ok: false, error: "not found" }, 404);
    const idx = await this.readIndex();
    if (op === "list") {
      return json({ ok: true, entries: Object.values(idx.entries) });
    }
    if (op === "claim") {
      const uuid = typeof body.uuid === "string" ? body.uuid : "";
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(uuid) || uuid.startsWith("owner:")) return json({ ok: false, error: "bad id" }, 400);
      const ids = Object.keys(idx.entries);
      if (!idx.entries[uuid] && ids.length >= MAX_REGISTERED) {
        return json({ ok: false, error: "registry full (100)" }, 409);
      }
      const wantActive = body.active === true;
      if (wantActive && !idx.entries[uuid]?.active) {
        const activeCount = Object.values(idx.entries).filter((e) => e.active).length;
        if (activeCount >= MAX_ACTIVE) return json({ ok: false, error: "only 10 live at once" }, 409);
      }
      const prev = idx.entries[uuid];
      idx.entries[uuid] = {
        uuid,
        name: typeof body.name === "string" && body.name ? body.name.slice(0, 80) : (prev?.name ?? uuid),
        note: typeof body.note === "string" && body.note ? body.note.slice(0, 280) : (prev?.note ?? ""),
        active: wantActive,
        expiresAt: prev?.expiresAt ?? 0,
        lastAt: prev?.lastAt ?? 0,
      };
      await this.writeIndex(idx);
      return json({ ok: true, entry: idx.entries[uuid] });
    }
    if (op === "release") {
      const uuid = typeof body.uuid === "string" ? body.uuid : "";
      delete idx.entries[uuid];
      await this.writeIndex(idx);
      return json({ ok: true, released: true });
    }
    if (op === "touch") {
      const updates = Array.isArray(body.uuids) ? body.uuids : [];
      const next = new Set(
        Object.entries(idx.entries)
          .filter(([, e]) => e.active)
          .map(([id]) => id)
      );
      for (const u of updates) {
        if (typeof u.uuid !== "string" || !idx.entries[u.uuid]) continue;
        if (u.active) next.add(u.uuid);
        else next.delete(u.uuid);
      }
      if (next.size > MAX_ACTIVE) return json({ ok: false, error: "only 10 live at once" }, 409);
      const now = Date.now();
      for (const u of updates) {
        const e = idx.entries[u.uuid];
        if (!e) continue;
        e.active = u.active;
        if (u.active) e.lastAt = now;
      }
      await this.writeIndex(idx);
      return json({ ok: true, entries: Object.values(idx.entries) });
    }
    if (op === "sync") {
      const uuid = typeof body.uuid === "string" ? body.uuid : "";
      const e = idx.entries[uuid];
      if (!e) return json({ ok: false, error: "not found" }, 404);
      const b = body as unknown as { expiresAt?: number; lastAt?: number; name?: string; note?: string };
      if (typeof b.expiresAt === "number") e.expiresAt = b.expiresAt;
      if (typeof b.lastAt === "number") e.lastAt = b.lastAt;
      if (typeof b.name === "string" && b.name) e.name = b.name.slice(0, 80);
      if (typeof b.note === "string") e.note = b.note.slice(0, 280);
      await this.writeIndex(idx);
      return json({ ok: true, entry: e });
    }
    return json({ error: "not found" }, 404);
  }
}
