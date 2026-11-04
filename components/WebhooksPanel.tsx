"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "./ui/Button";
import { ConfirmDialog } from "./ui/ConfirmDialog";

interface WebhooksPanelProps {
  instanceUrl: string;
  apiVersion: string;
  getToken: () => string;
  onSessionExpired?: () => void;
  /** True while this mode is visible - drives feed polling. */
  active?: boolean;
}

interface OwnerEntry {
  uuid: string;
  name: string;
  note: string;
  active: boolean;
  expiresAt: number;
  lastAt: number;
}

interface WebhookCapture {
  reqId: string;
  at: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  bodyText: string;
  size: number;
  truncated: boolean;
}

const POLL_MS = 2500;
const FEED_CAP = 100;

function fmtTime(at: number): string {
  try {
    return new Date(at).toLocaleTimeString();
  } catch {
    return "";
  }
}

function fmtExpiry(expiresAt: number): string {
  if (!expiresAt) return "—";
  const days = Math.max(0, Math.round((expiresAt - Date.now()) / 86400000));
  return `${new Date(expiresAt).toLocaleDateString()} (${days}d left)`;
}

function prettyBody(bodyText: string): string {
  const t = bodyText.trim();
  if (!t) return "(empty body)";
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return bodyText;
  }
}

async function copyText(text: string, done: () => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    done();
  } catch {
    /* clipboard unavailable - selection still works */
  }
}

function sessionExpired(data: unknown, status: number): boolean {
  return status === 401 && (data as { error?: string } | null)?.error === "session expired";
}

function gone(data: unknown, status: number): boolean {
  return status === 404 && (data as { error?: string } | null)?.error === "not found";
}

const DEFAULT_BODY = '{"ok":true,"id":"{{reqId}}"}';

const PRESETS: { label: string; status: string; headers: string; body: string }[] = [
  { label: "Default ok", status: "200", headers: "", body: DEFAULT_BODY },
  {
    label: "Echo correlation ID",
    status: "200",
    headers: "X-Correlation-ID: {{headers.x-correlation-id}}",
    body: '{"ok":true,"id":"{{reqId}}","correlationId":"{{headers.x-correlation-id}}"}',
  },
  {
    label: "201 Created",
    status: "201",
    headers: "",
    body: '{"created":true,"id":"{{reqId}}","at":"{{at}}"}',
  },
];

function ResponseEditor({
  status,
  headersText,
  body,
  onStatus,
  onHeaders,
  onBody,
}: {
  status: string;
  headersText: string;
  body: string;
  onStatus: (v: string) => void;
  onHeaders: (v: string) => void;
  onBody: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-[var(--color-muted)]">
        What senders get back. Tokens:{" "}
        <code className="font-mono">{"{{method}} {{path}} {{reqId}} {{at}} {{query.name}} {{headers.x-id}} {{body}}"}</code>
      </p>
      <span className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => {
              onStatus(p.status);
              onHeaders(p.headers);
              onBody(p.body);
            }}
            className="rounded-full border border-[var(--color-line)] px-2 py-0.5 text-xs hover:bg-ivory-50"
          >
            {p.label}
          </button>
        ))}
      </span>
      <label className="block max-w-32 space-y-1">
        <span className="text-xs font-medium">Status</span>
        <input
          value={status}
          onChange={(e) => onStatus(e.target.value)}
          inputMode="numeric"
          className="w-full rounded-md border border-[var(--color-line)] bg-white px-2 py-1 font-mono text-sm"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium">Headers (one Name: value per line)</span>
        <textarea
          value={headersText}
          onChange={(e) => onHeaders(e.target.value)}
          rows={2}
          placeholder={"X-Correlation-ID: {{headers.x-correlation-id}}"}
          className="w-full rounded-md border border-[var(--color-line)] bg-white px-2 py-1 font-mono text-xs"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium">Body template</span>
        <textarea
          value={body}
          onChange={(e) => onBody(e.target.value)}
          rows={4}
          className="w-full rounded-md border border-[var(--color-line)] bg-white px-2 py-1 font-mono text-xs"
        />
      </label>
    </div>
  );
}

