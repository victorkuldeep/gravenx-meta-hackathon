"use client";

import { useEffect, useState } from "react";
import Button from "../ui/Button";
import { fetchModels, presetById, PROVIDER_PRESETS, type AiModelOption } from "@/lib/ai/providers";
import { getProviderKey, hasProviderKey, setProviderKey } from "@/lib/ai/keyVault";
import { getProviderEndpoint, setProviderEndpoint } from "@/lib/ai/endpointStore";

/**
 * Model Studio - one big professional surface for everything the chat
 * drawer used to do inline: pick a provider adapter, store its session
 * key, test the connection, browse the live model catalogue as compact
 * cards, and activate a provider+model pair for the agent.
 */
export function ModelStudio({
  open,
  onClose,
  activeProviderId,
  activeModelId,
  onActivate,
}: {
  open: boolean;
  onClose: () => void;
  activeProviderId: string;
  activeModelId: string;
  onActivate: (providerId: string, modelId: string) => void;
}) {
  const [selProvider, setSelProvider] = useState(activeProviderId);
  const [baseInput, setBaseInput] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [models, setModels] = useState<AiModelOption[]>([]);
  const [modelsState, setModelsState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selModel, setSelModel] = useState(activeModelId);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelProvider(activeProviderId);
    setSelModel(activeModelId);
    setModels([]);
    setModelsState("idle");
    setModelsError(null);
    setFilter("");
    const preset = presetById(activeProviderId);
    setBaseInput(preset.editableBaseURL ? getProviderEndpoint(activeProviderId) || preset.baseURL : preset.baseURL);
    setKeyInput(getProviderKey(activeProviderId));
  }, [open, activeProviderId, activeModelId]);

  if (!open) return null;
  const preset = presetById(selProvider);
  const baseURL = selProvider === "custom" ? baseInput : preset.baseURL;
  const visible = filter.trim()
    ? models.filter((m) => `${m.label} ${m.id}`.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 60)
    : models.slice(0, 60);

  const test = async () => {
    const key = keyInput.trim() || getProviderKey(selProvider);
    if (!key) {
      setModelsError("Enter a key first - the list endpoint needs it.");
      setModelsState("error");
      return;
    }
    setModelsState("loading");
    setModelsError(null);
    const r = await fetchModels(baseURL, key);
    if (r.ok) {
      setModels(r.models);
      setModelsState("ok");
      const preferred =
        preset.defaultModel && r.models.some((m) => m.id === preset.defaultModel) ? preset.defaultModel : (r.models[0]?.id ?? "");
      setSelModel((cur) => (cur && r.models.some((m) => m.id === cur) ? cur : preferred));
    } else {
      setModels([]);
      setModelsState("error");
      setModelsError(r.error ?? "List failed.");
    }
  };

  const activate = () => {
    const key = keyInput.trim();
    if (!key || !selModel.trim()) return;
    if (preset.editableBaseURL && !baseURL.trim()) return;
    setProviderKey(selProvider, key);
    if (preset.editableBaseURL) setProviderEndpoint(selProvider, baseURL);
    onActivate(selProvider, selModel.trim());
    onClose();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="model-studio-title" onClick={onClose}>
      <div className="modal-card max-w-3xl flex flex-col" style={{ maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)] shrink-0">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
              Providers · keys · models
            </p>
            <h2 id="model-studio-title" className="mt-1 text-lg font-bold text-ivory-950">
              Model Studio
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ivory-600">
              Keys stay in this tab only and are forwarded per request - never stored on disk or logged.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Model Studio"
            className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[1.5px] text-ivory-500">Provider adapter</p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {PROVIDER_PRESETS.map((p) => {
                const active = p.id === activeProviderId;
                const selected = p.id === selProvider;
                const keyed = hasProviderKey(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelProvider(p.id);
                      setBaseInput(p.editableBaseURL ? getProviderEndpoint(p.id) || p.baseURL : p.baseURL);
                      setKeyInput(getProviderKey(p.id));
                      setModels([]);
                      setModelsState("idle");
                      setModelsError(null);
                      setSelModel("");
                      setFilter("");
                    }}
                    aria-pressed={selected}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-colors cursor-pointer ${
                      selected
                        ? "border-[#9A7653] bg-[#FBF6EC]"
                        : "border-[var(--color-line-soft)] bg-[var(--color-canvas)] hover:border-[#C9A86A]"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${keyed ? "bg-[#32815B]" : "bg-ivory-400"}`} title={keyed ? "Key saved for this tab" : "No key yet"} />
                      <span className="text-[13px] font-semibold text-ivory-950">{p.label}</span>
                      {active && (
                        <span className="rounded-full bg-ivory-950 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-ivory-100">
                          Active
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-ivory-600">{p.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-3 py-3 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[1.5px] text-ivory-500">
              {preset.label} · key &amp; catalogue
            </p>
            {selProvider === "custom" && (
              <input
                value={baseInput}
                onChange={(e) => setBaseInput(e.target.value)}
                placeholder="https://your-host/v1"
                spellCheck={false}
                aria-label="Custom endpoint base URL"
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-[11px] text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
              />
            )}
            <div className="flex gap-1.5">
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={preset.keyPlaceholder}
                autoComplete="off"
                spellCheck={false}
                aria-label={preset.keyLabel}
                className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-[11px] text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
              />
              <Button size="sm" variant="secondary" onClick={() => void test()} disabled={modelsState === "loading"}>
                {modelsState === "loading" ? "Testing…" : "Test & List"}
              </Button>
            </div>
            {modelsError && (
              <p className="rounded-lg border border-[#E5C98F] bg-[#F5EEDF] px-2.5 py-1.5 text-[11px] text-[#8A6A2F]" role="alert">
                {modelsError} You can still type a model ID below.
              </p>
            )}
            {modelsState === "ok" && (
              <div className="flex gap-1.5">
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={`Filter ${models.length} models…`}
                  aria-label="Filter models"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-[11px] text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                />
              </div>
            )}
            {visible.length > 0 && (
              <ul className="grid max-h-56 gap-1 overflow-y-auto pr-0.5 sm:grid-cols-2">
                {visible.map((m) => {
                  const selected = m.id === selModel;
                  const meta = [
                    m.contextLength ? `${Math.round(m.contextLength / 1000)}k` : null,
                    m.promptPrice ? `$${m.promptPrice}` : null,
                  ].filter(Boolean).join(" · ");
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setSelModel(m.id)}
                        aria-pressed={selected}
                        title={m.id}
                        className={`relative w-full truncate overflow-hidden rounded-lg border px-2 py-1.5 text-left transition-colors cursor-pointer ${
                          selected ? "border-[#9A7653] bg-[#FBF6EC]" : "border-transparent hover:border-[#E3D9C6] hover:bg-[#FBF8F1]"
                        }`}
                      >
                        {selected && (
                          <span aria-hidden="true" className="absolute right-0 top-0 h-5 w-5 bg-[#32815B] shadow-sm" style={{ clipPath: "polygon(100% 0, 0 0, 100% 100%)" }} />
                        )}
                        <span className="block truncate font-mono text-[11px] font-semibold text-ivory-950">{m.label}</span>
                        {meta && <span className="block truncate font-mono text-[10px] text-ivory-500">{meta}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex gap-1.5">
              <input
                value={selModel}
                onChange={(e) => setSelModel(e.target.value)}
                placeholder="Or type a model ID directly"
                spellCheck={false}
                aria-label="Model ID"
                className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-[11px] text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-[var(--color-line-soft)] shrink-0 flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-[11px] text-ivory-500">
            {selModel.trim() ? (
              <>Will activate: <span className="font-mono font-semibold text-ivory-800">{preset.label} · {selModel.trim()}</span></>
            ) : (
              "Pick or type a model to activate."
            )}
          </p>
          <div className="flex gap-1.5 shrink-0">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" onClick={activate} disabled={!keyInput.trim() || !selModel.trim() || (preset.editableBaseURL && !baseURL.trim())}>
              Activate provider
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
