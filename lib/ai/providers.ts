import { z } from "zod";

/**
 * OpenAI-compatible provider layer for the GRAVENX agent.
 *
 * One adapter speaks to every v1 provider (OpenAI, OpenRouter, Groq,
 * DeepSeek, any custom baseURL) through the shared `/chat/completions`
 * and `/models` shapes - no per-vendor SDKs. Browser providers block
 * direct calls (CORS/egress), so the client talks to our same-origin
 * proxy routes (/api/ai/*), which forward the session key per request -
 * exactly like the Salesforce token proxy. Keys are BYOK session-only:
 * forwarded, never stored, never logged.
 *
 * Endpoint shapes below are search-grounded and repo-corroborated (the
 * GROQ sample in lib/system-design/demo.ts already uses
 * https://api.groq.com + /openai/v1/chat/completions). Treat them as
 * provisional until the Phase-0 live spike confirms each preset; every
 * preset degrades to free-text model entry when its list endpoint fails.
 */

export interface ProviderPreset {
  id: string;
  label: string;
  /** Origin + version prefix, no trailing slash. Empty for custom. */
  baseURL: string;
  modelsPath: string;
  chatPath: string;
  keyLabel: string;
  keyPlaceholder: string;
  editableBaseURL: boolean;
  hint: string;
  /** Working default, pre-selected when the live list contains it. */
  defaultModel?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    modelsPath: "/models",
    chatPath: "/chat/completions",
    keyLabel: "OpenAI API key",
    keyPlaceholder: "sk-…",
    editableBaseURL: false,
    hint: "Get a key at platform.openai.com",
    defaultModel: "gpt-4o-mini",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    modelsPath: "/models",
    chatPath: "/chat/completions",
    keyLabel: "OpenRouter API key",
    keyPlaceholder: "sk-or-…",
    editableBaseURL: false,
    hint: "One key routes to 300+ models - openrouter.ai/keys",
    defaultModel: "deepseek/deepseek-chat",
  },
  {
    id: "groq",
    label: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    modelsPath: "/models",
    chatPath: "/chat/completions",
    keyLabel: "Groq API key",
    keyPlaceholder: "gsk_…",
    editableBaseURL: false,
    hint: "Fast inference - console.groq.com/keys",
    defaultModel: "openai/gpt-oss-120b",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    modelsPath: "/models",
    chatPath: "/chat/completions",
    keyLabel: "DeepSeek API key",
    keyPlaceholder: "sk-…",
    editableBaseURL: false,
    hint: "Get a key at platform.deepseek.com",
    defaultModel: "deepseek-chat",
  },
  {
    id: "custom",
    label: "Custom endpoint",
    baseURL: "",
    modelsPath: "/models",
    chatPath: "/chat/completions",
    keyLabel: "API key",
    keyPlaceholder: "Bearer token",
    editableBaseURL: true,
    hint: "Any OpenAI-compatible server (Together, vLLM, Ollama cloud, …)",
  },
];

export function presetById(id: string): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[1];
}

export interface AiModelOption {
  id: string;
  label: string;
  contextLength?: number;
  promptPrice?: string;
  completionPrice?: string;
}

const openRouterPricing = z
  .object({ prompt: z.string().optional(), completion: z.string().optional() })
  .partial();
const modelEntry = z.union([
  z.string(),
  z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      model: z.string().optional(),
      created: z.number().optional(),
      context_length: z.number().optional(),
      contextLength: z.number().optional(),
      pricing: openRouterPricing.optional(),
    })
    .passthrough(),
]);
// OpenAI-style { data: [...] } plus Ollama-style { models: [...] }.
const modelsPayload = z.union([
  z.object({ data: z.array(z.unknown()) }),
  z.object({ models: z.array(z.unknown()) }),
]);

/** Normalize every known list shape to one picker-ready option list. */
export function normalizeModels(payload: unknown): AiModelOption[] {
  const parsed = modelsPayload.safeParse(payload);
  if (!parsed.success) return [];
  const list = "data" in parsed.data ? parsed.data.data : parsed.data.models;
  return list.flatMap((raw): AiModelOption[] => {
    // One malformed entry must never poison the whole list.
    if (typeof raw === "string") return [{ id: raw, label: raw }];
    const entry = modelEntry.safeParse(raw);
    if (!entry.success || typeof entry.data !== "object") return [];
    const m = entry.data;
    const id = m.id ?? m.name ?? m.model;
    if (!id) return [];
    return [
      {
        id,
        label: m.name ?? id,
        contextLength: m.context_length ?? m.contextLength,
        promptPrice: m.pricing?.prompt,
        completionPrice: m.pricing?.completion,
      },
    ];
  });
}

