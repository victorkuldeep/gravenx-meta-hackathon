/**
 * POST /api/webhooks/register { token, instanceUrl, name? }
 * Salesforce-validated only. Mints a uuid, claims its inbox DO for the
 * caller, and records it in the caller's owner index (active, capped at 10).
 */
import { doJson, getInbox, getOwnerInbox, resolveOwnerName } from "../../../../lib/webhooks/server";

export async function POST(req: Request) {
  let body: { token?: unknown; instanceUrl?: unknown; name?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const { token, instanceUrl } = body ?? {};
  const name = typeof body?.name === "string" ? body.name.slice(0, 80) : "";
  const note = typeof body?.note === "string" ? body.note.slice(0, 280) : "";
  try {
    const owner = await resolveOwnerName(token, instanceUrl);
    const session = { token, instanceUrl };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const uuid = crypto.randomUUID();
      const claim = await doJson(getInbox(uuid), "claim", { ...session, name });
      if (claim.status === 409) continue; // taken: mint another
      if (claim.status !== 200 || claim.data.ok !== true) {
        return Response.json(claim.data, { status: claim.status });
      }
      const reg = await doJson(getOwnerInbox(owner), "claim", { ...session, uuid, name, note, active: true });
      if (reg.status !== 200 || reg.data.ok !== true) {
        // Roll back the inbox claim so the uuid can never strand claimed.
        await doJson(getInbox(uuid), "release", session).catch(() => undefined);
        return Response.json(reg.data, { status: reg.status });
      }
      await doJson(getOwnerInbox(owner), "sync", {
        ...session,
        uuid,
        name,
        note,
        expiresAt: claim.data.expiresAt,
        lastAt: Date.now(),
      }).catch(() => undefined);
      return Response.json({ ok: true, uuid, expiresAt: claim.data.expiresAt });
    }
    return Response.json({ ok: false, error: "taken" }, { status: 409 });
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json(
      { ok: false, error: String((err as Error)?.message ?? err).slice(0, 200) },
      { status: 500 }
    );
  }
}
