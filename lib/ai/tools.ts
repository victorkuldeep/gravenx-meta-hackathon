import { z } from "zod";
import type { ChatMessage, ChatUsage } from "./providers";
import { policyCaps, resolveNeedsApproval } from "@/lib/setup/policy";

/**
 * Headless tool registry + agent loop (Phase 2).
 *
 * Tools are pure TypeScript behind zod-validated JSON schemas - the model
 * only ever sees {name, description, parameters}. Read tools auto-execute;
 * anything that mutates pauses the loop for human approval (Apply/Discard
 * in the panel). Max 8 model turns per user message; every step is bounded
 * and every failure degrades to words, never a stuck spinner.
 */

export interface AgentTool {
  name: string;
  description: string;
  /** Approval-card scope line. Defaults to the canvas line in AiDock. */
  approvalHint?: string;
  /** True when execute() reaches the live Salesforce org - global read-only forces Apply. */
  orgTouch?: boolean;
  /** JSON Schema object for the provider's function-calling shape. */
  parameters: Record<string, unknown>;
  /** Mutations wait for explicit Apply in the panel. */
  needsApproval: boolean;
  /** True when the canvas can undo the apply (System mutate path). Omit when unsure - the card stays silent. */
  undoable?: boolean;
  /** Short human label for the approval card, derived from args. */
  label: (args: unknown) => string;
  schema: z.ZodTypeAny;
  execute: (args: z.infer<z.ZodTypeAny>) => Promise<ToolOutcome>;
}

export interface ToolOutcome {
  ok: boolean;
  /** JSON-serializable summary fed back to the model. */
  result?: unknown;
  error?: string;
}

export interface ApprovalRequest {
  callId: string;
  tool: AgentTool;
  args: unknown;
  label: string;
}

export interface LoopEvents {
  onToken?: (delta: string) => void;
  onToolAuto?: (name: string, label: string, outcome: ToolOutcome) => void;
  onApproval?: (req: ApprovalRequest) => Promise<"apply" | "discard">;
  onUsage?: (u: { promptTokens?: number; completionTokens?: number; totalTokens?: number }) => void;
}

export interface LoopResult {
  text: string;
  steps: number;
  stopped?: string;
}

// Step cap lives in the agent policy (Setup tab) - see policyCaps().

interface PendingCall {
  id: string;
  name: string;
  argsText: string;
}

function toolDefs(tools: AgentTool[]): Record<string, unknown>[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/** Streaming chat that also accumulates function tool_calls across deltas. */
async function streamWithTools(args: {
  baseURL: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools: Record<string, unknown>[];
  signal?: AbortSignal;
  onToken: (d: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<{ text: string; calls: { id: string; name: string; argsText: string }[]; usage?: ChatUsage; error?: string }> {
  const { baseURL, apiKey, model, messages, tools, signal, onToken, fetchImpl = fetch } = args;
  let res: Response;
  try {
    res = await fetchImpl("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseURL: baseURL.trim(), apiKey, model, messages, tools, timeoutMs: 120000 }),
      signal: signal ?? AbortSignal.timeout(130000),
    });
  } catch (e) {
    return { text: "", calls: [], usage: undefined, error: e instanceof DOMException && e.name === "AbortError" ? "Stopped." : e instanceof Error ? e.message : "Request failed." };
  }
  if (!res.ok || !res.body) {
    let detail = `Chat failed (${res.status}).`;
    try {
      const j = (await res.json()) as { error?: string | { message?: string } };
      if (typeof j.error === "string") detail = j.error;
      else if (j.error?.message) detail = j.error.message;
    } catch {
      /* keep status */
    }
    return { text: "", calls: [], usage: undefined, error: detail };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  const calls = new Map<number, PendingCall>();
  let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const data = t.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const ch = JSON.parse(data) as {
            choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
          };
          const delta = ch.choices?.[0]?.delta;
          const token = delta?.content ?? delta?.reasoning_content ?? delta?.reasoning;
          if (token) {
            text += token;
            onToken(token);
          }
          for (const tc of delta?.tool_calls ?? []) {
            const idx = tc.index ?? 0;
            const cur = calls.get(idx) ?? { id: "", name: "", argsText: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.argsText += tc.function.arguments;
            calls.set(idx, cur);
          }
          if (ch.usage) {
            usage = { promptTokens: ch.usage.prompt_tokens, completionTokens: ch.usage.completion_tokens, totalTokens: ch.usage.total_tokens };
          }
        } catch {
          /* heartbeat - ignore */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return {
    text,
    calls: [...calls.values()].filter((c) => c.name).map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, argsText: c.argsText })),
    usage,
  };
}

function parseArgs(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "Arguments were not valid JSON." };
  }
}