export interface ModelsResult {
  ok: boolean;
  models: AiModelOption[];
  error?: string;
}

function errText(e: unknown): string {
  if (e instanceof DOMException && e.name === "AbortError") return "Request timed out.";
  return e instanceof Error ? e.message : "Request failed.";
}

const proxyModelsResponse = z.object({
  ok: z.boolean(),
  models: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      contextLength: z.number().optional(),
      promptPrice: z.string().optional(),
      completionPrice: z.string().optional(),
    }),
  ),
  error: z.string().optional(),
});

/**
 * Live model discovery for the picker via our proxy (CORS-proof).
 * Never throws - degrades to [] with a manual-entry hint.
 */
export async function fetchModels(
  baseURL: string,
  apiKey: string,
  timeoutMs = 15000,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelsResult> {
  if (!baseURL.trim()) return { ok: false, models: [], error: "Set the endpoint URL first." };
  try {
    const res = await fetchImpl("/api/ai/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseURL: baseURL.trim(), apiKey, timeoutMs }),
      signal: AbortSignal.timeout(Math.min(timeoutMs + 5000, 40000)),
    });
    const parsed = proxyModelsResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success || !parsed.data.ok) {
      const detail = parsed.success ? (parsed.data.error ?? "List failed.") : "List failed.";
      return { ok: false, models: [], error: `${detail} Type a model ID manually.` };
    }
    return { ok: true, models: parsed.data.models };
  } catch (e) {
    return { ok: false, models: [], error: `${errText(e)} Type a model ID manually.` };
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface StreamResult {
  ok: boolean;
  text: string;
  usage?: ChatUsage;
  error?: string;
}

const chatErrorPayload = z.object({ error: z.union([z.string(), z.object({ message: z.string() }).passthrough()]) }).partial();
const streamChoice = z.object({
  choices: z
    .array(
      z.object({
        delta: z.object({ content: z.string().optional(), reasoning_content: z.string().optional(), reasoning: z.string().optional() }).partial(),
        message: z.object({ content: z.string().optional() }).partial().optional(),
      }).partial(),
    )
    .optional(),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional(), total_tokens: z.number().optional() })
    .partial()
    .optional(),
}).partial();

/**
 * Streaming chat completion over SSE. Calls onToken per content delta and
 * resolves with the full text + usage. Aborted via signal (Stop button).
 */
export async function streamChatCompletion(args: {
  baseURL: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  timeoutMs?: number;
  onToken: (delta: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<StreamResult> {
  const { baseURL, apiKey, model, messages, signal, timeoutMs = 120000, onToken, fetchImpl = fetch } = args;
  if (!baseURL.trim()) return { ok: false, text: "", error: "Set the endpoint URL first." };
  if (!model.trim()) return { ok: false, text: "", error: "Pick or type a model first." };
  let res: Response;
  try {
    res = await fetchImpl("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseURL: baseURL.trim(), apiKey, model: model.trim(), messages, timeoutMs }),
      signal: signal ?? AbortSignal.timeout(timeoutMs + 10000),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: false, text: "", error: "Stopped." };
    }
    return { ok: false, text: "", error: errText(e) };
  }
  if (!res.ok || !res.body) {
    let detail = `Chat failed (${res.status}).`;
    try {
      const parsed = chatErrorPayload.safeParse(await res.json());
      const err = parsed.success ? parsed.data.error : undefined;
      if (typeof err === "string" && err) detail = err;
      else if (err && typeof err === "object" && err.message) detail = err.message;
    } catch {
      /* keep status text */
    }
    return { ok: false, text: "", error: detail };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let usage: ChatUsage | undefined;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const chunk = streamChoice.parse(JSON.parse(data));
          const choice = chunk.choices?.[0];
          // Reasoning models (DeepSeek-R1, Qwen, some OpenRouter free tiers)
          // stream thinking separately - surface it, never swallow it.
          const delta = choice?.delta?.content ?? choice?.delta?.reasoning_content ?? choice?.delta?.reasoning ?? choice?.message?.content;
          if (delta) {
            text += delta;
            onToken(delta);
          }
          const u = chunk.usage;
          if (u && (u.prompt_tokens !== undefined || u.completion_tokens !== undefined || u.total_tokens !== undefined)) {
            usage = { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens, totalTokens: u.total_tokens };
          }
        } catch {
          /* provider heartbeat / comment - ignore */
        }
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: true, text, usage, error: undefined };
    }
    return { ok: false, text, error: errText(e) };
  } finally {
    reader.releaseLock();
  }
  return { ok: true, text, usage };
}
