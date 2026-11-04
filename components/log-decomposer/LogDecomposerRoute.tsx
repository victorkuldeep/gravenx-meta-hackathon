"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Download, Link2, Trash2 } from "lucide-react";
import { getCachedConnection } from "@/lib/session/cache";
import { registerDebugBridge } from "@/lib/log-decomposer/debugBridge";
import {
  deleteDebugSession,
  listDebugSessions,
  loadDebugSession,
  saveDebugSession,
} from "@/lib/log-decomposer/sessionDb";
import { logTimestamp, newDebugSession, sessionFindings, type CapturedLog, type DebugSession } from "@/lib/log-decomposer/model";
import { deleteApexLog } from "@/lib/log-decomposer/capture";
import Button from "../ui/Button";
import { ConnectModal } from "../ConnectModal";
import { InventoryAside } from "../ui/InventoryAside";
import { apiFetch } from "@/lib/api";
import { setCachedConnection } from "@/lib/session/cache";
import { CapturePanel } from "./CapturePanel";
import { DiagnosePanel } from "./DiagnosePanel";
import { ExplorePanel } from "./ExplorePanel";
import { InvestigatePanel } from "./InvestigatePanel";
import { LogDecomposerHero } from "./LogDecomposerHero";
import { RcaPanel } from "./RcaPanel";

const TABS = ["Capture", "Logs", "Explore", "Diagnose", "Investigate", "RCA"] as const;
type Tab = (typeof TABS)[number];
/** Rows per Logs page - a busy org lists hundreds; pages keep it calm. */
const LOGS_PER_PAGE = 20;

const STATUS_PILL: Record<string, string> = {
  open: "bg-ivory-200 text-ivory-700",
  capturing: "bg-emerald-700 text-white",
  parsed: "bg-sky-700 text-white",
  diagnosed: "bg-[#722F37] text-white",
  "handed-off": "bg-ivory-950 text-ivory-100",
};

