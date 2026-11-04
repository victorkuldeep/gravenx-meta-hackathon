import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveProxyBase } from "@/lib/ai/proxy";

/**
 * POST /api/ai/chat - streaming chat completions through our proxy.
 * Body: { baseURL, apiKey, model, messages, tools?, timeoutMs? }.
 * Always streams SSE back (pass-through bytes). The key is forwarded to
 * the provider only - never stored, never logged. CORS-proof for browsers.
 */

const MAX_BODY_CHARS = 300000;

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().max(100000),
});

const toolSchema = z
  .object({
    type: z.literal("function"),
    function: z.object({ name: z.string(), description: z.string().optional(), parameters: z.record(z.string(), z.unknown()).optional() }),
  })
  .passthrough();

const schema = z.object({
  baseURL: z.string().min(1).max(500),
  apiKey: z.string().min(1).max(5000),
  model: z.string().min(1).max(200),
  messages: z.array(messageSchema).min(1).max(200),
  tools: z.array(toolSchema).max(50).optional(),
  timeoutMs: z.number().int().positive().max(300000).optional(),
});

export async function POST(req: NextRequest) {
  const body: unknown = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (JSON.stringify(body).length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: "Request too large." }, { status: 413 });
  }
  const { apiKey, model, messages, tools, timeoutMs } = parsed.data;
  const target = resolveProxyBase(parsed.data.baseURL);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 });
  const modelId = model.trim();
  // Proven shape (archtools copilot): bounded output + calm temperature.
  // DeepSeek reasoner rejects temperature outright - never send it there.
  const isReasoner = modelId.toLowerCase().includes("deepseek-reasoner");
  let upstream: Response;
  try {
    upstream = await fetch(`${target.base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: modelId,
        messages,
        stream: true,
        max_tokens: 4096,
        ...(isReasoner ? {} : { temperature: 0.3 }),
        ...(tools && tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs ?? 120000),
    });
  } catch (e) {
    const stopped = e instanceof DOMException && e.name === "AbortError";
    return NextResponse.json({ error: stopped ? "Stopped." : "Provider unreachable." }, { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    let detail = `Chat failed (${upstream.status}).`;
    try {
      const j = (await upstream.json()) as { error?: string | { message?: string } };
      const err = j.error;
      if (typeof err === "string" && err) detail = err;
      else if (err && typeof err === "object" && err.message) detail = err.message;
    } catch {
      /* keep status text */
    }
    return NextResponse.json({ error: detail }, { status: 502 });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
