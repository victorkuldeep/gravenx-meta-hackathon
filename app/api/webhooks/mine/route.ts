/**
 * POST /api/webhooks/mine { token, instanceUrl }
 * Returns the caller's registry: every uuid they registered, active or not.
 */
import { doJson, getOwnerInbox, resolveOwnerName } from "../../../../lib/webhooks/server";

export async function POST(req: Request) {
  let body: { token?: unknown; instanceUrl?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  try {
    const owner = await resolveOwnerName(body?.token, body?.instanceUrl);
    const list = await doJson(getOwnerInbox(owner), "list", {
      token: body?.token,
      instanceUrl: body?.instanceUrl,
    });
    return Response.json(list.data, { status: list.status });
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json(
      { ok: false, error: String((err as Error)?.message ?? err).slice(0, 200) },
      { status: 500 }
    );
  }
}
