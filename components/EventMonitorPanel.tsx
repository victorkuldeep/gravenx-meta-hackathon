"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { isSessionExpiredMessage } from "@/lib/salesforce/client";
import {
  BayeuxClient,
  platformEventChannel,
  changeEventChannel,
  topicChannel,
  isChannelPath,
  type BayeuxMessage,
  type BayeuxStatus,
  type ChannelSub,
} from "@/lib/salesforce/bayeux";
import { apiFetch } from "@/lib/api";
import Button from "./ui/Button";

interface EventMonitorPanelProps {
  instanceUrl: string;
  apiVersion: string;
  getToken: () => string;
  onSessionExpired?: () => void;
  /** True while this mode is visible - drives channel auto-loading. */
  active?: boolean;
}

type ChannelKind = "standard" | "custom" | "change" | "topic" | "path";

const KINDS: { id: ChannelKind; label: string; hint: string }[] = [
  { id: "standard", label: "Standard Platform Event", hint: "/event/<Name>" },
  { id: "custom", label: "Custom Platform Event", hint: "/event/<Name__e>" },
  { id: "change", label: "Change Event", hint: "/data/<Object>ChangeEvent" },
  { id: "topic", label: "PushTopic", hint: "/topic/<Name>" },
  { id: "path", label: "Custom Channel Path", hint: "type the full /… path" },
];

const QUICK = ["/event/LoginEventStream", "/data/AccountChangeEvent", "/data/ContactChangeEvent"];

interface FeedEvent {
  seq: number;
  channel: string;
  replayId: number | null;
  at: number;
  data: unknown;
}

const MAX_EVENTS = 1000;

const CHANNEL_DOTS = ["bg-bronze-500", "bg-emerald-500", "bg-sky-500", "bg-violet-500", "bg-amber-500", "bg-rose-500"];

const pill: Record<string, string> = {
  connected: "border-green-300 bg-green-50 text-green-700",
  connecting: "border-amber-300 bg-amber-50 text-amber-800",
  reconnecting: "border-amber-300 bg-amber-50 text-amber-800",
  failed: "border-red-300 bg-red-50 text-red-700",
  idle: "border-[var(--color-line)] bg-white text-ivory-500",
};

