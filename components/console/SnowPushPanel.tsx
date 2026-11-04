"use client";

import { useState } from "react";
import type { ConsoleTask } from "@/lib/console/model";
import {
  buildSnowRecord,
  createSnowRecord,
  normalizeSnowInstance,
  normalizeSnowTable,
  probeSnowTable,
  SNOW_TABLES,
  type SnowProbe,
} from "@/lib/pmo/snow";
import { clearSnowConnection, getSnowConnection, hasSnowCredentials, setSnowConnection } from "@/lib/pmo/snowVault";
import { getPmoDefaults, setPmoDefaults } from "@/lib/pmo/defaults";

/**
 * ServiceNow push: connect once per tab (instance + user + password,
 * session-only), pick a table - probed live so the architect sees it is
 * real - push the entry as a record. The record number comes back as a
 * backlink chip. Push-only, no status sync in V1.
 */

const CUSTOM = "__custom__";

const inputCls =
  "w-full rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[12px] text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none";

function initialTable(): string {
  const vault = getSnowConnection().table;
  if (vault && vault !== "incident") return SNOW_TABLES.some((t) => t.name === vault) ? vault : CUSTOM;
  const d = getPmoDefaults().snowTable;
  if (d && !SNOW_TABLES.some((t) => t.name === d)) return CUSTOM;
  return d || "incident";
}