/**
 * Run one user message through model -> tools -> model until a final text
 * answer (or the step cap). Approval-gated tools pause for the panel.
 */
export async function runAgentLoop(args: {
  skill?: string;
  baseURL: string;
  apiKey: string;
  model: string;
  system: string;
  history: ChatMessage[];
  tools: AgentTool[];
  signal?: AbortSignal;
  events?: LoopEvents;
  fetchImpl?: typeof fetch;
}): Promise<LoopResult> {
  const { skill, baseURL, apiKey, model, system, history, tools, signal, events, fetchImpl } = args;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const messages: ChatMessage[] = [{ role: "system", content: system }, ...history];
  let finalText = "";
  for (let step = 0; step < policyCaps().maxSteps; step++) {
    const r = await streamWithTools({
      baseURL,
      apiKey,
      model,
      messages,
      tools: toolDefs(tools),
      signal,
      onToken: (d) => events?.onToken?.(d),
      fetchImpl,
    });
    if (r.error && !r.text && r.calls.length === 0) {
      return { text: finalText, steps: step + 1, stopped: r.error };
    }
    if (r.usage) events?.onUsage?.(r.usage);
    if (r.calls.length === 0) {
      finalText += (finalText ? "\n" : "") + r.text;
      return { text: finalText, steps: step + 1 };
    }
    // Feed the assistant turn (with its tool calls) back for coherence.
    messages.push({
      role: "assistant",
      content: r.text,
    } as ChatMessage);
    const toolResults: { name: string; ok: boolean; payload: unknown }[] = [];
    for (const call of r.calls) {
      const tool = byName.get(call.name);
      if (!tool) {
        toolResults.push({ name: call.name, ok: false, payload: "Unknown tool - ignoring." });
        continue;
      }
      const parsed = parseArgs(call.argsText);
      if (!parsed.ok) {
        toolResults.push({ name: call.name, ok: false, payload: parsed.error });
        continue;
      }
      const checked = tool.schema.safeParse(parsed.value);
      if (!checked.success) {
        toolResults.push({ name: call.name, ok: false, payload: "Arguments failed validation." });
        continue;
      }
      const label = tool.label(checked.data);
      const needsApproval = resolveNeedsApproval(skill ?? "", tool);
      if (needsApproval) {
        const decision = events?.onApproval
          ? await events.onApproval({ callId: call.id, tool, args: checked.data, label })
          : "discard";
        if (decision !== "apply") {
          toolResults.push({ name: call.name, ok: false, payload: "Discarded by the user - do not retry without asking." });
          continue;
        }
      }
      let outcome: ToolOutcome;
      try {
        outcome = await tool.execute(checked.data);
      } catch (e) {
        outcome = { ok: false, error: e instanceof Error ? e.message : "Tool crashed." };
      }
      if (!needsApproval) events?.onToolAuto?.(tool.name, label, outcome);
      toolResults.push({
        name: call.name,
        ok: outcome.ok,
        payload: outcome.ok ? (outcome.result ?? "Done.") : (outcome.error ?? "Failed."),
      });
    }
    messages.push({
      role: "user",
      content: `Tool results:\n${toolResults.map((t) => `- ${t.name}: ${t.ok ? "ok" : "FAILED"} ${JSON.stringify(t.payload).slice(0, 2000)}`).join("\n")}\nContinue: use more tools if needed, else give the final answer in words.`,
    });
    finalText += (finalText ? "\n" : "") + r.text;
  }
  const stepCap = policyCaps().maxSteps;
  return { text: finalText, steps: stepCap, stopped: `Step cap (${stepCap}) reached - summarize what is done and what remains.` };
}
