import { ID_RE, getInbox } from "../../../../lib/webhooks/server";

function inboxFor(id: string) {
  return getInbox(id);
}

/**
 * Rebuild a platform Request from the framework's request object. The stub
 * only accepts a genuine Request; forwarding the framework object makes the
 * runtime stringify it ("Invalid URL: [object Request]").
 */
async function forwardable(req: Request): Promise<Request> {
  if (req.method === "GET" || req.method === "HEAD") {
    return new Request(req.url, { method: req.method, headers: req.headers });
  }
  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: await req.text().catch(() => ""),
  });
}

/** Receive leg: any sender POSTs here; the DO stores it only if registered. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  try {
    const stub = inboxFor(id);
    return await stub.fetch(await forwardable(req));
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ ok: false, error: String((err as Error)?.message ?? err).slice(0, 200) }, { status: 500 });
  }
}

/** Browser sanity check: forwards to the DO hint. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  try {
    const stub = inboxFor(id);
    return await stub.fetch(await forwardable(req));
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ ok: false, error: String((err as Error)?.message ?? err).slice(0, 200) }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    },
  });
}
