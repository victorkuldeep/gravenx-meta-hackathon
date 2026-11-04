"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { NewCollectionItem, CollectionMethod } from "@/lib/collection/types";
import { originOf, downloadTextFile } from "@/lib/collection/postman";
import { isSessionExpiredMessage } from "@/lib/salesforce/client";
import { apiFetch, ApiTimeoutError } from "@/lib/api";
import { parseCurl } from "@/lib/rest/curl";
import {
  listRestHistory,
  saveRestHistory,
  deleteRestHistory,
  clearRestHistory,
  type RestHistoryEntry,
} from "@/lib/rest/historyDb";
import { newItemId } from "@/lib/collection/types";
import Badge from "./ui/Badge";
import Button from "./ui/Button";
import CodeBlock from "./ui/CodeBlock";
import { CollectionTrayButton } from "./CollectionTrayButton";

interface RestExplorerPanelProps {
  instanceUrl: string;
  apiVersion: string;
  getToken: () => string;
  onAddToCollection: (item: NewCollectionItem) => void;
  collectionCount: number;
  onOpenCollection: () => void;
  onSessionExpired?: () => void;
}

type RestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Scope = "org" | "custom";
type AuthType = "none" | "bearer" | "basic";

const METHODS: RestMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const MAX_TABS = 10;

interface HeaderRow {
  id: string;
  key: string;
  value: string;
}

interface RestResult {
  status: number;
  statusText: string;
  responseTime: number;
  body: unknown;
  truncated: boolean;
  success: boolean;
}

interface RestTab {
  id: string;
  name: string;
  scope: Scope;
  method: RestMethod;
  path: string;
  customUrl: string;
  authType: AuthType;
  authToken: string;
  authUser: string;
  authPass: string;
  headers: HeaderRow[];
  bodyText: string;
  result: RestResult | null;
  runError: string | null;
}

let tabSeq = 0;
let headerSeq = 0;
const nextTabId = () => `rest-${Date.now()}-${++tabSeq}`;
const nextHeaderId = () => `hdr-${Date.now()}-${++headerSeq}`;

const METHOD_STYLES: Record<RestMethod, string> = {
  GET: "bg-blue-100 text-blue-800 border-blue-300",
  POST: "bg-green-100 text-green-800 border-green-300",
  PUT: "bg-amber-100 text-amber-800 border-amber-300",
  PATCH: "bg-amber-100 text-amber-800 border-amber-300",
  DELETE: "bg-red-100 text-red-700 border-red-300",
};

