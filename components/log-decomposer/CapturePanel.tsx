"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCachedConnection } from "@/lib/session/cache";
import {
  createDebugLevel,
  clearTraceFlag,
  getApexLogBody,
  getMyIdentity,
  listApexLogs,
  listOrgTraceFlags,
  resolveUserNames,
  searchTraceTargets,
  setTraceFlag,
  viaApiFetch,
  type OrgTraceFlag,
  type SfConnection,
  type TraceTargetRow,
} from "@/lib/log-decomposer/capture";
import { capRawBody, MAX_SESSION_LOGS, sessionTraces, type DebugSession, type TraceConfig } from "@/lib/log-decomposer/model";
import type { TracePreset } from "@/lib/log-decomposer/tooling";
import { parseLog } from "@/lib/log-decomposer/parser";
import { detectFindings } from "@/lib/log-decomposer/findings";

const PRESET_LABEL: Record<TracePreset, string> = {
  smart: "Smart debug",
  "apex-deep": "Apex deep dive",
  integration: "Integration debug",
  performance: "Performance debug",
  custom: "Custom",
};

const PRESET_HINT: Record<TracePreset, string> = {
  smart: "Balanced - Apex DEBUG with system context.",
  "apex-deep": "Apex + profiling at FINEST.",
  integration: "Callouts at FINEST with Apex + system context.",
  performance: "Profiling + database at FINEST.",
  custom: "Neutral INFO baseline - tune categories later.",
};

/** Max logs pulled per click - each body is a full round-trip + parse. */
const PULL_BATCH = 5;
const POLL_MS = 15000;

function connOf(): (SfConnection & { orgKey: string }) | null {
  const c = getCachedConnection();
  return c ? { instanceUrl: c.instanceUrl, token: c.token, apiVersion: c.apiVersion, orgKey: c.orgKey || c.instanceUrl } : null;
}