export function SnowPushPanel({
  task,
  onPatch,
}: {
  task: ConsoleTask;
  onPatch: (patch: Partial<ConsoleTask>) => void;
}) {
  const [conn, setConn] = useState(() => {
    const v = getSnowConnection();
    const d = getPmoDefaults();
    return {
      instance: v.instance || d.snowInstance || "",
      user: v.user,
      pass: v.pass,
      table: v.table || d.snowTable || "incident",
    };
  });
  const [customTable, setCustomTable] = useState(() =>
    initialTable() === CUSTOM ? getSnowConnection().table || getPmoDefaults().snowTable || "" : "",
  );
  const [probe, setProbe] = useState<SnowProbe | null>(null);
  const [busy, setBusy] = useState<"probe" | "push" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const connected = hasSnowCredentials(conn);
  const table = conn.table === CUSTOM ? customTable.trim().toLowerCase() : conn.table;

  const update = (patch: Partial<typeof conn>) => setConn((c) => ({ ...c, ...patch }));

  const credsOf = (): { error: string } | { creds: { instance: string; user: string; pass: string } } => {
    const inst = normalizeSnowInstance(conn.instance);
    if (!inst.ok) return { error: inst.error };
    if (!conn.user.trim() || !conn.pass) return { error: "User and password are both required." };
    return { creds: { instance: inst.instance, user: conn.user.trim(), pass: conn.pass } };
  };

  const checkTable = async () => {
    setBusy("probe");
    setError(null);
    setDone(null);
    setProbe(null);
    const t = normalizeSnowTable(table);
    if (!t.ok) {
      setError(t.error);
      setBusy(null);
      return;
    }
    const r = credsOf();
    if ("error" in r) {
      setError(r.error);
      setBusy(null);
      return;
    }
    try {
      const p = await probeSnowTable(r.creds, t.table);
      setProbe(p);
      const kept = setSnowConnection({ instance: r.creds.instance, user: r.creds.user, pass: r.creds.pass, table: t.table });
      setConn({ instance: kept.instance, user: kept.user, pass: kept.pass, table: kept.table });
      setPmoDefaults({ provider: "snow", snowInstance: r.creds.instance, snowTable: t.table });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach ServiceNow.");
    } finally {
      setBusy(null);
    }
  };

  const push = async () => {
    if (!table) return;
    setBusy("push");
    setError(null);
    setDone(null);
    const t = normalizeSnowTable(table);
    if (!t.ok) {
      setError(t.error);
      setBusy(null);
      return;
    }
    const r = credsOf();
    if ("error" in r) {
      setError(r.error);
      setBusy(null);
      return;
    }
    try {
      const ref = await createSnowRecord(r.creds, t.table, buildSnowRecord(task));
      const at = Date.now();
      onPatch({
        pmo: { system: "snow", key: ref.number, url: ref.url, at },
        history: [...task.history, { at, what: `Pushed to ServiceNow as ${ref.number}.` }].slice(-500),
      });
      setPmoDefaults({ provider: "snow", snowInstance: r.creds.instance, snowTable: t.table });
      setDone(`Created ${ref.number} in ${t.table}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Push failed.");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = () => {
    clearSnowConnection();
    const d = getPmoDefaults();
    setConn({ instance: d.snowInstance || "", user: "", pass: "", table: d.snowTable || "incident" });
    setProbe(null);
    setError(null);
    setDone(null);
  };

  const snowBacklink = task.pmo?.system === "snow" ? task.pmo : null;

  return (
    <div className="mt-1.5 rounded-xl border border-[#E8E2D8] bg-[#FBFAF7] p-2.5">
      {snowBacklink && (
        <p className="mb-1.5 text-[12px] text-[#777168]">
          Pushed as{" "}
          <a href={snowBacklink.url} target="_blank" rel="noreferrer" className="font-semibold text-[#8A6A2F] hover:underline">
            {snowBacklink.key} ↗
          </a>{" "}
          · pushing again creates a new record.
        </p>
      )}
      {!connected ? (
        <div className="space-y-1.5">
          <p className="text-[12px] leading-relaxed text-[#777168]">
            Connect with instance + user + password (session-only, never stored). Tables probe live before pushing.
          </p>
          <input
            value={conn.instance}
            onChange={(e) => update({ instance: e.target.value })}
            placeholder="acme.service-now.com"
            spellCheck={false}
            autoComplete="off"
            aria-label="ServiceNow instance"
            className={inputCls}
          />
          <div className="flex gap-1.5">
            <input
              value={conn.user}
              onChange={(e) => update({ user: e.target.value })}
              placeholder="user"
              spellCheck={false}
              autoComplete="off"
              aria-label="ServiceNow user"
              className={inputCls}
            />
            <input
              value={conn.pass}
              onChange={(e) => update({ pass: e.target.value })}
              placeholder="Password"
              type="password"
              autoComplete="off"
              aria-label="ServiceNow password"
              className={inputCls}
            />
          </div>
          <button
            type="button"
            onClick={() => void checkTable()}
            className="cursor-pointer rounded-lg bg-[#27241F] px-2.5 py-1.5 text-xs font-semibold text-[#F5F1E8] hover:bg-[#3A352D]"
          >
            Connect & check table
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#777168]">{conn.instance}</span>
            <button type="button" onClick={disconnect} className="cursor-pointer text-[11px] text-[#A39B8E] hover:text-red-700 hover:underline">
              Disconnect
            </button>
          </div>
          <div className="flex gap-1.5">
            <label className="flex-1">
              <span className="mb-0.5 block font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Table</span>
              <select
                value={SNOW_TABLES.some((t) => t.name === conn.table) ? conn.table : CUSTOM}
                onChange={(e) => update({ table: e.target.value })}
                aria-label="ServiceNow table"
                className="w-full cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] font-semibold text-[#27241F] focus:border-[#C9A86A] focus:outline-none"
              >
                {SNOW_TABLES.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.label} ({t.name})
                  </option>
                ))}
                <option value={CUSTOM}>Custom…</option>
              </select>
            </label>
            {conn.table === CUSTOM && (
              <label className="flex-1">
                <span className="mb-0.5 block font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Custom table</span>
                <input
                  value={customTable}
                  onChange={(e) => setCustomTable(e.target.value)}
                  placeholder="sn_customerservice_case"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="Custom table name"
                  className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 font-mono text-[12px] text-[#27241F] focus:border-[#C9A86A] focus:outline-none"
                />
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={busy !== null || !table}
              onClick={() => void checkTable()}
              className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#27241F] hover:border-[#C9A86A] disabled:cursor-default disabled:opacity-40"
            >
              {busy === "probe" ? "Checking…" : "Check table"}
            </button>
            <button
              type="button"
              disabled={busy !== null || !table}
              onClick={() => void push()}
              className="cursor-pointer rounded-lg bg-[#27241F] px-2.5 py-1.5 text-xs font-semibold text-[#F5F1E8] hover:bg-[#3A352D] disabled:cursor-default disabled:opacity-40"
            >
              {busy === "push" ? "Pushing…" : snowBacklink ? "Push as new record" : `Push to ${table || "…"}`}
            </button>
          </div>
          {probe && (
            <p className="text-[11px] text-[#777168]">
              <span className="font-semibold text-[#3E6B34]">{probe.table}</span> exists
              {probe.sampleFields.length > 0 ? ` - e.g. ${probe.sampleFields.slice(0, 6).join(", ")}` : " (empty table, nothing to sample)"}.
            </p>
          )}
          <p className="text-[11px] text-[#A39B8E]">
            Pushes the title + saved description as short description / description. Save the description first if you just edited it.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1.5 rounded-lg border border-[#E5AFAF] bg-[#F9E9E9] px-2.5 py-1.5 text-[12px] text-[#A02C2C]">
          {error}
        </p>
      )}
      {done && <p className="mt-1.5 text-[12px] font-semibold text-[#3E6B34]">{done}</p>}
    </div>
  );
}