export function LogDecomposerRoute() {
  const [orgKey, setOrgKey] = useState("");
  const [sessions, setSessions] = useState<DebugSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [tab, setTab] = useState<Tab>("Capture");
  const [busy, setBusy] = useState(false);
  const [activeLogId, setActiveLogId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [showConnect, setShowConnect] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [logPage, setLogPage] = useState(0);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [logActionError, setLogActionError] = useState<string | null>(null);
  const [descOpen, setDescOpen] = useState(false);

  const refresh = useCallback(async (org: string) => {
    setSessions(await listDebugSessions(org));
  }, []);

  const resolveOrgKey = useCallback(async (instanceUrl: string, token: string, apiVersion: string): Promise<string> => {
    try {
      const r = await apiFetch("/api/salesforce/soql", { instanceUrl, token, apiVersion, soql: "SELECT Id FROM Organization LIMIT 1" }, 15000);
      const d = (await r.json()) as { records?: { Id?: string }[] };
      const id = d?.records?.[0]?.Id;
      if (r.ok && typeof id === "string" && id.length >= 15) return `org:${id.slice(0, 15)}`;
    } catch {
      /* fall through to host key */
    }
    try {
      return `host:${new URL(instanceUrl).host.toLowerCase()}`;
    } catch {
      return `host:${instanceUrl}`;
    }
  }, []);

  // Module cache dies on reload but sessionStorage survives - restore from
  // it exactly like the header does, otherwise a refresh shows the connect
  // gate while the top bar still says connected.
  const restore = useCallback(async () => {
    const cached = getCachedConnection();
    if (cached) {
      const key = cached.orgKey || cached.instanceUrl;
      setOrgKey(key);
      await refresh(key);
      return;
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem("gravenx_session") ?? "null") as {
        instanceUrl?: string;
        token?: string;
        apiVersion?: string;
      } | null;
      if (saved?.token && saved?.instanceUrl) {
        const version = saved.apiVersion ?? "v66.0";
        const key = await resolveOrgKey(saved.instanceUrl, saved.token, version);
        setCachedConnection({ instanceUrl: saved.instanceUrl, token: saved.token, apiVersion: version, objects: [], objectCount: 0, orgKey: key });
        setOrgKey(key);
        await refresh(key);
      } else {
        setOrgKey("");
      }
    } catch {
      setOrgKey("");
    }
  }, [refresh, resolveOrgKey]);

  useEffect(() => {
    void restore();
    // Connected in another tab? Pick it up without a reload.
    window.addEventListener("storage", restore);
    return () => window.removeEventListener("storage", restore);
  }, [restore]);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const activeRef = useRef(active);
  activeRef.current = active;

  // Headless investigator tools read through this bridge, never React.
  useEffect(() => {
    registerDebugBridge({
      getSession: () => activeRef.current,
      getExecution: (executionId) => activeRef.current?.executions.find((e) => e.executionId === executionId) ?? null,
      apply: async (fn, label) => {
        const cur = activeRef.current;
        if (!cur) return { ok: false, error: "No debug session is open." };
        const next = fn(cur);
        const saved = await saveDebugSession(next);
        if (!saved.ok) return { ok: false, error: saved.error ?? `Apply failed (${label}).` };
        setSessions(await listDebugSessions(next.orgKey));
        return { ok: true };
      },
    });
    return () => registerDebugBridge(null);
  }, []);

  const persist = useCallback(
    async (next: DebugSession) => {
      if ((await saveDebugSession(next)).ok) {
        setSessions(await listDebugSessions(next.orgKey));
      }
    },
    []
  );

  const handleConnect = useCallback(
    async (instanceUrl: string, token: string, apiVersion: string): Promise<boolean> => {
      setConnecting(true);
      setConnectError(null);
      try {
        const response = await apiFetch("/api/salesforce/connect", { instanceUrl, token, apiVersion });
        const data = (await response.json()) as { success?: boolean; error?: string };
        if (!response.ok || !data.success) {
          setConnectError(typeof data.error === "string" ? data.error : "Connection failed");
          return false;
        }
        try {
          sessionStorage.setItem("gravenx_session", JSON.stringify({ instanceUrl, token, apiVersion }));
        } catch {
          /* ignore */
        }
        const key = await resolveOrgKey(instanceUrl, token, apiVersion);
        setCachedConnection({ instanceUrl, token, apiVersion, objects: [], objectCount: 0, orgKey: key });
        setShowConnect(false);
        setOrgKey(key);
        await refresh(key);
        return true;
      } catch (err) {
        setConnectError(err instanceof Error ? err.message : "Connection failed");
        return false;
      } finally {
        setConnecting(false);
      }
    },
    [refresh, resolveOrgKey]
  );

  const create = useCallback(async () => {
    if (!orgKey) {
      setCreateError("No org connection - connect to Salesforce first.");
      return;
    }
    setCreateError(null);
    try {
      const s = newDebugSession(orgKey, titleDraft || `Debug session ${sessions.length + 1}`);
      const saved = await saveDebugSession(s);
      if (!saved.ok) {
        setCreateError(saved.error ?? "Couldn't save the session - retry once.");
        return;
      }
      setTitleDraft("");
      setSessions(await listDebugSessions(orgKey));
      setActiveId(s.id);
      setTab("Capture");
      setActiveLogId(null);
      setSelectedNodeId(null);
      setSelectedLine(null);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Couldn't save the session - retry once.");
    }
  }, [orgKey, titleDraft, sessions.length]);

  const openSession = useCallback(
    async (id: string) => {
      const s = await loadDebugSession(id);
      if (!s) return;
      setLogPage(0);
      setConfirmDeleteId(null);
      setLogActionError(null);
      setDescOpen(!s.problem);
      setActiveId(id);
      // Newest by org time, not array position - batches unshift oldest-first.
      const newest = [...s.logs].sort((a, b) => logTimestamp(b) - logTimestamp(a))[0];
      setActiveLogId(
        s.executions.find((e) => e.logId === newest?.salesforceLogId)?.executionId ??
          s.executions[s.executions.length - 1]?.executionId ??
          null
      );
      setSelectedNodeId(null);
      setSelectedLine(null);
      setTab(s.logs.length > 0 ? "Explore" : "Capture");
    },
    []
  );

  const execution = useMemo(() => {
    if (!active) return null;
    const byId = active.executions.find((e) => e.executionId === activeLogId);
    if (byId) return byId;
    const newest = [...active.logs].sort((a, b) => logTimestamp(b) - logTimestamp(a))[0];
    return (
      active.executions.find((e) => e.logId === newest?.salesforceLogId) ??
      active.executions[active.executions.length - 1] ??
      null
    );
  }, [active, activeLogId]);

  const findings = useMemo(() => (active ? sessionFindings(active) : []), [active]);

  /** Newest first; chains stay adjacent so one request reads as one story. */
  const sortedLogs = useMemo(() => {
    if (!active) return [] as CapturedLog[];
    const t = (l: CapturedLog) => (l.startTime ? Date.parse(l.startTime) || 0 : 0) || l.capturedAt;
    return [...active.logs].sort((a, b) => t(b) - t(a));
  }, [active]);

  const chainSizes = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of sortedLogs) {
      if (l.requestIdentifier) m.set(l.requestIdentifier, (m.get(l.requestIdentifier) ?? 0) + 1);
    }
    return m;
  }, [sortedLogs]);

  const logPageCount = Math.max(1, Math.ceil(sortedLogs.length / LOGS_PER_PAGE));
  const safeLogPage = Math.min(logPage, logPageCount - 1);
  const pageLogs = sortedLogs.slice(safeLogPage * LOGS_PER_PAGE, (safeLogPage + 1) * LOGS_PER_PAGE);

  /** Siblings of the open execution, oldest first - the whole request chain. */
  const chain = useMemo(() => {
    if (!active || !execution) return [] as { id: string; operation: string; status: string; current: boolean }[];
    const log = active.logs.find((l) => l.salesforceLogId === execution.logId);
    const key = log?.requestIdentifier;
    if (!key) return [];
    return active.logs
      .filter((l) => l.requestIdentifier === key)
      .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.capturedAt - b.capturedAt)
      .map((l) => ({
        id: l.salesforceLogId,
        operation: l.operation ?? l.salesforceLogId,
        status: l.status ?? "UNKNOWN",
        current: l.salesforceLogId === execution.logId,
      }));
  }, [active, execution]);

  const openLog = useCallback(
    (salesforceLogId: string, to: Tab = "Explore") => {
      if (!active) return;
      const ex = active.executions.find((e) => e.logId === salesforceLogId);
      setActiveLogId(ex?.executionId ?? null);
      setSelectedNodeId(null);
      setSelectedLine(null);
      setTab(to);
    },
    [active]
  );

  const downloadLog = useCallback((l: CapturedLog) => {
    setLogActionError(null);
    if (!l.body) {
      setLogActionError("No stored body for this log - pull again to fetch it.");
      return;
    }
    const url = URL.createObjectURL(new Blob([l.body], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(l.operation ?? "apex").replace(/[^a-zA-Z0-9-_]+/g, "_")}_${l.salesforceLogId}.log`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, []);

  const deleteLog = useCallback(
    async (l: CapturedLog) => {
      if (!active) return;
      if (confirmDeleteId !== l.id) {
        setConfirmDeleteId(l.id);
        return;
      }
      setConfirmDeleteId(null);
      setLogActionError(null);
      const cached = getCachedConnection();
      if (cached) {
        try {
          await deleteApexLog({ instanceUrl: cached.instanceUrl, token: cached.token, apiVersion: cached.apiVersion }, l.salesforceLogId);
        } catch (e) {
          setLogActionError(e instanceof Error ? e.message : "Org delete failed - local copy kept.");
          return;
        }
      }
      await persist({
        ...active,
        logs: active.logs.filter((x) => x.id !== l.id),
        executions: active.executions.filter((e) => e.logId !== l.salesforceLogId),
      });
    },
    [active, confirmDeleteId, persist]
  );

  /** Raw line -> owning node: clicking a log line highlights its execution node. */
  const handleSelectLine = useCallback(
    (line: number | null) => {
      setSelectedLine(line);
      if (line == null || !execution) return;
      const ev = execution.events.find((e) => e.line === line);
      const node = ev ? execution.nodes.find((n) => n.eventIds.includes(ev.id)) : undefined;
      if (node) setSelectedNodeId(node.id);
    },
    [execution]
  );

  const jump = useCallback(
    (nodeId: string | null, line: number | null) => {
      setSelectedNodeId(nodeId);
      setSelectedLine(line);
      setTab("Explore");
      // Session-level findings point at nodes in any execution - move the
      // viewer to the owning log first, otherwise the node resolves nowhere.
      const owner = active && nodeId ? active.executions.find((e) => e.nodes.some((n) => n.id === nodeId)) ?? null : null;
      if (owner && owner.executionId !== execution?.executionId) setActiveLogId(owner.executionId);
      const eff = owner ?? execution;
      if (eff && nodeId) {
        const node = eff.nodes.find((n) => n.id === nodeId);
        const firstLine = node ? eff.events.find((e) => e.id === node.eventIds[0])?.line ?? line ?? null : line;
        if (firstLine !== null && firstLine !== undefined) setSelectedLine(firstLine);
      }
    },
    [active, execution]
  );

  const markReviewed = useCallback(async () => {
    if (!active || active.status !== "parsed") return;
    await persist({ ...active, status: "diagnosed" });
  }, [active, persist]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((s) => `${s.title} ${s.problem}`.toLowerCase().includes(needle));
  }, [sessions, q]);

  if (!orgKey) {
    return (
      <>
        <div className="mx-auto w-full max-w-2xl space-y-3">
          <LogDecomposerHero />
          <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-6 text-center">
            <p className="mx-auto max-w-md text-[13px] text-ivory-500">
              Connect to Salesforce first - the org connection unlocks trace capture, log pull and decomposition.
            </p>
            <Button onClick={() => setShowConnect(true)} className="mt-3">
              Connect to Salesforce
            </Button>
          </div>
        </div>
        <ConnectModal
          open={showConnect}
          loading={connecting}
          error={connectError}
          initialInstanceUrl=""
          initialToken=""
          initialApiVersion="v66.0"
          onClose={() => {
            if (!connecting) setShowConnect(false);
          }}
          onConnect={handleConnect}
        />
      </>
    );
  }

  if (!active) {
    return (
      <div
        className={`grid min-h-0 flex-1 items-stretch gap-3 overflow-y-auto ${
          railCollapsed ? "lg:grid-cols-[52px_minmax(0,1fr)]" : "lg:grid-cols-[300px_minmax(0,1fr)]"
        }`}
      >
        <InventoryAside
          fill
          collapsed={railCollapsed}
          onToggleCollapse={() => setRailCollapsed((v) => !v)}
          title="Debug sessions"
          count={sessions.length}
          query={q}
          onQuery={setQ}
          searchLabel="Search sessions…"
          onNew={() => nameRef.current?.focus()}
          newTitle="Jump to the name box and start one"
          zeroTitle="No debug sessions yet"
          zeroLines={[
            "Name one session on the right to begin.",
            "Start a trace on a user, class or trigger.",
            "Reproduce the action, then pull the fresh log.",
            "Walk the execution tree, timeline and raw lines.",
            "Review findings with evidence, then draft the RCA.",
          ]}
        >
          <ul className="space-y-1.5">
            {shown.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => void openSession(s.id)}
                  className="w-full cursor-pointer rounded-xl border border-[#E8E2D8] bg-white px-3 py-2 text-left hover:border-[#C9A86A]"
                  title={`Open ${s.title}`}
                >
                  <span className="block truncate text-[13px] font-semibold text-ivory-950">{s.title}</span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-ivory-500">
                    {s.status} · {s.logs.length} log{s.logs.length === 1 ? "" : "s"} · {new Date(s.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </InventoryAside>
        <div className="min-w-0 space-y-3">
          <LogDecomposerHero />
          <div className="rounded-xl border border-[#E8E2D8] bg-white p-4">
            <div className="flex gap-1.5">
              <input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create();
                }}
                placeholder="New session - e.g. Order sync timeout"
                aria-label="New debug session name"
                spellCheck={false}
                ref={nameRef}
                className="min-w-0 flex-1 rounded-xl border border-[#E8E2D8] bg-white px-3 py-2 text-[13px] text-ivory-950 placeholder-ivory-400 focus:border-[#C9A86A] focus:outline-none"
              />
              <Button onClick={() => void create()}>New session</Button>
            </div>
            {createError && (
              <p className="mt-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[12px] text-red-700" role="alert">
                {createError}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`grid min-h-0 flex-1 gap-3 ${
        railCollapsed ? "lg:grid-cols-[52px_minmax(0,1fr)]" : "lg:grid-cols-[280px_minmax(0,1fr)]"
      }`}
    >
      {railCollapsed ? (
        <aside
          className="flex h-full flex-col items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] py-3"
          aria-label="Session list, collapsed"
        >
          <button
            type="button"
            onClick={() => setRailCollapsed(false)}
            title="Expand session list"
            aria-label="Expand session list"
            className="cursor-pointer rounded-lg border border-[var(--color-line)] p-1.5 text-ivory-500 hover:border-bronze-600 hover:text-ivory-950"
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
          <span className="font-mono text-[10px] text-ivory-500" title={`${sessions.length} sessions`}>
            {sessions.length}
          </span>
        </aside>
      ) : (
      <aside className="flex min-h-0 flex-col rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <div className="mb-2 flex items-center justify-between gap-1">
          <Button size="sm" variant="ghost" onClick={() => setActiveId(null)} title="Back to the library">
            <span className="inline-flex items-center gap-1">
              <ChevronLeft size={13} aria-hidden="true" /> Library
            </span>
          </Button>
          <button
            type="button"
            onClick={() => setRailCollapsed(true)}
            title="Collapse session list - more room for the canvas"
            aria-label="Collapse session list"
            className="cursor-pointer rounded-lg px-1.5 py-1 text-[13px] leading-none text-ivory-500 hover:bg-ivory-100 hover:text-ivory-950"
          >
            ⏴
          </button>
        </div>
        <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {shown.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => void openSession(s.id)}
                className={`w-full cursor-pointer rounded-lg border px-2.5 py-2 text-left ${
                  s.id === activeId ? "border-bronze-600 bg-white" : "border-transparent hover:bg-white"
                }`}
              >
                <p className="truncate text-[12px] font-bold text-ivory-950">{s.title}</p>
                <p className="text-[11px] text-ivory-500">
                  {s.status} · {s.logs.length} logs · {new Date(s.updatedAt).toLocaleDateString()}
                </p>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 border-t border-[var(--color-line)] pt-2">
          <button
            type="button"
            onClick={() => {
              void deleteDebugSession(active.id).then(() => {
                setActiveId(null);
                void refresh(orgKey);
              });
            }}
            className="cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-[12px] hover:bg-red-50 hover:text-red-700"
          >
            Delete session
          </button>
        </div>
      </aside>
      )}

      <div className="flex min-h-0 flex-col gap-3">
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            {renaming ? (
              <input
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => {
                  const next = renameDraft.trim();
                  if (next && next !== active.title) void persist({ ...active, title: next });
                  setRenaming(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(false);
                }}
                autoFocus
                aria-label="Rename debug session"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-lg border border-bronze-600 bg-white px-2 py-1 text-[15px] font-bold text-ivory-950 focus:outline-none"
              />
            ) : (
              <>
                <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-ivory-950">{active.title}</h2>
                <button
                  type="button"
                  onClick={() => {
                    setRenameDraft(active.title);
                    setRenaming(true);
                  }}
                  title="Rename session"
                  aria-label="Rename session"
                  className="shrink-0 cursor-pointer rounded-md p-1.5 text-ivory-500 hover:bg-ivory-100 hover:text-ivory-950"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setDescOpen((v) => !v)}
              title={descOpen ? "Hide problem description" : "Show problem description"}
              aria-label={descOpen ? "Hide problem description" : "Show problem description"}
              aria-expanded={descOpen}
              className="shrink-0 cursor-pointer rounded-md p-1.5 text-ivory-500 hover:bg-ivory-100 hover:text-ivory-950"
            >
              <ChevronDown size={13} aria-hidden="true" className={`transition-transform ${descOpen ? "rotate-180" : ""}`} />
            </button>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_PILL[active.status]}`}>{active.status}</span>
            {active.status === "parsed" && (
              <button
                type="button"
                onClick={() => void markReviewed()}
                className="cursor-pointer rounded-lg bg-emerald-700 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-800"
              >
                Mark reviewed
              </button>
            )}
            {active.status === "diagnosed" && active.rca && (
              <button
                type="button"
                onClick={() => void persist({ ...active, status: "handed-off" })}
                className="cursor-pointer rounded-lg bg-ivory-950 px-3 py-1.5 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800"
              >
                Mark handed off
              </button>
            )}
          </div>
          <textarea
            defaultValue={active.problem}
            key={`${active.id}-problem`}
            onBlur={(e) => {
              if (e.target.value !== active.problem) void persist({ ...active, problem: e.target.value });
            }}
            placeholder="What is failing? The symptom, the Jira ref, the expected-vs-actual…"
            rows={2}
            aria-hidden={!descOpen}
            tabIndex={descOpen ? undefined : -1}
            className={`mt-2 w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[13px] ${descOpen ? "" : "hidden"}`}
          />
          <div className="mt-2 flex gap-1.5 border-b border-[var(--color-line)]">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={`cursor-pointer px-3 py-1.5 text-[12px] font-bold ${
                  tab === t ? "border-b-2 border-[#9A7653] text-ivory-950" : "text-ivory-500 hover:text-ivory-950"
                }`}
              >
                {t}
                {t === "Diagnose" && findings.length > 0 ? ` (${findings.length})` : ""}
              </button>
            ))}
          </div>
        </section>

        {tab === "Capture" && <CapturePanel session={active} onPersist={persist} busy={busy} setBusy={setBusy} onPulled={(ids) => setActiveLogId(ids[0] ?? null)} />}

        {tab === "Logs" && (
          <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
            <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
              <h3 className="text-[13px] font-bold text-ivory-950">Logs</h3>
              <span className="text-[11px] text-ivory-500">
                {sortedLogs.length} captured · newest first · session keeps the newest 50
              </span>
            </div>
            {logActionError && (
              <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[12px] text-red-700" role="alert">
                {logActionError}
              </p>
            )}
            {sortedLogs.length === 0 ? (
              <p className="px-1 py-6 text-center text-[12px] text-ivory-500">No logs yet - start a trace and pull.</p>
            ) : (
              <ul className="space-y-1">
                {pageLogs.map((l, i) => {
                  const prev = i > 0 ? pageLogs[i - 1] : sortedLogs[safeLogPage * LOGS_PER_PAGE - 1];
                  const startsChain =
                    !!l.requestIdentifier && (!prev || prev.requestIdentifier !== l.requestIdentifier);
                  const chainN = l.requestIdentifier ? chainSizes.get(l.requestIdentifier) ?? 1 : 1;
                  return (
                    <li key={l.id}>
                      {startsChain && chainN > 1 && (
                        <p className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] font-bold text-[#722F37]">
                          <Link2 size={12} aria-hidden="true" /> Chain · {chainN} logs{active.userNames[l.userId ?? ""] ? ` · ${active.userNames[l.userId ?? ""]}` : ""}
                        </p>
                      )}
                      <div className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-2">
                        <button
                          type="button"
                          onClick={() => openLog(l.salesforceLogId)}
                          title={`Open ${l.operation ?? l.salesforceLogId} in Explore`}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                        >
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${l.status === "Success" ? "bg-emerald-600" : l.status ? "bg-red-600" : "bg-ivory-300"}`}
                            title={l.status ?? "unknown"}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-[12px] font-bold text-ivory-950" title={l.operation ?? l.salesforceLogId}>
                              {l.operation ?? l.salesforceLogId}
                            </span>
                            <span className="block truncate text-[11px] text-ivory-500">
                              {[active.userNames[l.userId ?? ""] ?? (l.userId ? l.userId.slice(0, 8) + "…" : null), l.request, l.application, l.status, l.durationMs !== undefined ? `${l.durationMs}ms` : null,
                                l.sizeBytes !== undefined ? `${(l.sizeBytes / 1024).toFixed(0)}KB${l.truncated ? "+" : ""}` : null,
                                l.startTime ? new Date(l.startTime).toLocaleString() : new Date(l.capturedAt).toLocaleString()].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                        </button>
                        <span className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openLog(l.salesforceLogId, "Diagnose")}
                            title="Analyze - open findings for this session"
                            className="cursor-pointer rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px] font-bold text-ivory-700 hover:border-bronze-600"
                          >
                            Analyze
                          </button>
                          <button
                            type="button"
                            onClick={() => downloadLog(l)}
                            title="Download the raw .log file"
                            aria-label={`Download ${l.operation ?? "log"}`}
                            className="cursor-pointer rounded-md border border-[var(--color-line)] p-1.5 text-ivory-700 hover:border-bronze-600"
                          >
                            <Download size={13} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteLog(l)}
                            title={confirmDeleteId === l.id ? "Click again to delete from the org and this session" : "Delete from the org and this session"}
                            className={`cursor-pointer rounded-md border px-2 py-1 text-[11px] font-bold ${
                              confirmDeleteId === l.id
                                ? "border-red-500 bg-red-600 text-white"
                                : "border-[var(--color-line)] text-ivory-700 hover:bg-red-50 hover:text-red-700"
                            }`}
                          >
                            {confirmDeleteId === l.id ? "Sure?" : <Trash2 size={13} aria-hidden="true" />}
                          </button>
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {logPageCount > 1 ? (
              <div className="mt-2 flex items-center gap-1.5 px-1">
                <button
                  type="button"
                  disabled={safeLogPage === 0}
                  onClick={() => setLogPage(safeLogPage - 1)}
                  aria-label="Previous logs page"
                  className="cursor-pointer rounded border border-[var(--color-line)] p-1.5 disabled:cursor-default disabled:opacity-40"
                >
                  <ChevronLeft size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={safeLogPage >= logPageCount - 1}
                  onClick={() => setLogPage(safeLogPage + 1)}
                  aria-label="Next logs page"
                  className="cursor-pointer rounded border border-[var(--color-line)] p-1.5 disabled:cursor-default disabled:opacity-40"
                >
                  <ChevronRight size={13} aria-hidden="true" />
                </button>
                <span className="ml-auto text-[11px] text-ivory-500">
                  {safeLogPage * LOGS_PER_PAGE + 1}–{Math.min(sortedLogs.length, (safeLogPage + 1) * LOGS_PER_PAGE)} of {sortedLogs.length}
                </span>
              </div>
            ) : (
              sortedLogs.length > 0 && (
                <p className="mt-2 px-1 text-[11px] text-ivory-500">{sortedLogs.length} log{sortedLogs.length === 1 ? "" : "s"} · fits on one page</p>
              )
            )}
          </section>
        )}

        {tab === "Explore" &&
          (execution ? (
            <ExplorePanel
              execution={execution}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              selectedLine={selectedLine}
              onSelectLine={handleSelectLine}
              chain={chain}
              onOpenChainLog={(id) => openLog(id)}
            />
          ) : (
            <p className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-6 text-center text-[12px] text-ivory-500">
              No executions yet - pull a log from Capture first.
            </p>
          ))}

        {tab === "Diagnose" && (
          <div className="flex min-h-0 flex-1 flex-col">
            <DiagnosePanel findings={findings} execution={execution} onJump={jump} />
          </div>
        )}

        {tab === "Investigate" && <InvestigatePanel session={active} findings={findings} executions={active.executions} onPersist={persist} onJump={jump} />}

        {tab === "RCA" && <RcaPanel session={active} onPersist={persist} />}
        </div>
    </div>
  );
}
