"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { STORES, withStore, DB_NAME, DB_VERSION } from "@/lib/db";
import { LOG_CATEGORIES, LOG_LEVELS } from "@/lib/salesforce/apex";
import { getPreferences, resetPreferences, savePreferences, type Preferences } from "@/lib/setup/preferences";
import { isSalesforceConnected, readLiveSession, type LiveSession } from "@/lib/ai/gate";
import { listAllAiSessions, type AiSession } from "@/lib/ai/historyDb";
import { apiFetch } from "@/lib/api";
import { PROVIDER_PRESETS } from "@/lib/ai/providers";
import { hasProviderKey } from "@/lib/ai/keyVault";
import { getPolicy, savePolicy } from "@/lib/setup/policy";

/** Mirrors package.json - bump together on release. */
const APP_NAME = "gravenx";
const APP_VERSION = "0.1.0";

function Card({ title, hint, right, children }: { title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="arch-card overflow-hidden">
      <div className="arch-card__head flex items-center gap-2 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ivory-950">{title}</p>
          {hint ? <p className="mt-0.5 text-[11px] text-ivory-600">{hint}</p> : null}
        </div>
        {right}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

export function ConnectionsPanel() {
  const [conn, setConn] = useState<LiveSession | null>(null);
  const [keyed, setKeyed] = useState<string[]>([]);
  const [usage, setUsage] = useState<{
    sessions: number;
    totalIn: number;
    totalOut: number;
    byModel: { key: string; sessions: number; totalIn: number; totalOut: number }[];
  } | null>(null);
  const [orgs, setOrgs] = useState<{ key: string; sessions: number; lastActive: number; live: boolean }[] | null>(null);
  const refresh = () => {
    let live: LiveSession | null = null;
    try {
      // Same two-source read as the AI gate: module cache, else the tab's
      // restore record - a reloaded tab is still connected.
      live = readLiveSession();
      setConn(live);
    } catch {
      setConn(null);
    }
    setKeyed(PROVIDER_PRESETS.filter((p) => {
      try {
        return hasProviderKey(p.id);
      } catch {
        return false;
      }
    }).map((p) => p.id));
    void (async () => {
      try {
        const all: AiSession[] = await listAllAiSessions();
        let totalIn = 0;
        let totalOut = 0;
        const byModel = new Map<string, { sessions: number; totalIn: number; totalOut: number }>();
        const byOrg = new Map<string, { sessions: number; last: number }>();
        for (const s of all) {
          totalIn += s.totalIn || 0;
          totalOut += s.totalOut || 0;
          const mk = `${s.providerId} / ${s.modelId}`;
          const m = byModel.get(mk) ?? { sessions: 0, totalIn: 0, totalOut: 0 };
          m.sessions += 1;
          m.totalIn += s.totalIn || 0;
          m.totalOut += s.totalOut || 0;
          byModel.set(mk, m);
          const o = byOrg.get(s.orgKey) ?? { sessions: 0, last: 0 };
          o.sessions += 1;
          o.last = Math.max(o.last, s.updatedAt);
          byOrg.set(s.orgKey, o);
        }
        setUsage({
          sessions: all.length,
          totalIn,
          totalOut,
          byModel: [...byModel.entries()]
            .map(([key, v]) => ({ key, ...v }))
            .sort((a, b) => b.totalIn + b.totalOut - (a.totalIn + a.totalOut)),
        });
        setOrgs(
          [...byOrg.entries()]
            .map(([key, v]) => ({ key, sessions: v.sessions, lastActive: v.last, live: !!live && live.orgKey === key }))
            .sort((a, b) => b.lastActive - a.lastActive)
        );
      } catch {
        setUsage(null);
        setOrgs(null);
      }
    })();
  };
  useEffect(() => {
    refresh();
  }, []);
  return (
    <div className="space-y-3">
      <Card
        title="Salesforce session"
        hint="Live connection the agent and panels share. The token lives in this tab's memory - never on disk."
        right={
          <button
            type="button"
            onClick={refresh}
            className="cursor-pointer rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950"
          >
            Refresh
          </button>
        }
      >
        {!conn ? (
          <p className="text-xs text-ivory-600">
            Not connected - connect from the Studio home, then the agent unlocks everywhere.
          </p>
        ) : (
          <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
            {(
              [
                ["Org host", (() => { try { return new URL(conn.instanceUrl).hostname; } catch { return conn.instanceUrl; } })()],
                ["API version", conn.apiVersion],
                ["Objects cached", typeof conn.objectCount === "number" ? String(conn.objectCount) : "live - open Schema to cache"],
                ["Org key", conn.orgKey ?? "live - resolves on Schema"],
                ["Token", "present in this tab (never shown, never stored)"],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="shrink-0 font-semibold text-ivory-600">{k}</dt>
                <dd className="min-w-0 truncate font-mono text-[11px] text-ivory-950">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
      <Card
        title="AI providers"
        hint="Keys live in this browser's vault (localStorage). Models are picked in Model Studio."
        right={
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("gravenx:model-studio"))}
            className="cursor-pointer rounded-full border border-ivory-950 bg-ivory-950 px-3 py-1.5 text-[11px] font-semibold text-ivory-100 hover:bg-ivory-800"
          >
            Open Model Studio
          </button>
        }
      >
        <ul className="space-y-1.5">
          {PROVIDER_PRESETS.map((p) => {
            const on = keyed.includes(p.id);
            return (
              <li key={p.id} className="flex items-center gap-2 text-xs">
                <span className={`h-2 w-2 shrink-0 rounded-full ${on ? "bg-[#2F5D3A]" : "bg-ivory-300"}`} aria-hidden="true" />
                <span className="font-semibold text-ivory-950">{p.label}</span>
                <span className="font-mono text-[10px] text-ivory-500">{on ? "key saved" : "no key"}</span>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card title="AI usage" hint="Token totals across every saved session in this browser.">
        {!usage || usage.sessions === 0 ? (
          <p className="text-xs text-ivory-600">No saved sessions yet - ask the agent something first.</p>
        ) : (
          <>
            <p className="text-xs text-ivory-800">
              <span className="font-bold text-ivory-950">{usage.sessions}</span> sessions ·{" "}
              <span className="font-mono">{usage.totalIn.toLocaleString()}</span> in /{" "}
              <span className="font-mono">{usage.totalOut.toLocaleString()}</span> out
            </p>
            <ul className="mt-2 space-y-1">
              {usage.byModel.map((m) => (
                <li key={m.key} className="flex items-center gap-2 rounded-lg border border-[var(--color-line-soft)] px-2 py-1 text-xs">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ivory-800">{m.key}</span>
                  <span className="shrink-0 font-mono text-[10px] text-ivory-600">
                    {m.sessions} chats · {m.totalIn.toLocaleString()}/{m.totalOut.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
      <Card
        title="Recent orgs"
        hint="Org keys from saved sessions - hosts only, never tokens. Reconnect from the Studio home."
      >
        {!orgs || orgs.length === 0 ? (
          <p className="text-xs text-ivory-600">No sessions yet - connect an org and chat first.</p>
        ) : (
          <ul className="space-y-1">
            {orgs.map((o) => (
              <li key={o.key} className="flex items-center gap-2 rounded-lg border border-[var(--color-line-soft)] px-2 py-1.5 text-xs">
                {o.live ? (
                  <span className="shrink-0 rounded-full bg-[#2F5D3A] px-1.5 py-px text-[9px] font-bold text-white">LIVE</span>
                ) : (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-ivory-300" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ivory-950">{o.key}</span>
                <span className="shrink-0 font-mono text-[10px] text-ivory-600">
                  {o.sessions} chats · {new Date(o.lastActive).toLocaleDateString()}
                </span>
                <Link href="/" title="Open the Studio home to connect" className="shrink-0 font-semibold text-bronze-700 underline decoration-bronze-300 underline-offset-2 hover:text-bronze-800">
                  Connect
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function WorkspacePanel() {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmImport, setConfirmImport] = useState<unknown | null>(null);
  const [armClear, setArmClear] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const out: Record<string, number> = {};
    await Promise.all(
      Object.values(STORES).map(async (name) => {
        try {
          const rows = await withStore<unknown[]>(name, "readonly", (s) => s.getAll());
          out[name] = rows.length;
        } catch {
          out[name] = -1;
        }
      })
    );
    setCounts(out);
  };
  useEffect(() => {
    void refresh();
  }, []);

  const onExport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const stores: Record<string, unknown[]> = {};
      for (const name of Object.values(STORES)) {
        try {
          stores[name] = await withStore<unknown[]>(name, "readonly", (s) => s.getAll());
        } catch {
          stores[name] = [];
        }
      }
      let policy: unknown = null;
      try {
        policy = getPolicy();
      } catch {
        /* ignore */
      }
      const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), stores, policy }, null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `gravenx-workspace-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMessage("Workspace exported - keep the file; import restores every store.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    try {
      const parsed = JSON.parse(await file.text()) as { stores?: Record<string, unknown[]>; policy?: unknown };
      if (!parsed || typeof parsed !== "object" || !parsed.stores || typeof parsed.stores !== "object") {
        setMessage("That file is not a GRAVENX workspace export.");
        return;
      }
      setConfirmImport(parsed);
    } catch {
      setMessage("Could not read that file as JSON.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doImport = async () => {
    const parsed = confirmImport as { stores: Record<string, { id?: unknown }[]>; policy?: unknown };
    setConfirmImport(null);
    setBusy(true);
    try {
      for (const [name, rows] of Object.entries(parsed.stores)) {
        if (!(Object.values(STORES) as string[]).includes(name) || !Array.isArray(rows)) continue;
        const store = name as (typeof STORES)[keyof typeof STORES];
        await withStore(store, "readwrite", (s) => s.clear());
        for (const row of rows) {
          if (!row || typeof row !== "object" || (row as { id?: unknown }).id === undefined) continue;
          await withStore(store, "readwrite", (s) => s.put(row));
        }
      }
      if (parsed.policy && typeof parsed.policy === "object") {
        try {
          savePolicy(parsed.policy as never);
        } catch {
          /* policy import is best-effort */
        }
      }
      await refresh();
      setMessage("Workspace restored from file.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card
        title="Local data"
        hint="Everything lives in this browser's IndexedDB - canvases, runs, history, wireframes. Counts refresh on open."
        right={
          <button
            type="button"
            onClick={() => void refresh()}
            className="cursor-pointer rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950"
          >
            Refresh
          </button>
        }
      >
        {!counts ? (
          <p className="text-xs text-ivory-600">Reading stores…</p>
        ) : (
          <ul className="grid gap-1 text-xs sm:grid-cols-2">
            {Object.entries(counts)
              .sort((a, b) => b[1] - a[1])
              .map(([name, n]) => (
                <li key={name} className="flex items-center gap-2 rounded-lg border border-[var(--color-line-soft)] px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ivory-800">{name}</span>
                  <span className="font-mono text-[11px] font-bold text-ivory-950">{n < 0 ? "n/a" : n}</span>
                  {n > 0 ? (
                    armClear === name ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            const storeName = name as (typeof STORES)[keyof typeof STORES];
                            void (async () => {
                              try {
                                await withStore(storeName, "readwrite", (s) => s.clear());
                              } catch {
                                /* count refresh reports the truth */
                              }
                              setArmClear(null);
                              await refresh();
                            })();
                          }}
                          title={`Wipe every record in ${name}`}
                          className="cursor-pointer rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-red-800"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setArmClear(null)}
                          className="cursor-pointer rounded bg-ivory-200 px-1.5 py-0.5 text-[10px] font-bold text-ivory-700 hover:text-ivory-950"
                        >
                          No
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setArmClear(name)}
                        title={`Clear ${name}`}
                        className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[10px] font-semibold text-red-700 hover:bg-red-50"
                      >
                        Clear
                      </button>
                    )
                  ) : null}
                </li>
              ))}
          </ul>
        )}
      </Card>
      <Card title="Export / import" hint="One file carries every store plus the agent policy. Import replaces matching stores.">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onExport()}
            disabled={busy}
            className="cursor-pointer rounded-full border border-ivory-950 bg-ivory-950 px-3 py-1.5 text-[11px] font-semibold text-ivory-100 hover:bg-ivory-800 disabled:opacity-50"
          >
            {busy ? "Working…" : "Export workspace"}
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="cursor-pointer rounded-full border border-[var(--color-line)] px-3 py-1.5 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950 disabled:opacity-50"
          >
            Import workspace…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            aria-label="Workspace export file"
            onChange={(e) => void onPickFile(e.target.files?.[0])}
          />
        </div>
        {message ? <p className="mt-2 text-xs text-ivory-700">{message}</p> : null}
        {confirmImport ? (
          <div className="mt-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2.5">
            <p className="text-xs font-semibold text-red-800">Replace this workspace with the file&apos;s contents?</p>
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                onClick={() => void doImport()}
                disabled={busy}
                className="cursor-pointer rounded-full bg-red-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              >
                {busy ? "Restoring…" : "Replace everything"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmImport(null)}
                className="cursor-pointer rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

export function CompliancePanel() {
  const [banner, setBanner] = useState<string | null>(null);
  const resetBanner = () => {
    try {
      window.localStorage.removeItem("sf-privacy-ack");
      setBanner("Banner will show again on the next home visit.");
    } catch {
      setBanner("Storage unavailable in this browser.");
    }
  };
  return (
    <div className="space-y-3">
      <Card title="Privacy posture" hint="GDPR-ready: essential storage only, no tracking, no ad cookies.">
        <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-ivory-800">
          <li>Salesforce token lives in this tab&apos;s session memory - proxied server-side, never written to disk.</li>
          <li>AI keys live in this browser&apos;s vault - forwarded per request, never stored server-side, never logged.</li>
          <li>Canvases, runs, history and the agent policy live in this browser (IndexedDB + localStorage).</li>
          <li>Connecting or running AI never sends your org data anywhere except the model provider you chose.</li>
        </ul>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Link href="/privacy" className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950">
            Privacy Policy
          </Link>
          <Link href="/terms" className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950">
            Terms
          </Link>
          <Link href="/security" className="rounded-full border border-[var(--color-line)] px-3 py-1.5 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950">
            Security
          </Link>
          <button
            type="button"
            onClick={resetBanner}
            title="Clear the dismissal flag so the home banner shows again"
            className="cursor-pointer rounded-full border border-[var(--color-line)] px-3 py-1.5 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950"
          >
            Show banner again
          </button>
        </div>
        {banner ? <p className="mt-2 text-xs text-ivory-700">{banner}</p> : null}
      </Card>
    </div>
  );
}

export function AboutPanel() {
  const [usage, setUsage] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  useEffect(() => {
    try {
      if (navigator.storage?.estimate) {
        void navigator.storage.estimate().then((e) => {
          const mb = (v?: number) => (typeof v === "number" ? `${(v / 1048576).toFixed(1)} MB` : "unknown");
          setUsage(`${mb(e.usage)} of ${mb(e.quota)}`);
        });
      }
    } catch {
      /* ignore */
    }
  }, []);

  const wipe = () => {
    try {
      window.localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    try {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => window.location.reload();
      req.onerror = () => window.location.reload();
    } catch {
      window.location.reload();
    }
  };

  return (
    <div className="space-y-3">
      <Card title="GRAVENX" hint="Architecture engineering studio - designed by an architect, for architects.">
        <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
          {(
            [
              ["App", `${APP_NAME} ${APP_VERSION}`],
              ["Next.js", "15.x (OpenNext Cloudflare worker)"],
              ["Browser storage", usage ?? "measuring…"],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="shrink-0 font-semibold text-ivory-600">{k}</dt>
              <dd className="min-w-0 truncate font-mono text-[11px] text-ivory-950">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title="Danger zone" hint="Irreversible. Export a workspace backup first if anything matters.">
        {!confirmWipe ? (
          <button
            type="button"
            onClick={() => setConfirmWipe(true)}
            className="cursor-pointer rounded-full border border-red-400 px-3 py-1.5 text-[11px] font-semibold text-red-700 hover:bg-red-50"
          >
            Clear all local data…
          </button>
        ) : (
          <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2.5">
            <p className="text-xs font-semibold text-red-800">Wipe every store, key, flag and the agent policy in this browser?</p>
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                onClick={wipe}
                className="cursor-pointer rounded-full bg-red-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-800"
              >
                Wipe everything
              </button>
              <button
                type="button"
                onClick={() => setConfirmWipe(false)}
                className="cursor-pointer rounded-full border border-[var(--color-line)] bg-white px-3 py-1.5 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

export function PreferencesPanel() {
  const [prefs, setPrefs] = useState<Preferences>(() => getPreferences());
  const [note, setNote] = useState<string | null>(null);
  const update = (fn: (p: Preferences) => void) => {
    setPrefs((prev) => {
      const next = { ...prev };
      fn(next);
      return savePreferences(next);
    });
  };
  return (
    <div className="space-y-3">
      <Card title="Defaults" hint="Applies to new connections and newly opened panels - already-open tabs keep their values.">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-ivory-800">Default API version</span>
            <input
              key={prefs.defaultApiVersion}
              defaultValue={prefs.defaultApiVersion}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (/^v\d+\.0$/.test(v)) {
                  update((p) => {
                    p.defaultApiVersion = v;
                  });
                  setNote(null);
                } else {
                  e.target.value = prefs.defaultApiVersion;
                  setNote("API version must look like v66.0 - kept the previous value.");
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              spellCheck={false}
              autoComplete="off"
              placeholder="v66.0"
              aria-label="Default API version"
              className="mt-1 h-8 w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 font-mono text-xs text-ivory-950 focus:border-bronze-500 focus:outline-none"
            />
            <span className="mt-0.5 block text-[10px] text-ivory-500">Deploy-time env override still wins when set.</span>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ivory-800">ERD hides system objects</span>
            <span className="mt-1 flex h-8 items-center gap-2">
              <input
                type="checkbox"
                checked={prefs.erdHideSystem}
                onChange={(e) => update((p) => {
                  p.erdHideSystem = e.target.checked;
                })}
                className="h-4 w-4 accent-[#722F37]"
              />
              <span className="text-[11px] text-ivory-600">System sweep on fresh canvases</span>
            </span>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ivory-800">Apex default log category</span>
            <select
              value={prefs.apexLogCategory}
              onChange={(e) => update((p) => {
                p.apexLogCategory = e.target.value;
              })}
              aria-label="Apex default log category"
              className="mt-1 h-8 w-full cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-2 text-xs text-ivory-950 focus:border-bronze-500 focus:outline-none"
            >
              {LOG_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ivory-800">Apex default log level</span>
            <select
              value={prefs.apexLogLevel}
              onChange={(e) => update((p) => {
                p.apexLogLevel = e.target.value;
              })}
              aria-label="Apex default log level"
              className="mt-1 h-8 w-full cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-2 text-xs text-ivory-950 focus:border-bronze-500 focus:outline-none"
            >
              {LOG_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setPrefs(resetPreferences());
              setNote("Preferences reset to code defaults.");
            }}
            className="cursor-pointer rounded-full border border-[var(--color-line)] px-3 py-1.5 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950"
          >
            Reset preferences
          </button>
          {note ? <span className="text-xs text-ivory-700">{note}</span> : null}
        </div>
      </Card>
    </div>
  );
}

const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Everywhere",
    items: [
      ["Ctrl / ⌘ + K", "Command palette"],
      ["Enter", "Confirm dialogs and submit forms"],
      ["Esc", "Close dialogs, popups and pickers"],
    ],
  },
  {
    title: "Ask AI",
    items: [
      ["Enter", "Send message"],
      ["Shift + Enter", "New line"],
    ],
  },
  {
    title: "ERD canvas",
    items: [
      ["T", "Tag the focused table"],
      ["X", "Remove the focused table (asks first)"],
      ["Esc", "Close tag surfaces, exit laser"],
    ],
  },
  {
    title: "Connect",
    items: [
      ["Enter", "Test & connect"],
      ["Esc", "Close without connecting"],
    ],
  },
];

export function ShortcutsPanel() {
  return (
    <div className="space-y-3">
      {SHORTCUT_GROUPS.map((g) => (
        <div key={g.title} className="arch-card overflow-hidden">
          <div className="arch-card__head px-4 py-2.5">
            <p className="text-sm font-bold text-ivory-950">{g.title}</p>
          </div>
          <ul className="divide-y divide-[var(--color-line-soft)]">
            {g.items.map(([keys, what]) => (
              <li key={keys + what} className="flex items-center gap-3 px-4 py-2">
                <kbd className="shrink-0 rounded-md border border-[var(--color-line)] bg-white px-2 py-1 font-mono text-[11px] font-bold text-ivory-950">
                  {keys}
                </kbd>
                <span className="text-xs text-ivory-800">{what}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

interface DiagResult {
  ok: boolean | null;
  detail: string;
}

export function DiagnosticsPanel() {
  const [results, setResults] = useState<Record<string, DiagResult>>({});
  const [running, setRunning] = useState(false);

  const runAll = async () => {
    setRunning(true);
    setResults({});
    const set = (id: string, r: DiagResult) => setResults((prev) => ({ ...prev, [id]: r }));
    try {
      localStorage.setItem("__gx_diag", "1");
      localStorage.removeItem("__gx_diag");
      set("storage", { ok: true, detail: "read + write ok" });
    } catch {
      set("storage", { ok: false, detail: "blocked (private mode?)" });
    }
    try {
      const version: number = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME);
        req.onsuccess = () => {
          const v = req.result.version;
          req.result.close();
          resolve(v);
        };
        req.onerror = () => reject(req.error);
      });
      set("idb", version === DB_VERSION ? { ok: true, detail: `open at v${version}` } : { ok: false, detail: `open at v${version}, expected v${DB_VERSION} - reload` });
    } catch {
      set("idb", { ok: false, detail: "could not open" });
    }
    try {
      const p = getPolicy();
      set("policy", p.version === 1 ? { ok: true, detail: `v1, ${Object.keys(p.skills).length} skills` } : { ok: false, detail: "unknown version" });
    } catch {
      set("policy", { ok: false, detail: "unreadable" });
    }
    let live: ReturnType<typeof readLiveSession> = null;
    try {
      live = readLiveSession();
    } catch {
      live = null;
    }
    if (live) {
      let host = live.instanceUrl;
      try {
        host = new URL(live.instanceUrl).hostname;
      } catch {
        /* keep raw */
      }
      set("session", { ok: isSalesforceConnected(), detail: `${host} · ${live.apiVersion}` });
    } else {
      set("session", { ok: false, detail: "not connected" });
    }
    if (!live) {
      set("api", { ok: null, detail: "needs a connection" });
    } else {
      try {
        const res = await apiFetch("/api/salesforce/versions", { instanceUrl: live.instanceUrl, token: live.token }, 15000);
        set("api", res.ok ? { ok: true, detail: `reachable (HTTP ${res.status})` } : { ok: false, detail: `HTTP ${res.status}` });
      } catch (e) {
        set("api", { ok: false, detail: e instanceof Error ? e.message : "failed" });
      }
    }
    try {
      const est = await navigator.storage?.estimate();
      const mb = (v?: number) => (typeof v === "number" ? `${(v / 1048576).toFixed(1)} MB` : "unknown");
      set("quota", { ok: true, detail: `${mb(est?.usage)} of ${mb(est?.quota)}` });
    } catch {
      set("quota", { ok: null, detail: "unavailable in this browser" });
    }
    setRunning(false);
  };

  useEffect(() => {
    void runAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows: [string, string][] = [
    ["storage", "Browser storage writable"],
    ["idb", "IndexedDB opens at current version"],
    ["policy", "Agent policy loads"],
    ["session", "Salesforce session live"],
    ["api", "Salesforce API reachable"],
    ["quota", "Storage quota"],
  ];
  return (
    <div className="arch-card overflow-hidden">
      <div className="arch-card__head flex items-center gap-2 px-4 py-2.5">
        <p className="min-w-0 flex-1 text-sm font-bold text-ivory-950">Health checks</p>
        <button
          type="button"
          onClick={() => void runAll()}
          disabled={running}
          className="cursor-pointer rounded-full border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950 disabled:opacity-50"
        >
          {running ? "Running…" : "Run again"}
        </button>
      </div>
      <ul className="divide-y divide-[var(--color-line-soft)]">
        {rows.map(([id, label]) => {
          const r = results[id];
          return (
            <li key={id} className="flex items-center gap-2.5 px-4 py-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${r ? (r.ok === true ? "bg-[#2F5D3A]" : r.ok === false ? "bg-red-600" : "bg-ivory-300") : "bg-ivory-200 animate-pulse"}`}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 text-xs font-semibold text-ivory-950">{label}</span>
              <span className="font-mono text-[10px] text-ivory-600">{r ? r.detail : "checking…"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
