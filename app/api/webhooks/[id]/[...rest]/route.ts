/**
 * POST /api/webhooks/<uuid>/... — one route for everything under a uuid:
 *  - single-segment ops (feed | claim | heartbeat | release): forwarded to the
 *    inbox DO, which validates the owner session itself;
 *  - anything longer: an open capture, sub-path + query preserved.
 * Release also drops the uuid from the caller's owner index (best-effort).
 */
import { ID_RE, doRequest, getInbox, getOwnerInbox, resolveOwnerName } from "../../../../../lib/webhooks/server";

const OPS = new Set(["feed", "claim", "heartbeat", "release", "setPaused", "response"]);

function target(id: string, rest: string[], search: string): string {
  const path = rest.map((s) => encodeURIComponent(s)).join("/");
  return `https://webhook-inbox/api/webhooks/${id}/${path}${search}`;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string; rest: string[] }> }) {
  const { id, rest } = await ctx.params;
  if (!ID_RE.test(id) || !Array.isArray(rest) || rest.length === 0) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  const { search } = new URL(req.url);
  const raw = await req.text().catch(() => "");
  const isOp = rest.length === 1 && OPS.has(rest[0]);
  const op = isOp ? rest[0] : null;
  let res: Response;
  try {
    res = await getInbox(id).fetch(
      new Request(target(id, rest, search), { method: "POST", headers: req.headers, body: raw })
    );
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json(
      { ok: false, error: String((err as Error)?.message ?? err).slice(0, 200) },
      { status: 500 }
    );
  }
  if (op === "release" && res.ok) {
    try {
      const body = JSON.parse(raw) as { token?: unknown; instanceUrl?: unknown };
      if (body?.token && body?.instanceUrl) {
        const owner = await resolveOwnerName(body.token, body.instanceUrl);
        await getOwnerInbox(owner).fetch(doRequest("release", { ...body, uuid: id }));
      }
    } catch {
      /* index cleanup is best-effort; the inbox itself is released */
    }
  }
  return res;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; rest: string[] }> }) {
  const { rest } = await ctx.params;
  if (Array.isArray(rest) && rest.length === 1 && rest[0] === "feed") {
    return Response.json({ ok: false, error: "feed requires POST with owner session" }, { status: 405 });
  }
  return Response.json({ error: "not found" }, { status: 404 });
}
