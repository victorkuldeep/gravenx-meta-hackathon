"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsomorphicLayoutEffect } from "@/lib/ui/useIsomorphicLayoutEffect";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Button from "../ui/Button";
import {
  presetById,
  streamChatCompletion,
  type ChatMessage,
  type ChatUsage,
} from "@/lib/ai/providers";
import { getProviderKey } from "@/lib/ai/keyVault";
import { getProviderEndpoint } from "@/lib/ai/endpointStore";
import { subscribeAiActivate } from "@/lib/ai/activateEvent";
import { skillForPath, systemPromptFor } from "@/lib/ai/skills";
import { runAgentLoop } from "@/lib/ai/tools";
import { toolsForSkill } from "@/lib/ai/toolsSystem";
import { aiHistoryKey, isSalesforceConnected, SESSION_EXPIRED_EVENT } from "@/lib/ai/gate";
import { deleteAiSession, listAiSessions, loadAiSession, newSessionId, saveAiSession, type AiSession } from "@/lib/ai/historyDb";
import { logToolRun } from "@/lib/setup/audit";
import { AiMarkdown } from "./Markdown";
import { ModelStudio } from "./ModelStudio";

function relativeTime(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

interface Turn extends ChatMessage {
  usage?: ChatUsage;
  error?: string;
}

/**
 * GRAVENX agent dock. Global floating button + right-side panel with the
 * active tab's skill pack, tool loop and approval cards. Provider keys,
 * adapters and model catalogue live in Model Studio; the drawer stays a
 * lean chat surface. V1 gate: a live Salesforce connection unlocks AI.
 */
export function AiDock() {
  const pathname = usePathname() ?? "/";
  const skill = useMemo(() => skillForPath(pathname), [pathname]);
  const [open, setOpen] = useState(false);
  const [providerId, setProviderId] = useState("openrouter");
  const [modelId, setModelId] = useState("");
  const [studioOpen, setStudioOpen] = useState(false);
  const [sfOk, setSfOk] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastUsage, setLastUsage] = useState<ChatUsage | null>(null);
  const [totals, setTotals] = useState({ in: 0, out: 0 });
  const [trace, setTrace] = useState<string[]>([]);
  const [approval, setApproval] = useState<{ label: string; tool: string; hint: string; undoable: boolean; resolve: (d: "apply" | "discard") => void } | null>(null);
  const [sessionId, setSessionId] = useState(() => newSessionId());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sessions, setSessions] = useState<AiSession[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const shownRef = useRef(0);
  const flushRef = useRef<{ acc: string; timer: ReturnType<typeof setInterval> | null }>({ acc: "", timer: null });
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Draggable pill: null = docked bottom-right; a position pins it anywhere
  // so it never covers canvas controls. Survives reloads via localStorage.
  // Initialized null so SSR and first client render match - the stored
  // position applies in a pre-paint layout effect (no flash, no mismatch).
  const [dockPos, setDockPos] = useState<{ x: number; y: number } | null>(null);
  useIsomorphicLayoutEffect(() => {
    try {
      const raw = localStorage.getItem("gravenx-ai-pos");
      if (!raw) return;
      const p = JSON.parse(raw) as { x?: unknown; y?: unknown };
      if (typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y)) {
        setDockPos({ x: Math.max(8, p.x), y: Math.max(8, p.y) });
      }
    } catch {
      /* ignore */
    }
  }, []);
  const aiPillRef = useRef<HTMLButtonElement | null>(null);
  const aiDragRef = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const aiSuppressClickRef = useRef(false);

  const preset = presetById(providerId);
  // Editable presets (custom endpoint) resolve through the session-only
  // endpoint store - modal-local state used to evaporate on close.
  const baseURL = preset.editableBaseURL ? getProviderEndpoint(providerId) || preset.baseURL : preset.baseURL;

  // Arena quick-connect lives outside this tree: it writes the vault +
  // endpoint stores, then dispatches activation - applied here like a
  // Model Studio onActivate.
  useEffect(() => {
    return subscribeAiActivate((d) => {
      setProviderId(d.providerId);
      setModelId(d.modelId);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const check = () => setSfOk(isSalesforceConnected());
    const onExpired = () => setSfOk(false);
    check();
    window.addEventListener("focus", check);
    window.addEventListener("storage", check);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => {
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", check);
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    };
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy, trace, approval]);

  const stopFlush = () => {
    if (flushRef.current.timer) clearInterval(flushRef.current.timer);
    flushRef.current.timer = null;
  };

  const noteUsage = (u: ChatUsage) => {
    setLastUsage(u);
    setTotals((t) => ({ in: t.in + (u.promptTokens ?? 0), out: t.out + (u.completionTokens ?? 0) }));
  };

  const persistRef = useRef({ turns, totals, providerId, modelId, skillName: skill.name, sessionId });
  persistRef.current = { turns, totals, providerId, modelId, skillName: skill.name, sessionId };

  /** Persist the live chat per org (fire-and-forget, IDB may be absent). */
  const persist = useCallback(async () => {
    const s = persistRef.current;
    if (s.turns.length === 0) return;
    await saveAiSession(aiHistoryKey(), s.sessionId, {
      providerId: s.providerId,
      modelId: s.modelId,
      skillName: s.skillName,
      turns: s.turns.map((t) => ({ role: t.role, content: t.content })),
      totalIn: s.totals.in,
      totalOut: s.totals.out,
    }).catch(() => {});
  }, []);

  const refreshSessions = useCallback(async () => {
    setSessions(await listAiSessions(aiHistoryKey()).catch(() => []));
  }, []);

  const newChat = useCallback(() => {
    setTurns([]);
    setTrace([]);
    setApproval(null);
    setSendError(null);
    setLastUsage(null);
    setTotals({ in: 0, out: 0 });
    setSessionId(newSessionId());
    setHistoryOpen(false);
  }, []);

  const restoreSession = useCallback(async (id: string) => {
    const rec = await loadAiSession(id).catch(() => null);
    if (!rec) return;
    setProviderId(rec.providerId);
    setModelId(rec.modelId);
    setTurns(rec.turns.map((t) => ({ role: t.role, content: t.content })));
    setTotals({ in: rec.totalIn, out: rec.totalOut });
    setTrace([]);
    setApproval(null);
    setSendError(null);
    setLastUsage(null);
    setSessionId(rec.id);
    setHistoryOpen(false);
  }, []);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (!isSalesforceConnected()) {
      setSfOk(false);
      setSendError("Connect to Salesforce to get started with AI - the org connection unlocks the agent.");
      return;
    }
    const key = getProviderKey(providerId);
    const model = modelId.trim();
    const endpointMissing = preset.editableBaseURL && !getProviderEndpoint(providerId).trim();
    if (!key || !model || endpointMissing) {
      setSendError(
        endpointMissing
          ? "Set the custom endpoint URL first - open Model Studio, paste it, save a key and activate a model."
          : "Open Model Studio, save a key and activate a model first.",
      );
      setStudioOpen(true);
      return;
    }
    setSendError(null);
    setBusy(true);
    const history: ChatMessage[] = [...turns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content })), { role: "user", content: text }];
    setTurns((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setDraft("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    flushRef.current.acc = "";
    shownRef.current = 0;
    flushRef.current.timer = setInterval(() => {
      const acc = flushRef.current.acc;
      if (!acc) return;
      flushRef.current.acc = "";
      shownRef.current += acc.length;
      setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") next[next.length - 1] = { ...last, content: last.content + acc };
        return next;
      });
    }, 120);
    const onToken = (d: string) => {
      flushRef.current.acc += d;
    };
    const finishTurn = (text: string, usage: ChatUsage | undefined, error: string | undefined) => {
      stopFlush();
      const rest = flushRef.current.acc + text.slice(shownRef.current);
      flushRef.current.acc = "";
      setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          next[next.length - 1] = { ...last, content: last.content + rest, usage, error };
        }
        return next;
      });
      if (rest === "" && !error) {
        setTurns((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && last.content === "") {
            next[next.length - 1] = { ...last, content: "", error: "Empty reply - retry or switch model." };
          }
          return next;
        });
      }
    };
    const tools = toolsForSkill(skill.name);
    if (tools.length === 0) {
      const r = await streamChatCompletion({
        baseURL,
        apiKey: key,
        model,
        messages: [{ role: "system", content: systemPromptFor(skill) }, ...history],
        signal: ctrl.signal,
        onToken,
      });
      finishTurn(r.text, r.usage, r.ok ? undefined : r.error);
      if (r.ok && r.usage) noteUsage(r.usage);
      if (!r.ok && r.text === "" && r.error && r.error !== "Stopped.") setSendError(r.error);
    } else {
      const r = await runAgentLoop({
        skill: skill.name,
        baseURL,
        apiKey: key,
        model,
        system: systemPromptFor(skill),
        history,
        tools,
        signal: ctrl.signal,
        events: {
          onToken,
          onUsage: noteUsage,
          onToolAuto: (name, label, outcome) => {
            setTrace((prev) => [...prev, `${label} — ${outcome.ok ? "ok" : `failed: ${outcome.error ?? "error"}`}`]);
            void logToolRun({
              skill: skill.name,
              tool: name,
              label,
              ok: outcome.ok,
              detail: outcome.ok ? undefined : (outcome.error ?? "error"),
            });
          },
          onApproval: (req) =>
            new Promise<"apply" | "discard">((resolve) => {
              setApproval({
                label: req.label,
                tool: req.tool.name,
                hint: req.tool.approvalHint ?? "applies to the live canvas",
                undoable: req.tool.undoable === true,
                resolve: (d) => {
                  setApproval(null);
                  setTrace((prev) => [...prev, `${req.label} — ${d === "apply" ? "applied" : "discarded"}`]);
                  void logToolRun({
                    skill: skill.name,
                    tool: req.tool.name,
                    label: req.label,
                    ok: d === "apply",
                    detail: d === "apply" ? "approved" : "discarded by the user",
                  });
                  resolve(d);
                },
              });
            }),
        },
      });
      finishTurn(r.text, undefined, r.stopped && r.text.trim() === "" ? r.stopped : undefined);
    }
    setBusy(false);
    abortRef.current = null;
  }, [draft, busy, providerId, modelId, turns, baseURL, preset.editableBaseURL, skill]);

  // Flush completed chats to per-org history once the turn settles.
  useEffect(() => {
    if (!busy && turns.length > 0) void persist();
  }, [busy, turns, persist]);

  // Setup tab deep-links here ("gravenx:model-studio") - same pattern as the palette event.
  useEffect(() => {
    const open = () => {
      setOpen(true);
      setStudioOpen(true);
    };
    window.addEventListener("gravenx:model-studio", open);
    return () => window.removeEventListener("gravenx:model-studio", open);
  }, []);

  const stop = () => abortRef.current?.abort();

  const beginAiDrag = (e: React.PointerEvent) => {
    const el = aiPillRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    aiDragRef.current = { sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top, moved: false };
  };
  const moveAiDrag = (e: React.PointerEvent) => {
    const d = aiDragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    d.moved = true;
    const w = typeof window === "undefined" ? 1200 : window.innerWidth;
    const h = typeof window === "undefined" ? 800 : window.innerHeight;
    setDockPos({
      x: Math.min(Math.max(8, d.ox + dx), Math.max(8, w - 140)),
      y: Math.min(Math.max(8, d.oy + dy), Math.max(8, h - 48)),
    });
  };
  const endAiDrag = () => {
    const d = aiDragRef.current;
    aiDragRef.current = null;
    if (d?.moved) {
      aiSuppressClickRef.current = true;
      try {
        const el = aiPillRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          localStorage.setItem("gravenx-ai-pos", JSON.stringify({ x: Math.round(rect.left), y: Math.round(rect.top) }));
        }
      } catch {
        /* ignore */
      }
    }
  };

  const tools = toolsForSkill(skill.name);

  return (
    <>
      <button
        ref={aiPillRef}
        type="button"
        onPointerDown={beginAiDrag}
        onPointerMove={moveAiDrag}
        onPointerUp={endAiDrag}
        onPointerCancel={() => { aiDragRef.current = null; }}
        onDoubleClick={() => {
          setDockPos(null);
          try { localStorage.removeItem("gravenx-ai-pos"); } catch { /* ignore */ }
        }}
        onClick={() => {
          if (aiSuppressClickRef.current) {
            aiSuppressClickRef.current = false;
            return;
          }
          setOpen((v) => !v);
        }}
        title="Ask the GRAVENX agent - drag to move, double-click to re-dock"
        aria-label="Toggle AI agent panel"
        style={dockPos ? { left: dockPos.x, top: dockPos.y, bottom: "auto", right: "auto" } : undefined}
        className={`fixed z-50 flex h-11 items-center gap-2 rounded-full border border-[var(--color-line)] bg-ivory-950 px-4 text-[13px] font-semibold text-ivory-100 shadow-xl transition-colors hover:bg-bronze-600 cursor-grab active:cursor-grabbing ${dockPos ? "" : "bottom-5 right-5"}`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
          <circle cx="12" cy="12" r="3.2" />
        </svg>
        Ask AI
      </button>

      {open && (
        <aside
          role="dialog"
          aria-label="GRAVENX AI agent"
          className="fixed right-4 top-[64px] bottom-4 z-50 flex w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_24px_64px_-24px_rgba(24,20,12,0.5)]"
        >
          <div className="flex items-start justify-between gap-2 border-b border-[var(--color-line-soft)] px-4 py-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
                GravenX - AI Agent
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-ivory-600">
                Disclaimer: key stays in this tab - forwarded per request, never stored or logged.
              </p>
            </div>
            <span className="flex shrink-0 items-center">
              {sfOk && (
                <button
                  type="button"
                  onClick={() => {
                    if (!historyOpen) void refreshSessions();
                    setHistoryOpen(!historyOpen);
                  }}
                  title="Chat history for this org"
                  aria-label="Open chat history"
                  aria-expanded={historyOpen}
                  className={`rounded-md p-1.5 transition-colors cursor-pointer ${historyOpen ? "bg-ivory-300 text-ivory-950" : "text-ivory-500 hover:bg-ivory-300 hover:text-ivory-950"}`}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                    <path d="M3 12a9 9 0 1 0 3-6.7" />
                    <path d="M3 4v5h5" />
                    <path d="M12 7v5l3.5 2" />
                  </svg>
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close AI panel"
                className="rounded-md p-1.5 text-ivory-500 transition-colors cursor-pointer hover:bg-ivory-300 hover:text-ivory-950"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </span>
          </div>
          {historyOpen && sfOk && (
            <div className="absolute right-3 top-14 z-10 w-[min(320px,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_16px_48px_-16px_rgba(24,20,12,0.45)]" role="dialog" aria-label="Chat history">
              <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line-soft)] px-3 py-2">
                <p className="text-[11px] font-semibold text-ivory-950">History · this org</p>
                <button
                  type="button"
                  onClick={newChat}
                  className="rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[11px] font-semibold text-ivory-800 transition-colors cursor-pointer hover:border-[#C9A86A] hover:text-ivory-950"
                >
                  + New chat
                </button>
              </div>
              <ul className="max-h-64 overflow-y-auto py-1">
                {sessions.length === 0 && (
                  <li className="px-3 py-4 text-center text-[11px] text-ivory-500">
                    No saved chats yet - they appear here after your first reply.
                  </li>
                )}
                {sessions.map((s) => (
                  <li key={s.id} className="group flex items-center gap-1 px-1.5">
                    <button
                      type="button"
                      onClick={() => void restoreSession(s.id)}
                      title={`Restore "${s.title}"`}
                      className={`min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left transition-colors cursor-pointer hover:bg-[#F5F1E8] ${s.id === sessionId ? "bg-[#F5F1E8]" : ""}`}
                    >
                      <span className="block truncate text-xs font-semibold text-ivory-950">{s.title}</span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-ivory-500">
                        {relativeTime(s.updatedAt)} · {s.modelId || s.providerId}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteAiSession(s.id);
                        if (s.id === sessionId) newChat();
                        else void refreshSessions();
                      }}
                      title={`Delete "${s.title}"`}
                      aria-label={`Delete ${s.title}`}
                      className="rounded p-1 text-ivory-400 opacity-0 transition-colors cursor-pointer hover:bg-red-500/10 hover:text-red-700 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-b border-[var(--color-line-soft)] px-4 py-2.5">
            {!sfOk ? (
              <div className="flex items-center gap-2 rounded-xl border border-[#E5C98F] bg-[#F5EEDF] px-3 py-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" className="shrink-0 text-[#8A6A2F]">
                  <rect x="4" y="10" width="16" height="10" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
                <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-[#8A6A2F]">
                  Connect to Salesforce to get started with AI.
                </p>
                <Link href="/" className="shrink-0 rounded-lg bg-ivory-950 px-2.5 py-1.5 text-[11px] font-semibold text-ivory-100 hover:bg-bronze-600 transition-colors">
                  Connect
                </Link>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${modelId ? "bg-[#32815B]" : "bg-ivory-400"}`} title={modelId ? "Provider active" : "No model activated"} />
                <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-ivory-700">
                  {preset.label}{modelId ? ` · ${modelId}` : " · no model"}
                </p>
                <button
                  type="button"
                  onClick={() => setStudioOpen(true)}
                  title="Open Model Studio - keys, adapters, models"
                  aria-label="Open Model Studio"
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 text-[11px] font-semibold text-ivory-800 transition-colors cursor-pointer hover:border-[#C9A86A] hover:text-ivory-950"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M4 8h10M18 8h2M4 16h2M10 16h10" />
                    <circle cx="16" cy="8" r="2.2" />
                    <circle cx="8" cy="16" r="2.2" />
                  </svg>
                  Model Studio
                </button>
              </div>
            )}
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3">
            {turns.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--color-line)] px-3 py-4 text-center">
                <p className="text-xs font-semibold text-ivory-950">Brainstorm with the {skill.label} agent</p>
                <p className="mx-auto mt-1 max-w-[260px] text-[11px] leading-relaxed text-ivory-600">
                  {tools.length > 0
                    ? "It reads the live canvas and proposes changes - every mutation waits for your Apply."
                    : "It explains and drafts, you act. Activate a model in Model Studio to begin."}
                </p>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={t.role === "user" ? "ml-8 rounded-xl bg-ivory-950 px-3 py-2 text-xs leading-relaxed text-ivory-100" : "mr-4 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-3 py-2 text-xs leading-relaxed text-ivory-950"}>
                {t.role === "assistant" && !(busy && i === turns.length - 1) && t.content ? (
                  <AiMarkdown content={t.content} />
                ) : (
                  <p className="whitespace-pre-wrap">{t.content}{busy && i === turns.length - 1 && t.role === "assistant" ? "▍" : ""}</p>
                )}
                {t.error && (
                  <p className="mt-1.5 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700" role="alert">
                    {t.error}
                  </p>
                )}
                {t.usage?.totalTokens !== undefined && (
                  <p className="mt-1 font-mono text-[10px] text-ivory-500">
                    {t.usage.promptTokens ?? "?"} in · {t.usage.completionTokens ?? "?"} out · {t.usage.totalTokens} total
                  </p>
                )}
              </div>
            ))}
            {sendError && (
              <p className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-2 text-xs text-red-700" role="alert">
                {sendError}
              </p>
            )}
            {trace.length > 0 && (
              <div className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-3 py-2">
                <p className="font-mono text-[10px] uppercase tracking-[1.5px] text-ivory-500">Agent activity</p>
                <ul className="mt-1 space-y-0.5">
                  {trace.map((line, i) => (
                    <li key={i} className="font-mono text-[10px] leading-relaxed text-ivory-600">· {line}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="border-t border-[var(--color-line-soft)] px-4 py-3">
            {approval && (
              <div className="mb-2 rounded-xl border border-[#C9A86A] bg-[#FBF6EC] px-3 py-2.5" role="alertdialog" aria-label="Approve agent change">
                <p className="text-[10px] font-semibold uppercase tracking-[1.5px] text-[#8A6A2F]">Needs your approval</p>
                <p className="mt-0.5 text-xs font-semibold text-ivory-950">{approval.label}</p>
                <p className="mt-0.5 font-mono text-[10px] text-ivory-600">{approval.tool} · {approval.hint}{approval.undoable ? ", undoable" : ""}</p>
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" onClick={() => approval.resolve("apply")}>
                    Apply
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => approval.resolve("discard")}>
                    Discard
                  </Button>
                </div>
              </div>
            )}
            {(lastUsage?.totalTokens !== undefined || totals.in > 0 || totals.out > 0) && (
              <p className="mb-1.5 font-mono text-[10px] text-ivory-500">
                {lastUsage?.totalTokens !== undefined
                  ? `last reply: ${lastUsage.promptTokens ?? "?"} in · ${lastUsage.completionTokens ?? "?"} out · `
                  : ""}
                session: {totals.in} in · {totals.out} out
              </p>
            )}
            <div className="flex gap-1.5">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={sfOk ? `Ask about ${skill.label}…` : "Connect to Salesforce to start…"}
                aria-label="Ask the agent"
                disabled={busy || !sfOk}
                className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-2 text-xs text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none disabled:opacity-60"
              />
              {busy ? (
                <Button size="sm" variant="danger" onClick={stop}>
                  Stop
                </Button>
              ) : (
                <Button size="sm" onClick={() => void send()} disabled={draft.trim() === "" || !sfOk}>
                  Send
                </Button>
              )}
            </div>
          </div>
        </aside>
      )}
      <ModelStudio
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        activeProviderId={providerId}
        activeModelId={modelId}
        onActivate={(pid, mid) => {
          setProviderId(pid);
          setModelId(mid);
        }}
      />
    </>
  );
}