/** Webhooks console: register inboxes, watch live traffic, inspect everything. */
export function WebhooksPanel({ instanceUrl, getToken, onSessionExpired, active = true }: WebhooksPanelProps) {
  const [entries, setEntries] = useState<OwnerEntry[]>([]);
  const [regBusy, setRegBusy] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formStep, setFormStep] = useState<1 | 2>(1);
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");
  const [mStatus, setMStatus] = useState("200");
  const [mHeaders, setMHeaders] = useState("");
  const [mBody, setMBody] = useState(DEFAULT_BODY);

  const openForm = () => {
    setNewName("");
    setNewNote("");
    setFormStep(1);
    setMStatus("200");
    setMHeaders("");
    setMBody(DEFAULT_BODY);
    setRegError(null);
    setShowForm(true);
  };
  const [selUuid, setSelUuid] = useState<string | null>(null);
  const [feed, setFeed] = useState<WebhookCapture[]>([]);
  const [received, setReceived] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  /** The selected uuid no longer exists server-side (released, or a dev
   *  server restart cleared the in-memory mesh). */
  const [inboxGone, setInboxGone] = useState(false);
  const [selReqId, setSelReqId] = useState<string | null>(null);
  const [opBusy, setOpBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // Response designer state.
  const [respOpen, setRespOpen] = useState(false);
  const [respStatus, setRespStatus] = useState("200");
  const [respHeadersText, setRespHeadersText] = useState("");
  const [respBody, setRespBody] = useState('{"ok":true,"id":"{{reqId}}"}');
  const [respSaving, setRespSaving] = useState(false);
  const [respMsg, setRespMsg] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState(false);
  const [testResp, setTestResp] = useState<{ status: number; body: string } | null>(null);

  const activeRef = useRef(active);
  activeRef.current = active;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const selRef = useRef<string | null>(null);
  selRef.current = selUuid;
  const sinceRef = useRef<string | undefined>(undefined);
  const nameRef = useRef<HTMLInputElement>(null);

  const session = useCallback(
    () => ({ token: getToken(), instanceUrl }),
    [getToken, instanceUrl]
  );

  useEffect(() => {
    if (showForm) {
      const t = window.setTimeout(() => nameRef.current?.focus(), 60);
      return () => window.clearTimeout(t);
    }
  }, [showForm]);

  useEffect(() => {
    if (!showForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowForm(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showForm]);

  const loadMine = useCallback(async () => {
    setRegError(null);
    try {
      const res = await fetch("/api/webhooks/mine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(session()),
      });
      const data = (await res.json()) as { ok?: boolean; entries?: OwnerEntry[]; error?: string };
      if (sessionExpired(data, res.status)) {
        onSessionExpired?.();
        return;
      }
      if (!res.ok || data.ok !== true) throw new Error(data.error ?? `mine failed (${res.status})`);
      const list = Array.isArray(data.entries) ? data.entries : [];
      setEntries(list);
      if (!selRef.current && list.length > 0) {
        setSelUuid(list.find((e) => e.active)?.uuid ?? list[0].uuid);
      }
    } catch (err) {
      setRegError(err instanceof Error ? err.message : "could not load webhooks");
    }
  }, [session, onSessionExpired]);

  const loadFeed = useCallback(
    async (reset: boolean) => {
      const uuid = selRef.current;
      if (!uuid) return;
      try {
        const res = await fetch(`/api/webhooks/${uuid}/feed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...session(), since: reset ? undefined : sinceRef.current, limit: 50 }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          requests?: WebhookCapture[];
          received?: number;
          error?: string;
        };
        if (sessionExpired(data, res.status)) {
          onSessionExpired?.();
          return;
        }
        if (gone(data, res.status)) {
          setInboxGone(true);
          setFeedError(null);
          return;
        }
        if (!res.ok || data.ok !== true) throw new Error(data.error ?? `feed failed (${res.status})`);
        setInboxGone(false);
        setFeedError(null);
        if (typeof data.received === "number") setReceived(data.received);
        const rows = Array.isArray(data.requests) ? data.requests : [];
        if (reset) {
          setFeed(rows.slice(-FEED_CAP));
          sinceRef.current = rows.length > 0 ? rows[rows.length - 1].reqId : undefined;
        } else if (rows.length > 0) {
          setFeed((prev) => {
            const seen = new Set(prev.map((r) => r.reqId));
            const next = [...prev, ...rows.filter((r) => !seen.has(r.reqId))];
            return next.slice(-FEED_CAP);
          });
          sinceRef.current = rows[rows.length - 1].reqId;
        }
      } catch (err) {
        setFeedError(err instanceof Error ? err.message : "feed failed");
      }
    },
    [session, onSessionExpired]
  );

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  const loadResp = useCallback(async () => {
    const uuid = selRef.current;
    if (!uuid) return;
    try {
      const res = await fetch(`/api/webhooks/${uuid}/response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(session()),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        config?: { status?: number; headers?: Record<string, string>; body?: string };
        error?: string;
      };
      if (sessionExpired(data, res.status)) {
        onSessionExpired?.();
        return;
      }
      if (gone(data, res.status)) {
        setInboxGone(true);
        return;
      }
      if (res.ok && data.ok === true && data.config) {
        setRespStatus(String(data.config.status ?? 200));
        setRespHeadersText(
          Object.entries(data.config.headers ?? {})
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")
        );
        setRespBody(data.config.body ?? "");
      }
    } catch {
      /* designer keeps its defaults; saving will overwrite */
    }
  }, [session, onSessionExpired]);

  useEffect(() => {
    sinceRef.current = undefined;
    setFeed([]);
    setReceived(null);
    setSelReqId(null);
    setInboxGone(false);
    setFeedError(null);
    setRespMsg(null);
    setTestResp(null);
    if (selUuid) {
      void loadFeed(true);
      void loadResp();
    }
  }, [selUuid, loadFeed, loadResp]);

  // Silent polling: no per-tick busy flash, new rows just appear.
  useEffect(() => {
    if (!active || paused || !selUuid) return;
    const t = window.setInterval(() => {
      if (activeRef.current && !pausedRef.current && selRef.current) void loadFeed(false);
    }, POLL_MS);
    return () => window.clearInterval(t);
  }, [active, paused, selUuid, loadFeed]);

  const register = async () => {
    const name = newName.trim();
    if (!name) return;
    const customized = mStatus !== "200" || mHeaders.trim() !== "" || mBody !== DEFAULT_BODY;
    setRegBusy(true);
    setRegError(null);
    try {
      const res = await fetch("/api/webhooks/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...session(), name, note: newNote.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; uuid?: string; expiresAt?: number; error?: string };
      if (sessionExpired(data, res.status)) {
        onSessionExpired?.();
        return;
      }
      if (!res.ok || data.ok !== true || !data.uuid) throw new Error(data.error ?? `register failed (${res.status})`);
      const entry: OwnerEntry = {
        uuid: data.uuid,
        name,
        note: newNote.trim(),
        active: true,
        expiresAt: data.expiresAt ?? 0,
        lastAt: Date.now(),
      };
      setEntries((prev) => [entry, ...prev]);
      setShowForm(false);
      setSelUuid(data.uuid);
      if (customized && data.uuid) {
        // Step 2 of registration: shape the reply up front (best-effort here;
        // the card designer stays available for later edits).
        try {
          await fetch(`/api/webhooks/${data.uuid}/response`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...session(),
              config: { status: Number(mStatus), headers: parseHeaderLines(mHeaders), body: mBody },
            }),
          });
        } catch {
          /* inbox itself is live; designer shows the state */
        }
        setRespOpen(true);
      }
    } catch (err) {
      setRegError(err instanceof Error ? err.message : "register failed");
    } finally {
      setRegBusy(false);
    }
  };

  const [pendingRelease, setPendingRelease] = useState<string | null>(null);

  const mutate = async (
    uuid: string,
    path: "activate" | "heartbeat" | "release",
    payload: unknown,
  ) => {
    setOpBusy(true);
    try {
      const url = path === "activate" ? "/api/webhooks/activate" : `/api/webhooks/${uuid}/${path}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; entries?: OwnerEntry[]; expiresAt?: number; error?: string };
      if (sessionExpired(data, res.status)) {
        onSessionExpired?.();
        return;
      }
      if (gone(data, res.status)) {
        setInboxGone(true);
        return;
      }
      if (!res.ok || data.ok !== true) throw new Error(data.error ?? `update failed (${res.status})`);
      if (path === "release") {
        setEntries((prev) => prev.filter((e) => e.uuid !== uuid));
        if (selRef.current === uuid) {
          setSelUuid(null);
          setFeed([]);
          setInboxGone(false);
        }
      } else if (Array.isArray(data.entries)) {
        setEntries(data.entries);
      } else if (typeof data.expiresAt === "number") {
        setEntries((prev) => prev.map((e) => (e.uuid === uuid ? { ...e, expiresAt: data.expiresAt as number } : e)));
      }
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : "update failed");
    } finally {
      setOpBusy(false);
    }
  };

  const saveResponse = async () => {
    const uuid = selRef.current;
    if (!uuid) return;
    setRespSaving(true);
    setRespMsg(null);
    try {
      const status = Number(respStatus);
      const headers = parseHeaderLines(respHeadersText);
      const res = await fetch(`/api/webhooks/${uuid}/response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...session(), config: { status, headers, body: respBody } }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (sessionExpired(data, res.status)) {
        onSessionExpired?.();
        return;
      }
      if (gone(data, res.status)) {
        setInboxGone(true);
        return;
      }
      if (!res.ok || data.ok !== true) throw new Error(data.error ?? `save failed (${res.status})`);
      setRespMsg("Saved — applies to the next request.");
    } catch (err) {
      setRespMsg(err instanceof Error ? err.message : "save failed");
    } finally {
      setRespSaving(false);
    }
  };

  const sendTest = async () => {
    const uuid = selRef.current;
    if (!uuid || !origin) return;
    setTestBusy(true);
    setTestResp(null);
    try {
      const res = await fetch(`${origin}/api/webhooks/${uuid}/console-test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ping: "from-console", at: new Date().toISOString() }),
      });
      setTestResp({ status: res.status, body: (await res.text()).slice(0, 2000) });
      void loadFeed(false);
    } catch (err) {
      setTestResp({ status: 0, body: err instanceof Error ? err.message : "request failed" });
    } finally {
      setTestBusy(false);
    }
  };

  const selected = entries.find((e) => e.uuid === selUuid) ?? null;

  function parseHeaderLines(text: string): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const i = t.indexOf(":");
      if (i <= 0) throw new Error(`bad header line (need Name: value): ${t}`);
      headers[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
    return headers;
  }
  const inspected = feed.find((r) => r.reqId === selReqId) ?? null;
  const liveCount = entries.filter((e) => e.active).length;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const copiedTimer = useRef(0);

  const markCopied = (key: string) => {
    setCopied(key);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(null), 1500);
  };

  const polling = active && !paused && selUuid && !inboxGone;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-lg font-semibold">Webhooks</h2>
          <p className="text-sm text-[var(--color-muted)]">
            Live inbound traffic for this org + user · keeps the last {FEED_CAP} requests per inbox
          </p>
        </div>
        <span className="ml-auto rounded-full border border-[var(--color-line)] bg-white px-2.5 py-1 text-xs">
          {liveCount}/10 live · {entries.length} registered
        </span>
        <Button size="sm" variant="secondary" onClick={() => void loadMine()}>
          Refresh
        </Button>
        <Button size="sm" disabled={liveCount >= 10} onClick={openForm}>
          New webhook
        </Button>
      </div>
      {regError && <p className="text-sm text-red-700">{regError}</p>}

      {entries.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--color-line)] bg-white px-3 py-6 text-center text-sm text-[var(--color-muted)]">
          No webhooks yet. Register one to get its URL, then paste it into Salesforce remote site settings or an
          outbound integration.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-line)] rounded-md border border-[var(--color-line)] bg-white">
          {entries.map((e) => (
            <li key={e.uuid}>
              <button
                type="button"
                onClick={() => setSelUuid(e.uuid)}
                aria-current={selUuid === e.uuid}
                className={`block w-full px-3 py-2 text-left hover:bg-ivory-50 ${
                  selUuid === e.uuid ? "bg-ivory-100" : ""
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{e.name}</span>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
                      e.active
                        ? "border-green-300 bg-green-50 text-green-700"
                        : "border-[var(--color-line)] bg-ivory-50 text-[var(--color-muted)]"
                    }`}
                  >
                    {e.active ? "live" : "paused"}
                  </span>
                </span>
                <span className="mt-0.5 block truncate font-mono text-xs text-[var(--color-muted)]">
                  {origin}/api/webhooks/{e.uuid} · expires {fmtExpiry(e.expiresAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div className="space-y-3 rounded-md border border-[var(--color-line)] bg-white p-3">
          <div className="flex flex-wrap items-start gap-2 border-b border-[var(--color-line)] pb-3">
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-semibold">{selected.name}</h3>
              {selected.note && <p className="mt-0.5 text-sm text-[var(--color-muted)]">{selected.note}</p>}
              <p className="mt-1 truncate font-mono text-xs text-[var(--color-muted)]">
                {origin}/api/webhooks/{selected.uuid}
              </p>
              <p className="mt-1 text-xs text-[var(--color-muted)]">
                {received ?? "—"} captured · expires {fmtExpiry(selected.expiresAt)}
              </p>
            </div>
            <span className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void copyText(`${origin}/api/webhooks/${selected.uuid}`, () => markCopied("url"))}
              >
                {copied === "url" ? "Copied" : "Copy URL"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={opBusy}
                onClick={() =>
                  void mutate(selected.uuid, "activate", {
                    ...session(),
                    uuids: [{ uuid: selected.uuid, active: !selected.active }],
                  })
                }
              >
                {selected.active ? "Pause" : "Resume"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={opBusy}
                title="Extend expiry by 7 days"
                onClick={() => void mutate(selected.uuid, "heartbeat", session())}
              >
                Extend
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={opBusy}
                onClick={() => setPendingRelease(selected.uuid)}
                title="Release this inbox - captured requests are purged and the URL stops working"
              >
                Release
              </Button>
              {pendingRelease && (
                <ConfirmDialog
                  title={`Release ${entries.find((e) => e.uuid === pendingRelease)?.name ?? "this inbox"}?`}
                  message="Captured requests are purged and the URL stops working. This cannot be undone."
                  confirmLabel="Release inbox"
                  tone="danger"
                  onCancel={() => setPendingRelease(null)}
                  onConfirm={() => {
                    const uuid = pendingRelease;
                    setPendingRelease(null);
                    void mutate(uuid, "release", session());
                  }}
                />
              )}
            </span>
          </div>

          {!inboxGone && (
            <div className="rounded-md border border-[var(--color-line)]">
              <button
                type="button"
                onClick={() => setRespOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
              >
                <span className="font-semibold">Response</span>
                <span className="font-mono text-xs text-[var(--color-muted)]">
                  {respStatus} · {respBody.trim().startsWith("{") ? "JSON" : "text"}
                </span>
                <span className="ml-auto text-xs text-[var(--color-muted)]">{respOpen ? "hide" : "design"}</span>
              </button>
              {respOpen && (
                <div className="space-y-2 border-t border-[var(--color-line)] px-3 py-2">
                  <ResponseEditor
                    status={respStatus}
                    headersText={respHeadersText}
                    body={respBody}
                    onStatus={setRespStatus}
                    onHeaders={setRespHeadersText}
                    onBody={setRespBody}
                  />
                  {respMsg && <p className="text-xs text-[var(--color-muted)]">{respMsg}</p>}
                  <span className="flex flex-wrap items-center gap-2">
                    <Button size="sm" loading={respSaving} onClick={() => void saveResponse()}>
                      Save response
                    </Button>
                    <Button size="sm" variant="secondary" disabled={testBusy} onClick={() => void sendTest()}>
                      {testBusy ? "Sending…" : "Send test request"}
                    </Button>
                    {testResp && (
                      <span className="font-mono text-xs text-[var(--color-muted)]">
                        → {testResp.status} {testResp.body.slice(0, 120)}
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          {inboxGone ? (
            <div className="rounded-md border border-dashed border-[var(--color-line)] px-3 py-6 text-center">
              <p className="text-sm font-medium">This inbox no longer exists on the server.</p>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                It was released, expired, or the dev server restarted (localhost keeps inboxes in memory only).
              </p>
              <span className="mt-3 flex items-center justify-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={opBusy}
                  onClick={() => void mutate(selected.uuid, "release", session())}
                >
                  Drop stale entry
                </Button>
                <Button size="sm" onClick={openForm}>
                  Register a new one
                </Button>
              </span>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold">
                  Live traffic {polling ? <span className="font-normal text-green-700">· live</span> : <span className="font-normal text-[var(--color-muted)]">· paused</span>}
                </h4>
                <span className="ml-auto flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setPaused((p) => !p)}>
                    {paused ? "Resume live" : "Pause live"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void loadFeed(true)}>
                    Reload last {FEED_CAP}
                  </Button>
                </span>
              </div>
              {feedError && <p className="text-sm text-red-700">{feedError}</p>}
              <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                <div>
                  {feed.length === 0 ? (
                    <p className="rounded-md border border-dashed border-[var(--color-line)] px-3 py-6 text-center text-sm text-[var(--color-muted)]">
                      No requests captured yet. POST anything to the inbox URL above - traffic streams in here live.
                    </p>
                  ) : (
                    <ul className="max-h-96 divide-y divide-[var(--color-line)] overflow-y-auto rounded-md border border-[var(--color-line)]">
                      {[...feed].reverse().map((r) => (
                        <li key={r.reqId}>
                          <button
                            type="button"
                            onClick={() => setSelReqId(r.reqId)}
                            className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-ivory-50 ${
                              selReqId === r.reqId ? "bg-ivory-100" : ""
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="rounded bg-ivory-100 px-1.5 py-0.5 font-mono font-semibold">{r.method}</span>
                              <span className="min-w-0 flex-1 truncate font-mono">{r.path}</span>
                              <span className="shrink-0 text-[var(--color-muted)]">{fmtTime(r.at)}</span>
                            </span>
                            <span className="mt-0.5 block truncate font-mono text-[var(--color-muted)]">
                              {r.reqId} · {(r.size / 1024).toFixed(1)} KB
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  {!inspected ? (
                    <p className="rounded-md border border-dashed border-[var(--color-line)] px-3 py-6 text-center text-sm text-[var(--color-muted)]">
                      Pick a request to inspect its headers, query and payload.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <h5 className="font-mono text-xs text-[var(--color-muted)]">{inspected.reqId}</h5>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="ml-auto"
                          onClick={() => void copyText(prettyBody(inspected.bodyText), () => markCopied("body"))}
                        >
                          {copied === "body" ? "Copied" : "Copy payload"}
                        </Button>
                      </div>
                      <div>
                        <h6 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                          Headers ({Object.keys(inspected.headers).length})
                        </h6>
                        {Object.keys(inspected.headers).length === 0 ? (
                          <p className="text-xs text-[var(--color-muted)]">No headers captured.</p>
                        ) : (
                          <dl className="overflow-hidden rounded-md border border-[var(--color-line)] text-xs">
                            {Object.entries(inspected.headers).map(([k, v]) => (
                              <div key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2 border-b border-[var(--color-line)] px-2 py-1 last:border-0">
                                <dt className="truncate font-mono">{k}</dt>
                                <dd className="break-all font-mono text-[var(--color-muted)]">{v}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                      <div>
                        <h6 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                          Query ({Object.keys(inspected.query).length})
                        </h6>
                        {Object.keys(inspected.query).length === 0 ? (
                          <p className="text-xs text-[var(--color-muted)]">No query string.</p>
                        ) : (
                          <dl className="overflow-hidden rounded-md border border-[var(--color-line)] text-xs">
                            {Object.entries(inspected.query).map(([k, v]) => (
                              <div key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2 border-b border-[var(--color-line)] px-2 py-1 last:border-0">
                                <dt className="truncate font-mono">{k}</dt>
                                <dd className="break-all font-mono text-[var(--color-muted)]">{v}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </div>
                      <div>
                        <h6 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                          Payload · {(inspected.size / 1024).toFixed(1)} KB{inspected.truncated ? " · truncated" : ""}
                        </h6>
                        <pre className="max-h-80 overflow-auto rounded-md border border-[var(--color-line)] bg-ivory-50 p-2 font-mono text-xs whitespace-pre-wrap break-all">
                          {prettyBody(inspected.bodyText)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (!regBusy) setShowForm(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Register webhook"
            className="w-full max-w-md space-y-3 rounded-lg border border-[var(--color-line)] bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">Register webhook</h3>
            <p className="text-sm text-[var(--color-muted)]">
              Step {formStep} of 2 — {formStep === 1 ? "Details" : "Response"}. Bound to this org + user by your
              Salesforce session.
            </p>
            {formStep === 1 ? (
              <>
                <label className="block space-y-1">
                  <span className="text-sm font-medium">Name</span>
                  <input
                    ref={nameRef}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. order-events"
                    maxLength={80}
                    className="w-full rounded-md border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-sm font-medium">
                    Description <span className="font-normal text-[var(--color-muted)]">(optional)</span>
                  </span>
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="e.g. TMF622 order drops from the middleware pilot"
                    maxLength={280}
                    rows={3}
                    className="w-full rounded-md border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-sm"
                  />
                </label>
              </>
            ) : (
              <ResponseEditor
                status={mStatus}
                headersText={mHeaders}
                body={mBody}
                onStatus={setMStatus}
                onHeaders={setMHeaders}
                onBody={setMBody}
              />
            )}
            {regError && <p className="text-sm text-red-700">{regError}</p>}
            <span className="flex items-center justify-end gap-2">
              {formStep === 1 ? (
                <>
                  <Button size="sm" variant="secondary" disabled={regBusy} onClick={() => setShowForm(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" disabled={!newName.trim()} onClick={() => setFormStep(2)}>
                    Continue
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="secondary" disabled={regBusy} onClick={() => setFormStep(1)}>
                    Back
                  </Button>
                  <Button size="sm" loading={regBusy} onClick={() => void register()}>
                    Register
                  </Button>
                </>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
