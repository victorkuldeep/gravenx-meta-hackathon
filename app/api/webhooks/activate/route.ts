/**
 * POST /api/webhooks/activate { token, instanceUrl, uuids: [{ uuid, active }] }
 * Flips live/paused across the caller's registry. Cap: 10 live at once.
 */
import { ID_RE, doJson, getInbox, getOwnerInbox, resolveOwnerName } from "../../../../lib/webhooks/server";

export async function POST(req: Request) {
  let body: { token?: unknown; instanceUrl?: unknown; uuids?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const raw = Array.isArray(body?.uuids) ? (body.uuids as unknown[]) : null;
  if (!raw || raw.length > 100) {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const uuids: { uuid: string; active: boolean }[] = [];
  for (const u of raw) {
    const row = u as { uuid?: unknown; active?: unknown };
    if (typeof row?.uuid !== "string" || !ID_RE.test(row.uuid) || typeof row?.active !== "boolean") {
      return Response.json({ ok: false, error: "bad request" }, { status: 400 });
    }
    uuids.push({ uuid: row.uuid, active: row.active });
  }
  try {
    const owner = await resolveOwnerName(body?.token, body?.instanceUrl);
    const touch = await doJson(getOwnerInbox(owner), "touch", {
      token: body?.token,
      instanceUrl: body?.instanceUrl,
      uuids,
    });
    if (touch.status !== 200 || touch.data.ok !== true) {
      return Response.json(touch.data, { status: touch.status });
    }
    // Flip the inbox-level pause switch too, so paused inboxes stop capturing.
    // Best-effort per inbox: an expired inbox must not fail the whole update.
    const session = { token: body?.token, instanceUrl: body?.instanceUrl };
    await Promise.all(
      uuids.map((u) =>
        doJson(getInbox(u.uuid), "setPaused", { ...session, paused: !u.active }).catch(() => undefined)
      )
    );
    return Response.json(touch.data, { status: touch.status });
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json(
      { ok: false, error: String((err as Error)?.message ?? err).slice(0, 200) },
      { status: 500 }
    );
  }
}