export function CapturePanel({
  session,
  onPersist,
  busy,
  setBusy,
  onPulled,
}: {
  session: DebugSession;
  onPersist: (next: DebugSession) => Promise<void>;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onPulled: (logIds: string[]) => void;
}) {
  // New-trace composer draft - who to trace, how deep, for how long.
  const [targetKind, setTargetKind] = useState<"user" | "class" | "trigger">("user");
  const [targetId, setTargetId] = useState("");
  const [targetName, setTargetName] = useState("");
  const [preset, setPreset] = useState<TracePreset>("smart");
  const [minutes, setMinutes] = useState(30);
  const [selected, setSelected] = useState<number | "new">(() => (sessionTraces(session).length > 0 ? 0 : "new"));

  // New session opened under us - park on its first tab, clear the composer.
  const sessionId = session.id;
  useEffect(() => {
    setSelected(sessionTraces(session).length > 0 ? 0 : "new");
    setTargetId("");
    setTargetName("");
    setStatus(null);
    setAuto(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  const [meBusy, setMeBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [orgFlags, setOrgFlags] = useState<OrgTraceFlag[]>([]);
  const [flagsLoading, setFlagsLoading] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseQuery, setBrowseQuery] = useState("");
  const [browseRows, setBrowseRows] = useState<TraceTargetRow[]>([]);
  const [browseBusy, setBrowseBusy] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);

  // Auto-pull ticks against whatever render installed the interval - the
  // ref keeps every tick reading the latest session, otherwise each poll
  // re-fetches the same logs and piles duplicates up to the session cap.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const busyRef = useRef(false);

  const traces = sessionTraces(sessionRef.current);
  const live = (t: TraceConfig) => !!t.flagId && !!t.expiresAt && t.expiresAt > Date.now();
  const tracing = traces.some(live);
  const liveCount = traces.filter(live).length;
  const selTrace = typeof selected === "number" ? traces[selected] ?? null : null;

  const loadOrgFlags = useCallback(async () => {
    const conn = connOf();
    if (!conn) return;
    setFlagsLoading(true);
    try {
      const ids = sessionTraces(sessionRef.current).map((t) => t.flagId).filter((f): f is string => !!f);
      setOrgFlags(await listOrgTraceFlags(conn, ids, viaApiFetch()));
    } catch {
      /* panel keeps the last list; the status line carries the error */
    } finally {
      setFlagsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrgFlags();
  }, [loadOrgFlags]);

  // Debounced target search while the picker is open.
  useEffect(() => {
    if (!browseOpen) return;
    const q = browseQuery.trim();
    if (!q) {
      setBrowseRows([]);
      setBrowseError(null);
      return;
    }
    setBrowseBusy(true);
    const timer = window.setTimeout(() => {
      const conn = connOf();
      if (!conn) {
        setBrowseBusy(false);
        setBrowseError("Connect to Salesforce first.");
        return;
      }
      searchTraceTargets(conn, targetKind, q, viaApiFetch())
        .then((rows) => {
          setBrowseRows(rows);
          setBrowseError(rows.length === 0 ? `No ${targetKind === "user" ? "users" : targetKind === "class" ? "classes" : "triggers"} match "${q}".` : null);
        })
        .catch((e) => setBrowseError(e instanceof Error ? e.message : "Search failed."))
        .finally(() => setBrowseBusy(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [browseOpen, browseQuery, targetKind]);

  const openBrowse = () => {
    setBrowseQuery(targetName.trim());
    setBrowseRows([]);
    setBrowseError(null);
    setBrowseOpen(true);
  };

  const pull = async (silent = false) => {
    if (busyRef.current) return;
    const conn = connOf();
    if (!conn) {
      if (!silent) setStatus("Connect to Salesforce first - the org connection unlocks capture.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    if (!silent) setStatus("Listing fresh ApexLogs…");
    try {
      const live = sessionRef.current;
      const fetchImpl = viaApiFetch();
      const rows = await listApexLogs(conn, 25, fetchImpl);
      const known = new Set(live.logs.map((l) => l.salesforceLogId));
      const fresh = rows.filter((r) => !known.has(r.Id)).slice(0, PULL_BATCH);
      if (fresh.length === 0) {
        if (!silent) setStatus(rows.length === 0 ? "No logs yet - reproduce the action in the org, then pull again." : "No new logs - everything here is already decomposed.");
        return;
      }
      if (!silent) setStatus(`Decomposing ${fresh.length} log${fresh.length > 1 ? "s" : ""}…`);
      const logs = [...live.logs];
      const executions = [...live.executions];
      const pulled: string[] = [];
      for (const r of fresh) {
        const { body, truncated } = await getApexLogBody(conn, r.Id, fetchImpl);
        const capped = capRawBody(body);
        const { model } = parseLog(capped.body, r.Id);
        model.findings = detectFindings(model);
        logs.unshift({
          id: `log_${r.Id}`,
          sessionId: live.id,
          salesforceLogId: r.Id,
          operation: r.Operation,
          status: r.Status,
          durationMs: r.DurationMilliseconds,
          sizeBytes: r.LogLength,
          request: r.Request,
          requestIdentifier: r.RequestIdentifier,
          application: r.Application,
          startTime: r.StartTime,
          userId: r.LogUserId,
          capturedAt: Date.now(),
          body: capped.body,
          truncated: truncated || capped.truncated,
        });
        executions.push(model);
        pulled.push(model.executionId);
      }
      // Newest-first, bounded: a long trace session must not grow IDB without end.
      const kept = logs.slice(0, MAX_SESSION_LOGS);
      const pruned = logs.length - kept.length;
      const keptIds = new Set(kept.map((l) => l.salesforceLogId));
      const names = await resolveUserNames(
        conn,
        kept.map((l) => l.userId ?? "").filter(Boolean),
        fetchImpl
      ).catch(() => ({} as Record<string, string>));
      await onPersist({
        ...live,
        status: live.status === "capturing" ? "capturing" : "parsed",
        logs: kept,
        executions: executions.filter((e) => keptIds.has(e.logId)),
        userNames: { ...(live.userNames ?? {}), ...names },
      });
      onPulled(pulled);
      if (!silent)
        setStatus(
          `Decomposed ${fresh.length} log${fresh.length > 1 ? "s" : ""} - open Explore.` +
            (pruned > 0 ? ` Pruned ${pruned} oldest (session keeps the newest ${MAX_SESSION_LOGS}).` : "")
        );
    } catch (e) {
      if (!silent) setStatus(e instanceof Error ? e.message : "Pull failed.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  useEffect(() => {
    if (auto && tracing) {
      pollRef.current = setInterval(() => void pull(true), POLL_MS);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, tracing, session.id]);

  /** Plant a DebugLevel + TraceFlag and file it as a tab (replaces the same target's tab). */
  const launch = async (target: TraceConfig["target"], usePreset: TracePreset, mins: number) => {
    const conn = connOf();
    if (!conn) {
      setStatus("Connect to Salesforce first - the org connection unlocks capture.");
      return;
    }
    setBusy(true);
    setStatus(`Tracing ${target.name} - creating DebugLevel + TraceFlag…`);
    try {
      const fetchImpl = viaApiFetch();
      const levelId = await createDebugLevel(conn, usePreset, fetchImpl);
      const expiresAt = Date.now() + mins * 60 * 1000;
      const newFlagId = await setTraceFlag(conn, target.id, levelId, new Date(expiresAt).toISOString(), fetchImpl);
      const live = sessionRef.current;
      const next: TraceConfig = { target, preset: usePreset, debugLevelId: levelId, flagId: newFlagId, expiresAt };
      const rest = sessionTraces(live).filter((t) => !(t.target.kind === target.kind && t.target.id === target.id));
      const traces = [...rest, next];
      await onPersist({ ...live, status: "capturing", traces });
      setSelected(traces.length - 1);
      setStatus(`Trace live on ${target.name} for ${mins} min - reproduce the action, then Pull logs.`);
      setAuto(true);
      await loadOrgFlags();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Trace setup failed.");
    } finally {
      setBusy(false);
    }
  };

  const startDraft = () => {
    const id = targetId.trim();
    if (!id) {
      setStatus("Pick a target first - Browse users or describe a class/trigger.");
      return;
    }
    void launch({ kind: targetKind, id, name: targetName.trim() || id }, preset, minutes);
  };

  /** One click, no picking: resolve who owns this token and trace them. */
  const traceMe = async () => {
    const conn = connOf();
    if (!conn) {
      setStatus("Connect to Salesforce first - the org connection unlocks capture.");
      return;
    }
    setMeBusy(true);
    setStatus("Resolving who you are on this org…");
    try {
      const me = await getMyIdentity(conn, viaApiFetch());
      const name = me.name || me.username || "Me";
      const idx = sessionTraces(sessionRef.current).findIndex((t) => t.target.kind === "user" && t.target.id === me.userId);
      if (idx >= 0) {
        setSelected(idx);
        setStatus(`You already have a tab - ${name}. Start it again from there if it expired.`);
        return;
      }
      await launch({ kind: "user", id: me.userId, name }, preset, minutes);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not resolve the logged-in user.");
    } finally {
      setMeBusy(false);
    }
  };

  const stopTrace = async (t: TraceConfig) => {
    const conn = connOf();
    setBusy(true);
    try {
      if (conn && t.flagId) await clearTraceFlag(conn, t.flagId, viaApiFetch());
    } catch {
      /* teardown is best-effort - the flag expires on its own */
    }
    const live = sessionRef.current;
    const traces = sessionTraces(live).map((x) =>
      x.target.kind === t.target.kind && x.target.id === t.target.id ? { ...x, flagId: undefined, expiresAt: undefined } : x
    );
    const anyLive = traces.some((x) => !!x.flagId && !!x.expiresAt && x.expiresAt > Date.now());
    await onPersist({ ...live, status: anyLive ? "capturing" : live.logs.length > 0 ? "parsed" : "open", traces });
    if (!anyLive) setAuto(false);
    setStatus(`Trace on ${t.target.name} stopped - the flag expires on its own if teardown missed.`);
    await loadOrgFlags();
    setBusy(false);
  };

  const stopFlag = async (id: string) => {
    const conn = connOf();
    if (!conn) return;
    setBusy(true);
    try {
      await clearTraceFlag(conn, id, viaApiFetch());
      setStatus("Flag removed from the org.");
      await loadOrgFlags();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not remove the flag.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <h3 className="text-[13px] font-bold text-ivory-950">Traces · {liveCount} live</h3>
        <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Trace targets">
          {traces.map((t, i) => (
            <button
              key={`${t.target.kind}:${t.target.id}`}
              type="button"
              role="tab"
              aria-selected={selected === i}
              onClick={() => setSelected(i)}
              title={`${t.target.kind}: ${t.target.name} · ${PRESET_LABEL[t.preset]}${live(t) ? " · live" : ""}`}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-bold ${
                selected === i ? "border-[#9A7653] bg-[#FBF6EC] text-ivory-950" : "border-[var(--color-line)] bg-white hover:border-[#C9A86A]"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${live(t) ? "bg-emerald-600" : "bg-ivory-300"}`} />
              {t.target.name}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={selected === "new"}
            onClick={() => setSelected("new")}
            title="Trace someone new"
            className={`cursor-pointer rounded-full border px-3 py-1 text-[12px] font-bold ${
              selected === "new" ? "border-[#9A7653] bg-[#FBF6EC] text-ivory-950" : "border-dashed border-[var(--color-line)] bg-white hover:border-[#C9A86A]"
            }`}
          >
            + New
          </button>
        </div>
        {selTrace ? (
          <>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
              <dt className="text-ivory-500">Target</dt>
              <dd className="truncate font-mono font-bold text-ivory-950" title={selTrace.target.id}>
                {selTrace.target.kind}: {selTrace.target.name}
              </dd>
              <dt className="text-ivory-500">Preset</dt>
              <dd className="text-ivory-950">{PRESET_LABEL[selTrace.preset]}</dd>
              <dt className="text-ivory-500">Expires</dt>
              <dd className="text-ivory-950">{selTrace.expiresAt ? new Date(selTrace.expiresAt).toLocaleTimeString() : "—"}</dd>
              <dt className="text-ivory-500">Status</dt>
              <dd className={`font-bold ${live(selTrace) ? "text-emerald-700" : "text-ivory-500"}`}>
                {live(selTrace) ? "Live" : "Idle"}
              </dd>
            </dl>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {live(selTrace) ? (
                <button
                  type="button"
                  onClick={() => void stopTrace(selTrace)}
                  disabled={busy}
                  className="cursor-pointer rounded-lg border border-red-300 px-4 py-2 text-[12px] font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Stop trace
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void launch(selTrace.target, selTrace.preset, minutes)}
                  disabled={busy}
                  className="cursor-pointer rounded-lg bg-ivory-950 px-4 py-2 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800 disabled:opacity-50"
                >
                  {busy ? "Starting…" : "Start trace"}
                </button>
              )}
              <button
                type="button"
                onClick={() => void pull()}
                disabled={busy}
                className="cursor-pointer rounded-lg border border-[var(--color-line)] px-4 py-2 text-[12px] font-bold hover:bg-ivory-50 disabled:opacity-50"
              >
                {busy ? "Pulling…" : "Pull logs"}
              </button>
            </div>
          </>
        ) : (
          <>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(["user", "class", "trigger"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTargetKind(k)}
              aria-pressed={targetKind === k}
              className={`cursor-pointer rounded-full border px-3 py-1 text-[12px] font-bold ${
                targetKind === k ? "border-[#9A7653] bg-[#FBF6EC] text-ivory-950" : "border-[var(--color-line)] bg-white hover:border-[#C9A86A]"
              }`}
            >
              {k === "user" ? "User" : k === "class" ? "Apex class" : "Apex trigger"}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <input
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder={targetKind === "user" ? "User id, e.g. 005…" : targetKind === "class" ? "Class id, e.g. 01p…" : "Trigger id"}
              spellCheck={false}
              aria-label="Trace target id"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 font-mono text-[12px]"
            />
            <button
              type="button"
              onClick={openBrowse}
              className="shrink-0 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-[12px] font-bold hover:bg-ivory-50"
            >
              Browse
            </button>
          </div>
          <input
            value={targetName}
            onChange={(e) => setTargetName(e.target.value)}
            placeholder="Label, e.g. Kuldeep / OrderService (optional)"
            spellCheck={false}
            aria-label="Trace target label"
            className="w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[12px]"
          />
        </div>
        <h3 className="mt-3 text-[13px] font-bold text-ivory-950">Preset</h3>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {(Object.keys(PRESET_LABEL) as TracePreset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              aria-pressed={preset === p}
              title={PRESET_HINT[p]}
              className={`rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer ${
                preset === p ? "border-[#9A7653] bg-[#FBF6EC]" : "border-[var(--color-line-soft)] bg-[var(--color-canvas)] hover:border-[#C9A86A]"
              }`}
            >
              <span className="block text-[12px] font-bold text-ivory-950">{PRESET_LABEL[p]}</span>
              <span className="block text-[11px] text-ivory-500">{PRESET_HINT[p]}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Trace duration">
          <span className="text-[11px] font-bold text-ivory-500">For</span>
          {[10, 30, 60].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMinutes(m)}
              aria-pressed={minutes === m}
              className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                minutes === m ? "border-[#9A7653] bg-[#FBF6EC] text-ivory-950" : "border-[var(--color-line)] bg-white hover:border-[#C9A86A]"
              }`}
            >
              {m === 60 ? "1 hr" : `${m} min`}
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => void traceMe()}
            disabled={busy || meBusy}
            title="Resolve the logged-in user and trace them - no picking"
            className="cursor-pointer rounded-lg border border-[#722F37] bg-white px-4 py-2 text-[12px] font-bold text-[#722F37] hover:bg-[#722F37] hover:text-white disabled:opacity-50"
          >
            {meBusy ? "Resolving…" : "Trace me"}
          </button>
          <button
            type="button"
            onClick={startDraft}
            disabled={busy}
            className="cursor-pointer rounded-lg bg-ivory-950 px-4 py-2 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800 disabled:opacity-50"
          >
            {busy ? "Starting…" : "Start trace"}
          </button>
          <button
            type="button"
            onClick={() => void pull()}
            disabled={busy}
            className="cursor-pointer rounded-lg border border-[var(--color-line)] px-4 py-2 text-[12px] font-bold hover:bg-ivory-50 disabled:opacity-50"
          >
            {busy ? "Pulling…" : "Pull logs"}
          </button>
        </div>
          </>
        )}
      </section>

      <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${tracing ? "bg-emerald-600" : session.logs.length > 0 ? "bg-sky-600" : "bg-ivory-300"}`} />
          <h3 className="text-[13px] font-bold text-ivory-950">{tracing ? "Listening" : session.logs.length > 0 ? "Logs received" : "Ready"}</h3>
          <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12px] text-ivory-600">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} disabled={!tracing} className="accent-[#9A7653]" />
            Auto-pull every 15s
          </label>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-ivory-500">Traces</dt>
          <dd className="font-bold text-ivory-950">
            {liveCount} live / {traces.length} tab{traces.length === 1 ? "" : "s"}
          </dd>
          <dt className="text-ivory-500">Logs captured</dt>
          <dd className="font-bold text-ivory-950">{session.logs.length}</dd>
        </dl>
        {status && <p className="mt-2 rounded-lg bg-white px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-ivory-700">{status}</p>}
        <p className="mt-2 text-[11px] leading-relaxed text-ivory-500">
          Trace flags live in your org - stop the trace when done. Raw bodies are capped at 1MB per log and stay in this browser.
        </p>
      </section>

      <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4 lg:col-span-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-bold text-ivory-950">On the org now</h3>
          <span className="text-[11px] text-ivory-500">{orgFlags.length} active flag{orgFlags.length === 1 ? "" : "s"} - whoever set them</span>
          <button
            type="button"
            onClick={() => void loadOrgFlags()}
            disabled={flagsLoading}
            className="ml-auto cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-bold hover:bg-ivory-50 disabled:opacity-50"
          >
            {flagsLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {orgFlags.length === 0 ? (
          <p className="mt-2 text-[12px] text-ivory-500">No active trace flags - neither Dev Console, Setup, nor this studio is tracing right now.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {orgFlags.map((f) => (
              <li
                key={f.Id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[12px]"
              >
                <span className="rounded-full bg-ivory-200 px-1.5 py-px text-[10px] font-bold uppercase text-ivory-700">{f.targetKind}</span>
                {f.ours && <span className="rounded-full bg-[#FBF6EC] px-1.5 py-px text-[10px] font-bold uppercase text-[#9A7653] ring-1 ring-[#9A7653]">this session</span>}
                <span className="min-w-0 flex-1 truncate font-mono text-ivory-950" title={f.TracedEntityId}>
                  {f.TracedEntityId}
                </span>
                <span className="shrink-0 text-ivory-600">{f.debugLevelName}</span>
                <span className="shrink-0 font-mono text-[11px] text-ivory-500">
                  {f.ExpirationDate ? `expires ${new Date(f.ExpirationDate).toLocaleTimeString()}` : "no expiry"}
                </span>
                <button
                  type="button"
                  onClick={() => void stopFlag(f.Id)}
                  disabled={busy}
                  className="shrink-0 cursor-pointer rounded border border-[var(--color-line)] px-2 py-0.5 text-[11px] font-bold hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                >
                  Stop
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {browseOpen && (
        <div className="modal-overlay modal-notes" role="dialog" aria-modal="true" aria-label="Pick a trace target" onClick={() => setBrowseOpen(false)}>
          <div className="modal-card max-w-lg p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-bold text-ivory-950">
                Pick {targetKind === "user" ? "a user" : targetKind === "class" ? "a class" : "a trigger"} to trace
              </h3>
              <button
                type="button"
                onClick={() => setBrowseOpen(false)}
                aria-label="Close target picker"
                className="ml-auto cursor-pointer rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-100"
              >
                ×
              </button>
            </div>
            <input
              value={browseQuery}
              onChange={(e) => setBrowseQuery(e.target.value)}
              placeholder={targetKind === "user" ? "Type a name or username…" : "Type a class or trigger name…"}
              spellCheck={false}
              autoFocus
              aria-label="Search trace targets"
              className="mt-2 w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[13px] placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
            />
            <div className="mt-2 max-h-72 overflow-y-auto">
              {browseBusy && <p className="px-1 py-4 text-center text-[12px] text-ivory-500">Searching the org…</p>}
              {!browseBusy && browseError && <p className="px-1 py-4 text-center text-[12px] text-ivory-500">{browseError}</p>}
              {!browseBusy && !browseError && browseRows.length > 0 && (
                <ul className="space-y-1.5">
                  {browseRows.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setTargetId(r.id);
                          setTargetName(r.name);
                          setBrowseOpen(false);
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-2 text-left hover:border-bronze-600"
                      >
                        <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ivory-950">{r.name}</span>
                        <span className="shrink-0 truncate font-mono text-[11px] text-ivory-500" title={r.detail}>
                          {r.detail}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!browseBusy && !browseError && browseRows.length === 0 && (
                <p className="px-1 py-4 text-center text-[12px] text-ivory-500">Type a few letters - matches land here, newest first.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