/** Proper chevron for the channel dropdown - no text glyphs. */
function ChevronDown({ className = "" }: { className?: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

/** Event Monitor: live Bayeux subscribe over platform events, CDC and topics. */
export function EventMonitorPanel({ instanceUrl, apiVersion, getToken, onSessionExpired, active = true }: EventMonitorPanelProps) {
  const [kind, setKind] = useState<ChannelKind>("standard");
  const [name, setName] = useState("");
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsNote, setOptionsNote] = useState<string | null>(null);
  const [comboOpen, setComboOpen] = useState(false);
  const [comboFilter, setComboFilter] = useState("");
  const [replayMode, setReplayMode] = useState<"-1" | "-2" | "custom">("-1");
  const [replayCustom, setReplayCustom] = useState("");
  const [status, setStatus] = useState<BayeuxStatus>({ state: "disconnected" });
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  /** Active subscriptions; one Bayeux connection carries them all. */
  const [subs, setSubs] = useState<ChannelSub[]>([]);
  /** "dashboard" or a channel path. */
  const [view, setView] = useState<string>("dashboard");
  const [opBusy, setOpBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [copied, setCopied] = useState(false);

  /** One independent CometD session per listener: a stale handshake, a cookie
   * race, or a reconnect on one channel never disturbs the others. */
  const clientsRef = useRef(new Map<string, BayeuxClient>());
  /** Latest status per channel - feeds the aggregate pill plus tab states. */
  const statusByChannelRef = useRef(new Map<string, BayeuxStatus>());
  const [chanStates, setChanStates] = useState<Record<string, BayeuxStatus>>({});
  const seqRef = useRef(0);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const bufferRef = useRef<FeedEvent[]>([]);

  useEffect(
    () => () => {
      for (const c of clientsRef.current.values()) c.stop();
      clientsRef.current.clear();
    },
    []
  );

  const channelPath = useMemo(() => {
    const n = name.trim();
    if (kind === "path") return n;
    if (!n) return "";
    if (kind === "standard" || kind === "custom") return platformEventChannel(n);
    if (kind === "change") {
      if (n === "ChangeEvents") return "/data/ChangeEvents";
      return /^[A-Za-z_][\w]*ChangeEvent$/.test(n) ? `/data/${n}` : changeEventChannel(n.replace(/__e$/, ""));
    }
    return topicChannel(n);
  }, [kind, name]);

  const replay: number | null = useMemo(() => {
    if (replayMode === "-1") return -1;
    if (replayMode === "-2") return -2;
    const n = Number(replayCustom.trim());
    return replayCustom.trim() !== "" && Number.isFinite(n) ? Math.trunc(n) : null;
  }, [replayMode, replayCustom]);

  const channelValid = isChannelPath(channelPath);
  const canSubscribe =
    channelValid && replay !== null && !opBusy && !subs.some((s) => s.channel === channelPath);
  const connected = status.state === "connected" || status.state === "reconnecting";

  /** Events for the active view; dashboard converges every channel. */
  const viewEvents = view === "dashboard" ? events : events.filter((e) => e.channel === view);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) m.set(e.channel, (m.get(e.channel) ?? 0) + 1);
    return m;
  }, [events]);
  /** Last-seen timestamp per channel - feeds the listener cards. */
  const lastAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) {
      if (!m.has(e.channel)) m.set(e.channel, e.at);
    }
    return m;
  }, [events]);
  const lastEventAt = events.length > 0 ? events[0].at : null;
  const channelColor = (channel: string): string => {
    const i = subs.findIndex((s) => s.channel === channel);
    return CHANNEL_DOTS[((i % CHANNEL_DOTS.length) + CHANNEL_DOTS.length) % CHANNEL_DOTS.length];
  };

  const pushEvent = (channel: string, data: unknown, replayId: number | null) => {
    seqRef.current += 1;
    const ev: FeedEvent = { seq: seqRef.current, channel, replayId, at: Date.now(), data };
    if (pausedRef.current) {
      bufferRef.current = [...bufferRef.current.slice(-MAX_EVENTS), ev];
      return;
    }
    setEvents((p) => [ev, ...p].slice(0, MAX_EVENTS));
  };

  /** Bayeux transport rides the same-origin CometD proxy: browsers cannot POST
   * to /cometd cross-origin (no CORS headers), and the token never leaves
   * the server leg. The proxy holds healthy long-polls server-side. */
  /** Bayeux transport rides the same-origin CometD proxy: browsers cannot POST
   * to /cometd cross-origin (no CORS headers), and the token never leaves
   * the server leg. The proxy holds healthy long-polls server-side.
   * Each listener owns its jar: one channel's responses can never clobber
   * a sibling's session affinity. */
  const makePost = (token: string, jar: { current: string | null }) => async (
    messages: BayeuxMessage[],
    signal?: AbortSignal
  ): Promise<BayeuxMessage[]> => {
    // A re-handshake starts a new server session - drop the old cookie jar.
    if (messages.some((m) => m.channel === "/meta/handshake")) jar.current = null;
    const res = await apiFetch(
      "/api/salesforce/cometd",
      { instanceUrl, token, apiVersion, messages, cookie: jar.current ?? undefined },
      120000,
      signal
    );
    const data = (await res.json()) as { ok?: boolean; replies?: BayeuxMessage[]; cookie?: string | null; error?: string };
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Handshake auth failed (${res.status}) - token may have expired`);
    }
    if (!res.ok || !data.ok || !Array.isArray(data.replies)) {
      throw new Error(typeof data.error === "string" ? data.error : "Stream request failed");
    }
    if (typeof data.cookie === "string" && data.cookie) jar.current = data.cookie;
    return data.replies;
  };

  const shortChannel = (ch: string): string => ch.replace(/^\/(event|data|topic)\//, "");

  /** Roll every listener's status into one honest aggregate for the pill. */
  const recomputeAggregate = () => {
    const all = [...statusByChannelRef.current.entries()];
    const live = all.find(([, v]) => v.state === "connected");
    const busy = all.find(([, v]) => v.state === "reconnecting" || v.state === "connecting");
    const failed = all.find(([, v]) => v.state === "failed");
    if (live) {
      setStatus(live[1]);
      const pending = all.filter(([, v]) => v.state !== "connected");
      setStatusMsg(pending.length > 0 ? `${shortChannel(pending[0][0])} still connecting…` : null);
    } else if (busy) {
      const [ch, b] = busy;
      setStatus(b);
      setStatusMsg(
        b.state === "reconnecting"
          ? `Reconnecting ${shortChannel(ch)} (attempt ${b.attempt}): ${b.message}`
          : `${shortChannel(ch)} connecting…`
      );
    } else if (failed) {
      const [ch, f] = failed;
      setStatus(f);
      setStatusMsg(f.state === "failed" ? `${shortChannel(ch)}: ${f.message}` : `${shortChannel(ch)} failed`);
    } else {
      setStatus({ state: "disconnected" });
      setStatusMsg(null);
    }
  };

  const handleChannelStatus = (channel: string, s: BayeuxStatus) => {
    if (s.state === "disconnected") statusByChannelRef.current.delete(channel);
    else statusByChannelRef.current.set(channel, s);
    setChanStates(Object.fromEntries(statusByChannelRef.current));
    recomputeAggregate();
    if (s.state === "failed" && isSessionExpiredMessage(s.message)) onSessionExpired?.();
  };

  /** One independent listener per channel: its own handshake, session, jar
   * and delivery loop. Subscribing channel B never touches channel A. */
  const subscribe = async () => {
    const token = getToken();
    if (!token) {
      setStatusMsg("Session token unavailable. Please reconnect.");
      return;
    }
    if (replay === null) {
      setStatusMsg("Enter a valid replay id.");
      return;
    }
    const sub: ChannelSub = { channel: channelPath, replay };
    if (subs.some((s) => s.channel === sub.channel)) {
      setView(sub.channel);
      return;
    }
    setOpBusy(true);
    setStatusMsg(null);
    const jar = { current: null as string | null };
    const client = new BayeuxClient(
      makePost(token, jar),
      (channel, data, replayId) => pushEvent(channel, data, replayId),
      (s) => handleChannelStatus(sub.channel, s)
    );
    try {
      if (subs.length === 0) {
        setEvents([]);
        bufferRef.current = [];
      }
      const ok = await client.start([sub]);
      // A failed start leaves a dead client behind - drop it so the next
      // click starts fresh instead of failing on the corpse.
      if (!ok) return;
      clientsRef.current.set(sub.channel, client);
      setSubs((p) => [...p, sub]);
      setView(sub.channel);
      setName("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Subscribe failed";
      handleChannelStatus(sub.channel, { state: "failed", message });
    } finally {
      setOpBusy(false);
    }
  };

  /** Drop one listener; its session, jar and loop die with it. */
  const unsubscribeChannel = async (channel: string) => {
    const client = clientsRef.current.get(channel);
    if (client) {
      try {
        await client.removeChannel(channel);
      } catch {
        /* best-effort goodbye keeps the feed honest */
      }
      client.stop();
      clientsRef.current.delete(channel);
    }
    statusByChannelRef.current.delete(channel);
    setChanStates(Object.fromEntries(statusByChannelRef.current));
    recomputeAggregate();
    const next = subs.filter((s) => s.channel !== channel);
    setSubs(next);
    if (view === channel) setView("dashboard");
  };

  /** Hard reset: kill every listener session, jar and loop; clear everything. */
  const resetAll = () => {
    for (const c of clientsRef.current.values()) c.stop();
    clientsRef.current.clear();
    statusByChannelRef.current.clear();
    setChanStates({});
    bufferRef.current = [];
    setSubs([]);
    setEvents([]);
    setView("dashboard");
    setStatus({ state: "disconnected" });
    setStatusMsg(null);
    setOpBusy(false);
  };

  const togglePause = () => {
    if (paused) {
      const buffered = bufferRef.current;
      bufferRef.current = [];
      if (buffered.length > 0) setEvents((p) => [...buffered.reverse(), ...p].slice(0, MAX_EVENTS));
    }
    setPaused((v) => !v);
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return viewEvents;
    return viewEvents.filter((e) => JSON.stringify(e.data).toLowerCase().includes(q));
  }, [viewEvents, filter]);

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(filtered.map((e) => ({ channel: e.channel, replayId: e.replayId, at: new Date(e.at).toISOString(), data: e.data })), null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  const runSoql = async (token: string, soql: string, useTooling = false): Promise<Record<string, unknown>[]> => {
    const response = await apiFetch(
      "/api/salesforce/soql",
      { instanceUrl, token, apiVersion, soql, tooling: useTooling },
      60000
    );
    const data = (await response.json()) as { success?: boolean; records?: Record<string, unknown>[]; error?: string };
    if (!response.ok || data.error || !data.success) {
      throw new Error(typeof data.error === "string" ? data.error : "Query failed");
    }
    return data.records ?? [];
  };

  /** Global describe, one call - reused by the custom + change lists. */
  const describeObjects = async (token: string): Promise<{ name: string; label: string }[]> => {
    const ver = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
    const response = await apiFetch(
      "/api/salesforce/rest",
      { instanceUrl, token, scope: "org", method: "GET", path: `/services/data/${ver}/sobjects/` },
      60000
    );
    const data = (await response.json()) as { success?: boolean; body?: { sobjects?: { name: string; label: string }[] }; error?: string };
    if (!response.ok || data.error) throw new Error(typeof data.error === "string" ? data.error : "List failed");
    return data.body?.sobjects ?? [];
  };

  /** Auto-pull the channel list for the active type - no hand-typed names. */
  const loadOptions = async (forKind: ChannelKind, token: string) => {
    setLoadingOptions(true);
    setOptionsNote(null);
    try {
      if (forKind === "custom") {
        // Proven against a live org: EntityDefinition LIKE cannot express a
        // literal "__e" - unescaped _ is a wildcard (matches "AccountShare"),
        // escaped \_ returns zero rows. Global describe + endsWith is exact.
        const found = (await describeObjects(token))
          .filter((s) => s.name.endsWith("__e"))
          .map((s) => ({ value: s.name, label: s.label ?? s.name }))
          .sort((a, b) => a.value.localeCompare(b.value));
        setOptions(found);
        if (found.length === 0) setOptionsNote("No custom platform events on this org.");
      } else if (forKind === "standard") {
        const rows = await runSoql(
          token,
          "SELECT QualifiedApiName, Label FROM EntityDefinition WHERE (QualifiedApiName LIKE '%Event' OR QualifiedApiName LIKE '%Stream') AND (NOT QualifiedApiName LIKE '%ChangeEvent') ORDER BY QualifiedApiName LIMIT 300"
        );
        const skip = new Set(["Event", "EventLogFile"]);
        setOptions(
          rows
            .map((r) => ({ value: String(r.QualifiedApiName ?? ""), label: String(r.Label ?? r.QualifiedApiName ?? "") }))
            .filter((o) => o.value && !skip.has(o.value) && !/Subscriber|Config/i.test(o.value))
        );
      } else if (forKind === "topic") {
        const rows = await runSoql(token, "SELECT Name FROM PushTopic ORDER BY Name LIMIT 200");
        setOptions(
          rows
            .map((r) => ({ value: String(r.Name ?? ""), label: String(r.Name ?? "") }))
            .filter((o) => o.value)
        );
        if (rows.length === 0) setOptionsNote("No push topics on this org - create one or type a channel path.");
      } else if (forKind === "change") {
        // Inspector's exact pattern: the standard ChangeEvents channel's
        // members ARE the CDC-enabled entities - no guessing from describe.
        const rows = await runSoql(
          token,
          "SELECT MasterLabel, SelectedEntity FROM PlatformEventChannelMember WHERE EventChannel = 'ChangeEvents' ORDER BY MasterLabel",
          true
        );
        const found = rows
          .map((r) => ({ value: String(r.SelectedEntity ?? ""), label: String(r.MasterLabel ?? r.SelectedEntity ?? "") }))
          .filter((o) => o.value);
        setOptions([{ value: "ChangeEvents", label: "All Change Events" }, ...found]);
        if (found.length === 0) setOptionsNote("No CDC-enabled objects on this org - enable Change Data Capture first.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Channel list failed";
      setOptionsNote(message);
      if (isSessionExpiredMessage(message)) onSessionExpired?.();
    } finally {
      setLoadingOptions(false);
    }
  };

  // Auto-pull channels when the tab opens or the type changes.
  useEffect(() => {
    if (!active) return;
    if (kind === "path") {
      setOptions([]);
      setOptionsNote(null);
      return;
    }
    const token = getToken();
    if (!token) {
      setOptions([]);
      setOptionsNote("Connect to load channels from the org.");
      return;
    }
    void loadOptions(kind, token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, active]);

  const phase = status.state;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-[#27241F]">Subscribe to a Channel</h2>
            <p className="text-xs text-[#777168]">Live Bayeux stream direct from your org - token stays in this tab.</p>
          </div>
          <span className={`rounded border px-2 py-0.5 font-mono text-[11px] font-bold ${pill[phase] ?? pill.idle}`} title="One independent live session per listener">
            {connected && status.state === "connected" ? `● ${subs.length} live` : phase}
          </span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[#777168]" htmlFor="ev-kind">Channel Type</label>
            <select
              id="ev-kind"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as ChannelKind);
                setName("");
                setComboOpen(false);
                setComboFilter("");
              }}
              disabled={opBusy}
              className="w-full cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] text-[#27241F] disabled:opacity-60"
            >
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>{k.label}</option>
              ))}
            </select>
          </div>
          <div className="relative">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[#777168]" htmlFor="ev-name">
              {kind === "path" ? "Channel Path" : kind === "topic" ? "Topic Name" : kind === "change" ? "Object" : "Event"}
              {options.length > 0 && <span className="ml-1 font-mono normal-case text-[#A39B8E]">({options.length})</span>}
            </label>
            <div className="flex gap-1">
              <input
                id="ev-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={opBusy}
                placeholder={kind === "path" ? "/event/My_Event__e" : kind === "change" ? "Account" : kind === "topic" ? "MyTopic" : "My_Event__e"}
                spellCheck={false}
                className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 font-mono text-[12px] text-[#27241F] placeholder:text-[#A39B8E] disabled:opacity-60"
              />
              {kind !== "path" && (
                <button
                  type="button"
                  onClick={() => {
                    setComboFilter("");
                    setComboOpen((v) => !v);
                  }}
                  disabled={opBusy || (options.length === 0 && !loadingOptions)}
                  aria-expanded={comboOpen}
                  aria-label="Show all channels"
                  title={options.length > 0 ? `Show all ${options.length} channels` : loadingOptions ? "Loading channels…" : "No channels loaded"}
                  className="flex shrink-0 cursor-pointer items-center rounded-lg border border-[#E8E2D8] bg-white px-2 text-[#27241F] hover:border-[#A98450] disabled:opacity-50"
                >
                  <ChevronDown className={loadingOptions ? "animate-pulse" : ""} />
                </button>
              )}
            </div>
            {comboOpen && kind !== "path" && (
              <div className="absolute z-20 mt-1 flex max-h-80 w-[min(26rem,92vw)] flex-col overflow-hidden rounded-xl border border-[#E8E2D8] bg-white shadow-lg">
                <div className="border-b border-[#E8E2D8] p-2">
                  <input
                    value={comboFilter}
                    onChange={(e) => setComboFilter(e.target.value)}
                    placeholder="Type to filter…"
                    aria-label="Filter channels"
                    spellCheck={false}
                    autoFocus
                    className="w-full rounded-md border border-[#E8E2D8] px-2 py-1.5 text-[12px] text-[#27241F] placeholder:text-[#A39B8E] focus:border-[#A98450] focus:outline-none"
                  />
                </div>
                <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
                  {options
                    .filter((o) => {
                      const q = comboFilter.trim().toLowerCase();
                      if (!q) return true;
                      return o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q);
                    })
                    .map((o) => (
                      <li key={o.value}>
                        <button
                          type="button"
                          onClick={() => {
                            setName(o.value);
                            setComboOpen(false);
                          }}
                          title={o.value}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--color-canvas)]"
                        >
                          <span className="min-w-0 flex-1 truncate text-[12px] text-[#27241F]">{o.label}</span>
                          {o.label !== o.value && (
                            <span className="shrink-0 truncate font-mono text-[10px] text-[#777168]" title={o.value}>{o.value}</span>
                          )}
                        </button>
                      </li>
                    ))}
                </ul>
                <div className="flex items-center justify-between gap-2 border-t border-[#E8E2D8] bg-[var(--color-canvas)] px-2.5 py-1.5">
                  <span className="font-mono text-[10px] text-[#777168]">
                    {options.length} channel{options.length === 1 ? "" : "s"}
                    {comboFilter.trim() ? " (filtered)" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => setComboOpen(false)}
                    className="cursor-pointer rounded-md border border-[#E8E2D8] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#27241F] hover:border-[#A98450]"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-[#777168]" htmlFor="ev-replay">Replay From</label>
            <div className="flex gap-1">
              <select
                value={replayMode}
                onChange={(e) => setReplayMode(e.target.value as "-1" | "-2" | "custom")}
                disabled={opBusy}
                aria-label="Replay preset"
                className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] text-[#27241F] disabled:opacity-60"
              >
                <option value="-1">-1 new</option>
                <option value="-2">-2 stored</option>
                <option value="custom">id…</option>
              </select>
              {replayMode === "custom" && (
                <input
                  value={replayCustom}
                  onChange={(e) => setReplayCustom(e.target.value)}
                  disabled={opBusy}
                  placeholder="123"
                  inputMode="numeric"
                  aria-label="Replay id"
                  className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 font-mono text-[12px] text-[#27241F] disabled:opacity-60"
                />
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-1.5">
            <Button
              size="sm"
              onClick={() => void subscribe()}
              disabled={!canSubscribe}
              title={channelValid ? `Subscribe ${channelPath}` : "Pick a channel above, then subscribe - add as many as you need"}
            >
              {opBusy ? "Adding…" : subs.length === 0 ? "Subscribe" : "Add channel"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={resetAll}
              title="Stop everything, clear channels and events, start over"
            >
              Reset
            </Button>
          </div>
        </div>
        {channelPath && (
          <p className="mt-1.5 font-mono text-[11px] text-[#777168]" title="Resolved Bayeux channel">
            → {channelPath}{replay !== null && replay >= 0 ? ` · from ${replay}` : ""}
          </p>
        )}
        {optionsNote && (
          <p className="mt-1.5 text-[12px] text-[#777168]" role="status">{optionsNote}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {kind !== "path" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const token = getToken();
                if (token) void loadOptions(kind, token);
              }}
              disabled={loadingOptions || opBusy}
              title="Reload the channel list from the org"
            >
              {loadingOptions ? "Loading…" : "Refresh list"}
            </Button>
          )}
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              disabled={opBusy}
              onClick={() => {
                if (q.startsWith("/data/")) {
                  setKind("change");
                  setName(q.replace("/data/", "").replace(/ChangeEvent$/, ""));
                } else {
                  setKind("path");
                  setName(q);
                }
              }}
              className="cursor-pointer rounded-full border border-[#E8E2D8] px-2 py-0.5 font-mono text-[11px] text-[#777168] hover:text-[#27241F] disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
        {statusMsg && (
          <p className={`mt-2 text-[12px] ${phase === "failed" ? "text-red-700" : phase === "reconnecting" || phase === "connecting" ? "text-amber-700" : "text-[#777168]"}`} role="status">{statusMsg}</p>
        )}
      </div>

      <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-1 border-b border-[#E8E2D8] pb-2" role="tablist" aria-label="Listeners">
          <button
            type="button"
            role="tab"
            aria-selected={view === "dashboard"}
            onClick={() => setView("dashboard")}
            title="Converged view across every listener"
            className={`cursor-pointer rounded-t-md border-b-2 px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
              view === "dashboard"
                ? "border-bronze-500 text-bronze-700"
                : "border-transparent text-[#777168] hover:text-[#27241F]"
            }`}
          >
            Dashboard
            <span className="ml-1 font-mono font-normal text-[#A39B8E]">{events.length}</span>
          </button>
          {subs.map((s) => {
            const selected = view === s.channel;
            const liveState = chanStates[s.channel]?.state;
            const replayLabel = s.replay === -1 ? "new" : s.replay === -2 ? "stored" : `#${s.replay}`;
            const seen = lastAt.get(s.channel);
            const short = s.channel.replace(/^\/(event|data|topic)\//, "");
            return (
              <span
                key={s.channel}
                className={`flex max-w-[240px] items-center gap-1 rounded-t-md border-b-2 px-1 py-1 text-[11px] font-semibold transition-colors ${
                  selected ? "border-bronze-500" : "border-transparent"
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setView(s.channel)}
                  title={`${s.channel} · replay ${replayLabel}${seen ? ` · last ${new Date(seen).toLocaleTimeString()}` : " · waiting…"}`}
                  className={`flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-1.5 py-0.5 ${
                    selected ? "text-bronze-700" : "text-[#777168] hover:text-[#27241F]"
                  } ${liveState && liveState !== "connected" ? "animate-pulse" : ""}`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${channelColor(s.channel)}`} aria-hidden="true" />
                  <span className="truncate font-mono" title={s.channel}>{short}</span>
                  <span className="shrink-0 font-mono font-normal text-[#A39B8E]">({counts.get(s.channel) ?? 0})</span>
                </button>
                <button
                  type="button"
                  onClick={() => void unsubscribeChannel(s.channel)}
                  aria-label={`Remove listener ${s.channel}`}
                  title={`Remove listener ${s.channel}`}
                  className="shrink-0 cursor-pointer rounded px-1 text-[12px] leading-none text-[#A39B8E] hover:bg-bronze-200 hover:text-bronze-700"
                >
                  ✕
                </button>
              </span>
            );
          })}
          {subs.length === 0 && (
            <span className="px-2 py-1.5 text-[11px] text-[#A39B8E]">No listeners yet — subscribe above.</span>
          )}
        </div>
        {view === "dashboard" && subs.length > 0 && (
          <div className="mt-2 grid grid-cols-3 divide-x divide-[#E8E2D8] rounded-lg border border-[#E8E2D8]">
            {[
              ["Events", String(events.length), `${events.length} events received across every listener`],
              ["Listeners", String(subs.length), `${subs.length} active channel subscriptions`],
              ["Last event", lastEventAt ? new Date(lastEventAt).toLocaleTimeString() : "—", "Most recent delivery"],
            ].map(([k, v, hint]) => (
              <div key={k} className="px-3 py-2" title={hint}>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#A39B8E]">{k}</p>
                <p className="mt-0.5 truncate font-mono text-[16px] font-bold leading-none text-[#27241F]">{v}</p>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h3 className="text-[13px] font-semibold text-[#27241F]">
            {view === "dashboard" ? "Converged Stream" : "Channel Stream"}
          </h3>
          <span className="rounded bg-ivory-100 px-1.5 py-0.5 font-mono text-[11px] text-ivory-600">{filtered.length} events</span>
          <Button size="sm" variant="secondary" onClick={() => void copyAll()} disabled={filtered.length === 0}>
            {copied ? "Copied ✓" : "Copy"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setEvents([]); bufferRef.current = []; }} disabled={events.length === 0}>
            Clear
          </Button>
          <Button size="sm" variant="ghost" onClick={togglePause} disabled={!connected && events.length === 0} title="Freeze the list (incoming events buffer)">
            {paused ? "Resume" : "Pause"}
          </Button>
          {view !== "dashboard" && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void unsubscribeChannel(view)}
              title={`Unsubscribe ${view} and close this tab`}
            >
              Unsubscribe
            </Button>
          )}
          <span className="flex-1" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter events…"
            aria-label="Filter events"
            spellCheck={false}
            className="w-44 rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] text-[#27241F] placeholder:text-[#A39B8E]"
          />
        </div>
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-[#777168]">
            {subs.length === 0
              ? "Subscribe to a channel above - add as many as you need; the dashboard converges them all."
              : paused
                ? "Paused - resume to show buffered events."
                : connected
                  ? view === "dashboard"
                    ? `Listening on ${subs.length} channel${subs.length === 1 ? "" : "s"}… trigger events in your org.`
                    : `Listening on ${view}… trigger the event in your org.`
                  : "Reconnecting… the feed resumes automatically."}
          </p>
        ) : (
          <ul className="mt-2 max-h-[420px] space-y-1.5 overflow-y-auto">
            {filtered.map((e) => {
              const open = expanded.has(e.seq);
              return (
                <li key={e.seq} className="rounded-lg border border-[#E8E2D8] px-2.5 py-1.5">
                  <button
                    type="button"
                    onClick={() => setExpanded((p) => {
                      const n = new Set(p);
                      if (n.has(e.seq)) n.delete(e.seq);
                      else n.add(e.seq);
                      return n;
                    })}
                    className="flex w-full cursor-pointer items-center gap-2 text-left"
                    aria-expanded={open}
                  >
                    <span className="font-mono text-[10px] text-[#A39B8E]">#{e.seq}</span>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${channelColor(e.channel)}`} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#27241F]" title={e.channel}>{e.channel}</span>
                    {e.replayId !== null && <span className="shrink-0 font-mono text-[10px] text-[#777168]" title="Replay id">@{e.replayId}</span>}
                    <span className="shrink-0 font-mono text-[10px] text-[#A39B8E]">{new Date(e.at).toLocaleTimeString()}</span>
                    <span className="shrink-0 text-[11px] text-bronze-600">{open ? "▾" : "▸"}</span>
                  </button>
                  {open && (
                    <pre className="mt-1.5 max-h-[240px] overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--color-canvas)] p-2 font-mono text-[11px] text-[#27241F]">
                      {JSON.stringify(e.data, null, 2)}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
