import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeModels } from "@/lib/ai/providers";
import { resolveProxyBase } from "@/lib/ai/proxy";

/**
 * POST /api/ai/models - list provider models through our proxy.
 * Body: { baseURL, apiKey, timeoutMs? }. The key is forwarded to the
 * provider only - never stored, never logged. CORS-proof for browsers.
 */

const schema = z.object({
  baseURL: z.string().min(1).max(500),
  apiKey: z.string().min(1).max(5000),
  timeoutMs: z.number().int().positive().max(30000).optional(),
});

function fail(error: string, status = 400) {
  return NextResponse.json({ ok: false, models: [], error }, { status });
}

export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("Bad request.");
  const { apiKey, timeoutMs } = parsed.data;
  const target = resolveProxyBase(parsed.data.baseURL);
  if (!target.ok) return fail(target.error);
  let res: Response;
  try {
    res = await fetch(`${target.base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs ?? 15000),
    });
  } catch (e) {
    const timeout = e instanceof DOMException && e.name === "AbortError";
    return fail(timeout ? "Provider timed out - check the endpoint, then type a model ID manually." : "Provider unreachable - type a model ID manually.", 502);
  }
  if (res.status === 401 || res.status === 403) {
    return fail("Key rejected (401/403) - check the key, then type a model ID manually.", 502);
  }
  if (!res.ok) {
    return fail(`List failed (${res.status}) - type a model ID manually.`, 502);
  }
  const models = normalizeModels(await res.json().catch(() => null));
  if (models.length === 0) {
    return fail("No models parsed - type a model ID manually.", 502);
  }
  return NextResponse.json({ ok: true, models });
}