function autoTabName(method: RestMethod, target: string): string {
  const segs = target.split("?")[0].split("/").filter(Boolean).slice(-2).join("/") || "root";
  return `${method} ${segs}`.slice(0, 48);
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function RestExplorerPanel({
  instanceUrl,
  apiVersion,
  getToken,
  onAddToCollection,
  collectionCount,
  onOpenCollection,
  onSessionExpired,
}: RestExplorerPanelProps) {
  const ver = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
  const origin = originOf(instanceUrl);

  const makeTab = useCallback(
    (partial?: Partial<RestTab>): RestTab => ({
      id: nextTabId(),
      name: `GET sobjects/`,
      scope: "org",
      method: "GET",
      path: `/services/data/${ver}/`,
      customUrl: "",
      authType: "none",
      authToken: "",
      authUser: "",
      authPass: "",
      headers: [{ id: nextHeaderId(), key: "", value: "" }],
      bodyText: "{\n  \n}",
      result: null,
      runError: null,
      ...partial,
    }),
    [ver]
  );

  const [tabs, setTabs] = useState<RestTab[]>(() => [
    {
      id: nextTabId(),
      name: `GET sobjects/`,
      scope: "org",
      method: "GET",
      path: `/services/data/${ver}/`,
      customUrl: "",
      authType: "none",
      authToken: "",
      authUser: "",
      authPass: "",
      headers: [{ id: nextHeaderId(), key: "", value: "" }],
      bodyText: "{\n  \n}",
      result: null,
      runError: null,
    },
  ]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [runningTabId, setRunningTabId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<RestHistoryEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);

  const active = tabs.find((t) => t.id === (activeId ?? tabs[0]?.id)) ?? tabs[0];

  useEffect(() => {
    listRestHistory()
      .then(setHistory)
      .catch(() => setHistory([]));
  }, []);

  const patchTab = useCallback((id: string, patch: Partial<RestTab>) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const renameTab = useCallback(
    (tab: RestTab) => {
      const target = tab.scope === "org" ? tab.path.trim() : tab.customUrl.trim();
      if (target && !tab.result) {
        patchTab(tab.id, { name: autoTabName(tab.method, target) });
      }
    },
    [patchTab]
  );

  const addTab = useCallback(
    (partial?: Partial<RestTab>, focus = true) => {
      if (tabs.length >= MAX_TABS) {
        setNotice(`At most ${MAX_TABS} tabs - close one first.`);
        return;
      }
      const t = makeTab(partial);
      setTabs((prev) => [...prev, t]);
      if (focus) setActiveId(t.id);
      setNotice(null);
    },
    [tabs.length, makeTab]
  );

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((t) => t.id !== id);
        if (activeId === id || !next.some((t) => t.id === activeId)) {
          setActiveId(next[next.length - 1].id);
        }
        return next;
      });
    },
    [activeId]
  );

  const switchScope = useCallback(
    (tab: RestTab, next: Scope) => {
      if (next === "custom" && !tab.customUrl) {
        patchTab(tab.id, { scope: next, customUrl: `${origin}${tab.path.trim() || "/"}` });
      } else if (next === "org") {
        try {
          const u = new URL(tab.customUrl.trim());
          if (u.origin.toLowerCase() === origin.toLowerCase()) {
            patchTab(tab.id, { scope: next, path: u.pathname + u.search });
            return;
          }
        } catch {
          /* keep current path */
        }
        patchTab(tab.id, { scope: next });
      } else {
        patchTab(tab.id, { scope: next });
      }
    },
    [origin, patchTab]
  );

  const quickPaths = [
    { label: "API root", path: `/services/data/${ver}/` },
    { label: "Objects", path: `/services/data/${ver}/sobjects/` },
    { label: "Sample query", path: `/services/data/${ver}/query?q=SELECT Id,Name FROM Account LIMIT 5` },
    { label: "Composite", path: `/services/data/${ver}/composite` },
    { label: "Tooling objects", path: `/services/data/${ver}/tooling/sobjects/` },
  ];

  const updateHeader = useCallback((tabId: string, id: string, patch: Partial<HeaderRow>) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id !== tabId ? t : { ...t, headers: t.headers.map((h) => (h.id === id ? { ...h, ...patch } : h)) }
      )
    );
  }, []);

  const removeHeader = useCallback((tabId: string, id: string) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        if (t.headers.length <= 1) {
          return { ...t, headers: t.headers.map((h) => (h.id === id ? { ...h, key: "", value: "" } : h)) };
        }
        return { ...t, headers: t.headers.filter((h) => h.id !== id) };
      })
    );
  }, []);

  const send = useCallback(
    async (tab: RestTab) => {
      const token = getToken();
      if (!token) {
        patchTab(tab.id, { runError: "Session token is no longer available. Please reconnect." });
        return;
      }
      const target = tab.scope === "org" ? tab.path.trim() : tab.customUrl.trim();
      if (tab.scope === "org" && !target.startsWith("/services/")) {
        patchTab(tab.id, { runError: "Path must start with /services/ (locked to this org)." });
        return;
      }
      if (tab.scope === "custom" && !target) {
        patchTab(tab.id, { runError: "Enter a full https:// URL first." });
        return;
      }
      stoppedRef.current = false;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setRunningTabId(tab.id);
      patchTab(tab.id, { runError: null, result: null });
      try {
        const response = await apiFetch(
          "/api/salesforce/rest",
          tab.scope === "org"
            ? {
                instanceUrl,
                token,
                scope: tab.scope,
                method: tab.method,
                path: target,
                headers: tab.headers
                  .filter((h) => h.key.trim() !== "")
                  .map((h) => ({ key: h.key.trim(), value: h.value })),
                body: tab.method === "GET" ? "" : tab.bodyText,
              }
            : {
                instanceUrl,
                token,
                scope: tab.scope,
                method: tab.method,
                url: target,
                headers: tab.headers
                  .filter((h) => h.key.trim() !== "")
                  .map((h) => ({ key: h.key.trim(), value: h.value })),
                body: tab.method === "GET" ? "" : tab.bodyText,
                auth:
                  tab.authType === "bearer"
                    ? { type: "bearer", token: tab.authToken }
                    : tab.authType === "basic"
                      ? { type: "basic", user: tab.authUser, pass: tab.authPass }
                      : { type: "none" },
              },
          120000,
          ctrl.signal
        );
        const data = (await response.json()) as RestResult & { error?: string };
        if (!response.ok || data.error) {
          const message = typeof data.error === "string" ? data.error : "Request failed";
          patchTab(tab.id, { runError: message });
          if (isSessionExpiredMessage(message)) onSessionExpired?.();
          return;
        }
        if (data.status === 401) onSessionExpired?.();
        patchTab(tab.id, { result: data, name: autoTabName(tab.method, target) });
        // Auto-history (request + outcome, no bodies)
        const entry: RestHistoryEntry = {
          id: newItemId(),
          name: autoTabName(tab.method, target),
          method: tab.method,
          scope: tab.scope,
          url: tab.scope === "org" ? `${origin}${target}` : target,
          status: data.status,
          timeMs: data.responseTime,
          createdAt: Date.now(),
          snapshot: {
            method: tab.method,
            path: tab.scope === "org" ? target : "",
            customUrl: tab.scope === "custom" ? target : "",
            authType: tab.authType,
            headers: tab.headers
              .filter((h) => h.key.trim() !== "")
              .map((h) => ({ key: h.key.trim(), value: h.value })),
            body: tab.method === "GET" ? "" : tab.bodyText,
          },
        };
        void saveRestHistory(entry)
          .then(() => listRestHistory().then(setHistory).catch(() => {}))
          .catch(() => {});
      } catch (err) {
        if (stoppedRef.current) {
          patchTab(tab.id, { runError: "Stopped - partial response (if any) was discarded." });
        } else if (err instanceof ApiTimeoutError) {
          patchTab(tab.id, { runError: err.message });
        } else {
          const message = err instanceof Error ? err.message : "Network error";
          patchTab(tab.id, { runError: message });
          if (isSessionExpiredMessage(message)) onSessionExpired?.();
        }
      } finally {
        setRunningTabId((cur) => (cur === tab.id ? null : cur));
        if (abortRef.current === ctrl) abortRef.current = null;
      }
    },
    [instanceUrl, origin, getToken, onSessionExpired, patchTab]
  );

  const openFromHistory = useCallback(
    (entry: RestHistoryEntry) => {
      if (tabs.length >= MAX_TABS) {
        setNotice(`At most ${MAX_TABS} tabs - close one first.`);
        return;
      }
      const s = entry.snapshot;
      const t = makeTab({
        name: entry.name,
        scope: entry.scope,
        method: entry.method as RestTab["method"],
        path: s.path || `/services/data/${ver}/`,
        customUrl: s.customUrl,
        authType: (["none", "bearer", "basic"] as const).includes(s.authType as AuthType)
          ? (s.authType as AuthType)
          : "none",
        headers:
          s.headers.length > 0
            ? s.headers.map((h) => ({ id: nextHeaderId(), key: h.key, value: h.value }))
            : [{ id: nextHeaderId(), key: "", value: "" }],
        bodyText: s.body || "{\n  \n}",
      });
      setTabs((prev) => [...prev, t]);
      setActiveId(t.id);
      setShowHistory(false);
    },
    [tabs.length, makeTab, ver]
  );

  const deleteHistory = useCallback((id: string) => {
    void deleteRestHistory(id)
      .then(() => listRestHistory().then(setHistory).catch(() => {}))
      .catch(() => {});
  }, []);

  const clearHistory = useCallback(() => {
    void clearRestHistory()
      .then(() => setHistory([]))
      .catch(() => {});
  }, []);

  const applyParsedCurl = useCallback(() => {
    if (!active) return;
    try {
      const parsed = parseCurl(pasteText);
      const patch: Partial<RestTab> = {
        method: parsed.method as RestMethod,
        headers:
          parsed.headers.length > 0
            ? parsed.headers.map((h) => ({ id: nextHeaderId(), key: h.key, value: h.value }))
            : [{ id: nextHeaderId(), key: "", value: "" }],
        bodyText: parsed.body || active.bodyText,
        result: null,
        runError: null,
      };
      let orgNote: string | null = null;
      try {
        const u = new URL(parsed.url);
        if (active.scope === "custom" || u.origin.toLowerCase() !== origin.toLowerCase()) {
          if (active.scope === "custom") {
            patch.customUrl = parsed.url;
          } else {
            patch.path = u.pathname + u.search;
            orgNote = `That cURL points at ${u.host}, not this org - flip to Custom scope to call it, or check the path before sending.`;
          }
        } else {
          patch.path = u.pathname + u.search;
        }
      } catch {
        if (active.scope === "custom") patch.customUrl = parsed.url;
        else patch.path = parsed.url;
      }
      const pastedAuth = parsed.headers.find((h) => h.key.toLowerCase() === "authorization");
      if (active.scope === "custom" && pastedAuth) {
        const m = pastedAuth.value.match(/^Bearer\s+(.+)$/i);
        if (m) {
          patch.authType = "bearer";
          patch.authToken = m[1];
          patch.headers = (patch.headers ?? []).filter((h) => h.key.toLowerCase() !== "authorization");
        }
      }
      patch.name = autoTabName(
        parsed.method as RestMethod,
        active.scope === "custom" ? parsed.url : (patch.path as string) || parsed.url
      );
      patchTab(active.id, patch);
      const notes = [...(orgNote ? [orgNote] : []), ...parsed.warnings];
      setNotice(notes.length > 0 ? `Filled from cURL. Note: ${notes.join(" ")}` : "Filled from cURL - review and Send.");
      setShowPaste(false);
      setPasteText("");
      setPasteError(null);
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : "Couldn't parse that cURL.");
    }
  }, [pasteText, origin, active, patchTab]);


  if (!active) return null;

  return (
    <div className="arch-card overflow-hidden">
      <div className="arch-card__head px-4 py-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ivory-950">REST API Explorer</h2>
        <span className="flex-1" />
        <span className="hidden sm:inline text-[11px] text-ivory-600">
          {tabs.length} tab{tabs.length === 1 ? "" : "s"} · history auto-saves every send
        </span>
        <Badge variant="info">{active.scope === "org" ? "This org" : "Custom target"}</Badge>
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          aria-expanded={showHistory}
          title="Request history (auto-saved)"
          className={`relative rounded-lg border px-2.5 py-1.5 text-xs transition-colors cursor-pointer ${
            showHistory
              ? "bg-ivory-950 text-ivory-100 border-ivory-950"
              : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-700 hover:text-ivory-950 hover:border-[var(--color-accent)]"
          }`}
        >
          History
          {history.length > 0 && (
            <span className="ml-1.5 inline-flex min-w-[18px] h-[18px] px-1 items-center justify-center rounded-full bg-bronze-500 text-white text-[10px] font-bold">
              {history.length > 99 ? "99+" : history.length}
            </span>
          )}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-3 py-2" role="tablist" aria-label="Request tabs">
        {tabs.map((t) => (
          <div
            key={t.id}
            role="tab"
            aria-selected={t.id === active.id}
            onClick={() => setActiveId(t.id)}
            className={`group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
              t.id === active.id
                ? "bg-ivory-950 text-ivory-100 border-ivory-950"
                : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-700 hover:border-[var(--color-accent)]"
            }`}
          >
            <span className={`rounded px-1 font-mono text-[10px] font-bold ${METHOD_STYLES[t.method]}`}>
              {t.method}
            </span>
            <span className="max-w-[160px] truncate font-medium" title={t.name}>
              {t.name.replace(/^[A-Z]+ /, "")}
            </span>
            {runningTabId === t.id && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-bronze-400" aria-hidden="true" />}
            {t.result && runningTabId !== t.id && (
              <span className={`font-mono text-[10px] font-bold ${t.result.success ? "text-green-500" : "text-red-400"}`}>
                {t.result.status}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t.id);
              }}
              disabled={tabs.length <= 1}
              aria-label={`Close ${t.name}`}
              className={`rounded p-0.5 transition-colors cursor-pointer disabled:opacity-30 ${
                t.id === active.id ? "hover:bg-white/20" : "hover:bg-ivory-300"
              }`}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => addTab()}
          disabled={tabs.length >= MAX_TABS}
          aria-label="New request tab"
          title={`New tab (max ${MAX_TABS})`}
          className="shrink-0 rounded-lg border border-dashed border-[var(--color-line)] px-2.5 py-1.5 text-xs text-ivory-600 hover:border-[var(--color-accent)] hover:text-ivory-950 transition-colors cursor-pointer disabled:opacity-40"
        >
          + New
        </button>
      </div>

      {/* History */}
      {showHistory && (
        <div className="border-b border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-ivory-900">Auto-saved calls (click to reopen in a new tab)</p>
            {history.length > 0 && (
              <button
                type="button"
                onClick={clearHistory}
                className="text-[11px] text-ivory-600 hover:text-red-700 underline cursor-pointer"
              >
                Clear all
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="py-3 text-center text-xs text-ivory-600">Nothing yet - every Send lands here automatically.</p>
          ) : (
            <ul className="max-h-52 space-y-1.5 overflow-y-auto">
              {history.map((h) => (
                <li
                  key={h.id}
                  className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5"
                >
                  <button
                    type="button"
                    onClick={() => openFromHistory(h)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                    title="Reopen in a new tab"
                  >
                    <span className={`shrink-0 rounded px-1 font-mono text-[10px] font-bold ${METHOD_STYLES[h.method as RestMethod] ?? "bg-ivory-300 text-ivory-800 border border-[var(--color-line)]"}`}>
                      {h.method}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-ivory-950">{h.name}</span>
                    <span className={`shrink-0 font-mono text-[11px] font-bold ${h.status != null && h.status < 400 ? "text-green-700" : "text-red-600"}`}>
                      {h.status ?? "—"}
                    </span>
                    <span className="hidden sm:inline shrink-0 text-[10px] text-ivory-500">
                      {h.timeMs != null ? `${h.timeMs}ms · ` : ""}{timeAgo(h.createdAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteHistory(h.id)}
                    aria-label={`Delete ${h.name} from history`}
                    className="shrink-0 rounded p-1 text-ivory-500 hover:text-red-700 hover:bg-red-500/10 cursor-pointer"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="p-4 space-y-3" key={active.id}>
        {/* Scope */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-[var(--color-line)] overflow-hidden" role="tablist" aria-label="Explorer scope">
            {(["org", "custom"] as const).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={active.scope === s}
                onClick={() => switchScope(active, s)}
                title={
                  s === "org"
                    ? "Locked to the connected org, session auth automatic"
                    : "Any public https URL, bring your own auth (Postman style)"
                }
                className={`px-3 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                  active.scope === s ? "bg-ivory-950 text-ivory-100" : "bg-[var(--color-surface)] text-ivory-700 hover:text-ivory-950"
                }`}
              >
                {s === "org" ? "Org" : "Custom"}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-ivory-600">
            {active.scope === "org"
              ? "Path locked to this org under /services/."
              : "Any public https URL - your SF session token is never attached here."}
          </span>
        </div>

        {/* Method + URL */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="flex rounded-lg border border-[var(--color-line)] overflow-hidden shrink-0" role="tablist" aria-label="HTTP method">
            {METHODS.map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={active.method === m}
                onClick={() => {
                  patchTab(active.id, { method: m, result: null, runError: null });
                  renameTab({ ...active, method: m });
                }}
                className={`px-3 py-2 font-mono text-xs font-bold tracking-wide transition-colors cursor-pointer ${
                  active.method === m ? "bg-ivory-950 text-ivory-100" : "bg-[var(--color-surface)] text-ivory-700 hover:text-ivory-950"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {active.scope === "org" ? (
            <div className="flex flex-1 min-w-0 items-stretch rounded-lg border border-[var(--color-line)] overflow-hidden focus-within:border-bronze-500">
              <span className="hidden md:flex items-center px-3 font-mono text-[11px] text-ivory-500 bg-[var(--color-canvas)] border-r border-[var(--color-line)] truncate max-w-[280px]" title={origin}>
                {origin || "https://…"}
              </span>
              <input
                value={active.path}
                onChange={(e) => {
                  patchTab(active.id, { path: e.target.value, result: null });
                  renameTab({ ...active, path: e.target.value });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && runningTabId === null) void send(active);
                }}
                spellCheck={false}
                autoComplete="off"
                aria-label="Request path"
                placeholder={`/services/data/${ver}/sobjects/Account`}
                className="flex-1 min-w-0 bg-white px-3 py-2 font-mono text-xs text-ivory-950 placeholder-ivory-500 focus:outline-none"
              />
            </div>
          ) : (
            <div className="flex flex-1 min-w-0 items-stretch rounded-lg border border-[var(--color-line)] overflow-hidden focus-within:border-bronze-500">
              <input
                value={active.customUrl}
                onChange={(e) => patchTab(active.id, { customUrl: e.target.value, result: null })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && runningTabId === null) void send(active);
                }}
                spellCheck={false}
                autoComplete="off"
                aria-label="Full request URL"
                placeholder="https://api.example.com/v1/resource?key=val"
                className="flex-1 min-w-0 bg-white px-3 py-2 font-mono text-xs text-ivory-950 placeholder-ivory-500 focus:outline-none"
              />
            </div>
          )}
          {runningTabId === active.id ? (
            <Button variant="danger" onClick={() => { stoppedRef.current = true; abortRef.current?.abort(); }} className="shrink-0">
              Stop
            </Button>
          ) : (
            <Button onClick={() => void send(active)} disabled={runningTabId !== null} className="shrink-0">
              Send
            </Button>
          )}
        </div>

        {/* Custom-scope auth */}
        {active.scope === "custom" && (
          <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-ivory-900">Auth</span>
              <div className="flex rounded-lg border border-[var(--color-line)] overflow-hidden" role="tablist" aria-label="Custom auth type">
                {(["none", "bearer", "basic"] as const).map((a) => (
                  <button
                    key={a}
                    role="tab"
                    aria-selected={active.authType === a}
                    onClick={() => patchTab(active.id, { authType: a })}
                    className={`px-3 py-1 text-[11px] font-medium capitalize transition-colors cursor-pointer ${
                      active.authType === a ? "bg-ivory-950 text-ivory-100" : "bg-[var(--color-surface)] text-ivory-700 hover:text-ivory-950"
                    }`}
                  >
                    {a === "none" ? "None" : a === "bearer" ? "Bearer" : "Basic"}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-ivory-600">
                {active.authType === "none"
                  ? "No auth attached - or type an Authorization header below for full persona control."
                  : active.authType === "bearer"
                    ? "Token goes only to the URL above - never mixed with your SF session."
                    : "Username + password encoded locally, sent as Basic."}
              </span>
            </div>
            {active.authType === "bearer" && (
              <input
                type="password"
                value={active.authToken}
                onChange={(e) => patchTab(active.id, { authToken: e.target.value })}
                placeholder="Bearer token (e.g. another org's session, API key)"
                aria-label="Bearer token"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded border border-ivory-400 bg-white px-2.5 py-1.5 font-mono text-xs text-ivory-950 placeholder-ivory-500 focus:border-bronze-500 focus:outline-none"
              />
            )}
            {active.authType === "basic" && (
              <div className="flex gap-1.5">
                <input
                  value={active.authUser}
                  onChange={(e) => patchTab(active.id, { authUser: e.target.value })}
                  placeholder="Username"
                  aria-label="Basic auth username"
                  autoComplete="off"
                  className="flex-1 min-w-0 rounded border border-ivory-400 bg-white px-2.5 py-1.5 font-mono text-xs text-ivory-950 placeholder-ivory-500 focus:border-bronze-500 focus:outline-none"
                />
                <input
                  type="password"
                  value={active.authPass}
                  onChange={(e) => patchTab(active.id, { authPass: e.target.value })}
                  placeholder="Password"
                  aria-label="Basic auth password"
                  autoComplete="off"
                  className="flex-1 min-w-0 rounded border border-ivory-400 bg-white px-2.5 py-1.5 font-mono text-xs text-ivory-950 placeholder-ivory-500 focus:border-bronze-500 focus:outline-none"
                />
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setPasteText("");
              setPasteError(null);
              setShowPaste(true);
            }}
            title="Paste a cURL command to auto-fill method, URL, headers and body"
          >
            ⎘ Paste cURL
          </Button>
          {active.scope === "org" && (
            <>
              <span className="text-[11px] text-ivory-600">Try:</span>
              {quickPaths.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => {
                    patchTab(active.id, { path: q.path, result: null, runError: null });
                    renameTab({ ...active, path: q.path });
                  }}
                  className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 font-mono text-[11px] text-bronze-600 hover:border-bronze-500 hover:bg-[var(--color-accent-bg)] transition-colors cursor-pointer"
                >
                  {q.label}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Headers */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-semibold text-ivory-900">
              Headers{" "}
              <span className="font-normal text-ivory-500">
                ({active.scope === "org" ? "Authorization is automatic" : "Authorization is yours to set"})
              </span>
            </p>
            <button
              type="button"
              onClick={() => patchTab(active.id, { headers: [...active.headers, { id: nextHeaderId(), key: "", value: "" }] })}
              className="text-[11px] font-medium text-bronze-600 hover:text-bronze-700 cursor-pointer"
            >
              + Add header
            </button>
          </div>
          <div className="space-y-1.5">
            {active.headers.map((h) => (
              <div key={h.id} className="flex gap-1.5">
                <input
                  value={h.key}
                  onChange={(e) => updateHeader(active.id, h.id, { key: e.target.value })}
                  placeholder="Header name"
                  aria-label="Header name"
                  spellCheck={false}
                  className="w-40 shrink-0 rounded border border-ivory-400 bg-white px-2.5 py-1.5 font-mono text-xs text-ivory-950 placeholder-ivory-500 focus:border-bronze-500 focus:outline-none"
                />
                <input
                  value={h.value}
                  onChange={(e) => updateHeader(active.id, h.id, { value: e.target.value })}
                  placeholder="Value"
                  aria-label="Header value"
                  spellCheck={false}
                  className="flex-1 min-w-0 rounded border border-ivory-400 bg-white px-2.5 py-1.5 font-mono text-xs text-ivory-950 placeholder-ivory-500 focus:border-bronze-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeHeader(active.id, h.id)}
                  aria-label="Remove header"
                  className="shrink-0 rounded px-2 text-xs text-ivory-500 hover:text-red-700 hover:bg-red-500/10 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        {active.method !== "GET" && (
          <div>
            <label className="block text-xs font-medium text-ivory-700 mb-1" htmlFor={`rest-body-${active.id}`}>
              Request body (JSON)
            </label>
            <textarea
              id={`rest-body-${active.id}`}
              rows={6}
              value={active.bodyText}
              onChange={(e) => patchTab(active.id, { bodyText: e.target.value })}
              spellCheck={false}
              aria-label="Request body"
              className="w-full rounded border border-ivory-400 bg-white px-3 py-2 font-mono text-xs text-ivory-950 placeholder-ivory-500 focus:border-bronze-500 focus:outline-none focus:ring-1 focus:ring-bronze-500 resize-y"
            />
          </div>
        )}

        {active.runError && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 whitespace-pre-wrap" role="alert">
            {active.runError}
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-[var(--color-accent-soft)] bg-[var(--color-accent-bg)] px-3 py-2 text-xs text-ivory-800" role="status">
            {notice}
          </div>
        )}

        {active.result && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`rounded border px-1.5 py-0.5 font-mono text-xs font-bold ${METHOD_STYLES[active.method]}`}>
                {active.method}
              </span>
              <span className={`text-sm font-bold ${active.result.success ? "text-green-700" : "text-red-600"}`}>
                {active.result.status} {active.result.statusText}
              </span>
              <span className="text-xs text-ivory-600">{active.result.responseTime}ms</span>
              {active.result.truncated && (
                <span className="text-[11px] font-medium text-amber-700">Truncated at size cap</span>
              )}
              <span className="flex-1" />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const text =
                    typeof active.result!.body === "string"
                      ? (active.result!.body as string)
                      : JSON.stringify(active.result!.body, null, 2);
                  let parsed: unknown = text;
                  try {
                    parsed = JSON.parse(text);
                  } catch {
                    /* keep raw text */
                  }
                  const url = active.scope === "org" ? `${origin}${active.path.trim()}` : active.customUrl.trim();
                  onAddToCollection({
                    name: `${active.method} ${url.split("?")[0].split("/").filter(Boolean).slice(-2).join("/") || "root"}`,
                    method: active.method as CollectionMethod,
                    kind: "rest",
                    url,
                    origin: originOf(url) || origin,
                    body: parsed,
                  });
                }}
                title="Stage this request in a collection"
              >
                + Collection
              </Button>
              <CollectionTrayButton count={collectionCount} onOpen={onOpenCollection} />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const text =
                    typeof active.result!.body === "string"
                      ? (active.result!.body as string)
                      : JSON.stringify(active.result!.body, null, 2);
                  downloadTextFile(
                    `rest-response-${active.result!.status}-${Date.now()}.json`,
                    text,
                    "application/json"
                  );
                }}
              >
                Download
              </Button>
            </div>
            <CodeBlock
              code={
                typeof active.result.body === "string"
                  ? active.result.body
                  : JSON.stringify(active.result.body, null, 2)
              }
              language="json"
              maxHeight="420px"
            />
          </div>
        )}
      </div>

      {/* Paste-cURL importer */}
      {showPaste && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="paste-title"
          onClick={() => setShowPaste(false)}
        >
          <div className="modal-card max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)]">
              <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
                Shared commands
              </p>
              <h2 id="paste-title" className="mt-1 text-lg font-bold text-ivory-950">
                Paste cURL, get a request
              </h2>
              <p className="mt-1 text-xs text-ivory-600">
                Method, URL, headers and body are extracted. Supports -X, -H, -d variants,
                --user, --data-urlencode and line continuations. Fills the active tab.
              </p>
            </div>
            <div className="px-6 py-4 space-y-3">
              <textarea
                value={pasteText}
                onChange={(e) => {
                  setPasteText(e.target.value);
                  setPasteError(null);
                }}
                rows={7}
                spellCheck={false}
                autoFocus
                aria-label="cURL command"
                placeholder={`curl --location 'https://yourorg.my.salesforce.com/services/data/v66.0/sobjects/Account' --header 'Content-Type: application/json'`}
                className="w-full rounded-lg border border-[var(--color-line)] bg-white px-3 py-2.5 font-mono text-xs text-ivory-950 placeholder-ivory-500 focus:border-bronze-500 focus:outline-none focus:ring-1 focus:ring-bronze-500 resize-y"
              />
              {pasteError && (
                <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                  {pasteError}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-[var(--color-line-soft)] bg-[var(--color-canvas)] flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowPaste(false)}>
                Cancel
              </Button>
              <Button onClick={applyParsedCurl} disabled={!pasteText.trim()}>
                Parse &amp; Fill
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
