"use client";

import { useEffect, useState } from "react";
import { fetchModels, PROVIDER_PRESETS, type AiModelOption } from "@/lib/ai/providers";
import { hasProviderKey, setProviderKey } from "@/lib/ai/keyVault";
import { getProviderEndpoint, setProviderEndpoint } from "@/lib/ai/endpointStore";
import { dispatchAiActivate } from "@/lib/ai/activateEvent";

/**
 * Brain quick-connect: the Arena gate's full-space modal. Provider +
 * endpoint + key + model, written to the same vault/endpoint stores Setup
 * and Model Studio use - so connecting here lights up everywhere, and the
 * activation event switches the agent dock to this provider/model.
 * Keys stay in this tab's session memory, never on disk.
 */
export function BrainQuickConnect({
  open,
  onClose,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [providerId, setProviderId] = useState(PROVIDER_PRESETS[0]?.id ?? "openai");
  const [baseInput, setBaseInput] = useState("");
  const [key, setKey] = useState("");
  const [models, setModels] = useState<AiModelOption[]>([]);
  const [modelsState, setModelsState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelId, setModelId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProviderId(PROVIDER_PRESETS[0]?.id ?? "openai");
    setBaseInput("");
    setKey("");
    setModels([]);
    setModelsState("idle");
    setModelsError(null);
    setModelId("");
    setError(null);
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const preset = PROVIDER_PRESETS.find((p) => p.id === providerId) ?? PROVIDER_PRESETS[0];
  const baseURL = preset?.editableBaseURL ? baseInput.trim() : (preset?.baseURL ?? "");
  const ready = key.trim() !== "" && modelId.trim() !== "" && (!preset?.editableBaseURL || baseURL !== "");

  const pickProvider = (id: string) => {
    const p = PROVIDER_PRESETS.find((x) => x.id === id);
    setProviderId(id);
    setBaseInput(p?.editableBaseURL ? getProviderEndpoint(id) : "");
    setModels([]);
    setModelsState("idle");
    setModelsError(null);
    setModelId("");
    setError(null);
  };

  const test = async () => {
    const k = key.trim();
    if (preset?.editableBaseURL && !baseURL) {
      setModelsError("Paste the endpoint URL first.");
      setModelsState("error");
      return;
    }
    if (!k) {
      setModelsError("Enter a key first - the list endpoint needs it.");
      setModelsState("error");
      return;
    }
    setModelsState("loading");
    setModelsError(null);
    const r = await fetchModels(baseURL, k);
    if (r.ok) {
      setModels(r.models);
      setModelsState("ok");
      const preferred =
        preset?.defaultModel && r.models.some((m) => m.id === preset.defaultModel) ? preset.defaultModel : (r.models[0]?.id ?? "");
      setModelId((cur) => (cur && r.models.some((m) => m.id === cur) ? cur : preferred));
    } else {
      setModels([]);
      setModelsState("error");
      setModelsError(r.error ?? "List failed.");
    }
  };

  const connect = () => {
    const k = key.trim();
    const m = modelId.trim();
    if (!k) {
      setError("Paste a key first - it stays in this browser's vault.");
      return;
    }
    if (preset?.editableBaseURL && !baseURL) {
      setError("Paste the custom endpoint URL first.");
      return;
    }
    if (!m) {
      setError("Pick a model (Test & List) or type a model ID - the agent needs one to start.");
      return;
    }
    setProviderKey(providerId, k);
    if (preset?.editableBaseURL) setProviderEndpoint(providerId, baseURL);
    setError(null);
    if (!hasProviderKey(providerId)) {
      setError("The key did not stick - browser storage may be blocked.");
      return;
    }
    dispatchAiActivate(providerId, m);
    onConnected();
  };

  return (
    <div className="modal-overlay modal-arena" role="dialog" aria-modal="true" aria-labelledby="brain-connect-title" onClick={onClose}>
      <div className="modal-card flex flex-col" style={{ height: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)] shrink-0">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">Arena · brain</p>
            <h2 id="brain-connect-title" className="mt-1 text-lg font-bold text-ivory-950">
              Connect a brain
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ivory-600">
              Provider, endpoint, key, model - then the Arena opens with this brain active. Same vault Setup uses.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close brain connect"
            className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[1.5px] text-ivory-500">Provider adapter</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {PROVIDER_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickProvider(p.id)}
                    aria-pressed={p.id === providerId}
                    title={p.hint}
                    className={`rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer ${
                      p.id === providerId
                        ? "border-[#9A7653] bg-[#FBF6EC]"
                        : "border-[var(--color-line-soft)] bg-[var(--color-canvas)] hover:border-[#C9A86A]"
                    }`}
                  >
                    <span className="block text-[12px] font-bold text-ivory-950">{p.label}</span>
                    <span className="block truncate text-[11px] text-ivory-500">{p.hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {preset?.editableBaseURL && (
              <div>
                <label htmlFor="arena-custom-url" className="mb-1 block text-[11px] font-semibold uppercase tracking-[1.5px] text-ivory-500">
                  Custom endpoint base URL
                </label>
                <input
                  id="arena-custom-url"
                  value={baseInput}
                  onChange={(e) => {
                    setBaseInput(e.target.value);
                    setModelsState("idle");
                    setError(null);
                  }}
                  placeholder="https://your-host/v1"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 font-mono text-[12px] text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                />
              </div>
            )}

            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-[1.5px] text-ivory-500">API key</p>
              <div className="flex flex-col gap-1.5 sm:flex-row">
                <input
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    setModelsState("idle");
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void test();
                  }}
                  placeholder={preset?.keyPlaceholder ?? "API key"}
                  type="password"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Provider API key"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 font-mono text-[12px] text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void test()}
                  disabled={modelsState === "loading"}
                  className="shrink-0 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-[12px] font-bold text-ivory-950 hover:bg-ivory-50 disabled:opacity-50"
                >
                  {modelsState === "loading" ? "Testing…" : "Test & List"}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="arena-model-id" className="mb-1 block text-[11px] font-semibold uppercase tracking-[1.5px] text-ivory-500">
                Model
              </label>
              <input
                id="arena-model-id"
                value={modelId}
                onChange={(e) => {
                  setModelId(e.target.value);
                  setError(null);
                }}
                placeholder="Pick from the catalogue or type a model ID"
                spellCheck={false}
                autoComplete="off"
                className="w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 font-mono text-[12px] text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-col">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[1.5px] text-ivory-500">
              Model catalogue {modelsState === "ok" ? `· ${models.length}` : ""}
            </p>
            {modelsError && (
              <p className="rounded-lg border border-[#E5C98F] bg-[#F5EEDF] px-2.5 py-1.5 text-[11px] text-[#8A6A2F]" role="alert">
                {modelsError} You can still type a model ID.
              </p>
            )}
            {modelsState === "ok" && models.length > 0 && (
              <ul className="grid min-h-0 flex-1 content-start gap-1 overflow-y-auto pr-0.5 sm:grid-cols-2">
                {models.slice(0, 80).map((m) => {
                  const selected = m.id === modelId;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setModelId(m.id);
                          setError(null);
                        }}
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
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {modelsState !== "ok" && !modelsError && (
              <div className="rounded-xl border border-dashed border-[var(--color-line)] px-4 py-10 text-center">
                <p className="text-[13px] font-bold text-ivory-950">No catalogue yet</p>
                <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-ivory-500">
                  Paste the key{preset?.editableBaseURL ? " and endpoint" : ""}, hit Test &amp; List, and the live models land here - or just type a model ID on the left.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line-soft)] px-6 py-3 shrink-0">
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-ivory-500">
            {error ? (
              <span className="font-semibold text-red-700" role="alert">
                {error}
              </span>
            ) : (
              "Same vault Setup uses - connect here and Setup shows it keyed."
            )}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 cursor-pointer rounded-lg border border-[var(--color-line)] px-4 py-2 text-[12px] font-bold text-ivory-950 hover:bg-ivory-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={connect}
            disabled={!ready}
            title={ready ? "Save key and open the Arena" : "Key + model required (endpoint too, for custom)"}
            className="shrink-0 cursor-pointer rounded-lg bg-ivory-950 px-5 py-2 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800 disabled:opacity-50"
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}
