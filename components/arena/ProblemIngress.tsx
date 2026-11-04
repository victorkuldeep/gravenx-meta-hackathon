"use client";

import Link from "next/link";
import { useState } from "react";
import { addRound, listSessions, newSession, saveSession } from "@/lib/arena/session";
import { fetchJiraIssue, normalizeJiraKey, type JiraIssueDetail } from "@/lib/pmo/jira";
import { getPmoConnection, hasPmoCredentials } from "@/lib/pmo/jiraVault";
import { fetchSnowRecord, SNOW_TABLES, type SnowRecordDetail } from "@/lib/pmo/snow";
import { getSnowConnection, hasSnowCredentials } from "@/lib/pmo/snowVault";

const inputCls =
  "w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[12px] placeholder:text-ivory-400";

type Source = "type" | "jira" | "snow";

/**
 * Arena frontdoor: the architect throws a problem in - typed raw, or pulled
 * live from a Jira ticket / ServiceNow record - and it lands as a session
 * with the ticket text as round zero. No retyping, no context loss.
 */
export function ProblemIngress({ onStarted }: { onStarted: (id: string) => void }) {
  const [source, setSource] = useState<Source>("type");
  const [typed, setTyped] = useState("");
  const [key, setKey] = useState("");
  const [table, setTable] = useState("incident");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jira, setJira] = useState<JiraIssueDetail | null>(null);
  const [snow, setSnow] = useState<SnowRecordDetail | null>(null);

  const startFrom = async (title: string, problem: string, jiraRef: string) => {
    setBusy(true);
    try {
      let s = newSession(title);
      s = { ...s, problem, jiraRef };
      s = addRound(s, "problem", problem);
      await saveSession(s);
      onStarted(s.id);
      setTyped("");
      setJira(null);
      setSnow(null);
      setError(null);
    } finally {
      setBusy(false);
      await listSessions().catch(() => []);
    }
  };

  const fetchTicket = async () => {
    const k = normalizeJiraKey(key);
    if (!k.ok) {
      setError(k.error);
      return;
    }
    if (!hasPmoCredentials()) {
      setError("Jira is not connected - set it up in Setup → Delivery first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const c = getPmoConnection();
      setJira(await fetchJiraIssue({ site: c.site, email: c.email, token: c.token }, k.key));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ticket read failed.");
    } finally {
      setBusy(false);
    }
  };

  const fetchRecord = async () => {
    if (!number.trim()) {
      setError("Enter a record number, e.g. INC0001234.");
      return;
    }
    if (!hasSnowCredentials()) {
      setError("ServiceNow is not connected - set it up in Setup → Delivery first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const c = getSnowConnection();
      setSnow(await fetchSnowRecord({ instance: c.instance, user: c.user, pass: c.pass }, table.trim() || "incident", number.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Record read failed.");
    } finally {
      setBusy(false);
    }
  };

  const jiraProblem = (d: JiraIssueDetail): string =>
    [
      `${d.key} · ${d.summary} (${d.issueType}${d.status ? ` · ${d.status}` : ""}${d.priority ? ` · ${d.priority}` : ""})`,
      ``,
      d.description || "(no description on the ticket)",
      ...(d.recentComments.length > 0 ? [``, `Latest comments:`, ...d.recentComments.map((c) => `- ${c}`)] : []),
    ].join("\n");

  const snowProblem = (d: SnowRecordDetail): string =>
    [
      `${d.number} · ${d.shortDescription || "(no short description)"} [${d.table}${d.state ? ` · ${d.state}` : ""}${d.assignedTo ? ` · ${d.assignedTo}` : ""}]`,
      ``,
      d.description || "(no description on the record)",
    ].join("\n");

  return (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <h3 className="text-[13px] font-bold text-ivory-950">Throw a problem into the Arena</h3>
      <p className="text-[11px] text-ivory-500">Type it raw, or pull it live - the ticket becomes round zero, nothing retyped.</p>
      <div className="mt-2 flex gap-1.5">
        {(["type", "jira", "snow"] as Source[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setSource(s);
              setError(null);
            }}
            className={`cursor-pointer rounded-lg px-3 py-1.5 text-[12px] font-bold ${
              source === s ? "bg-ivory-950 text-ivory-100" : "border border-[var(--color-line)] bg-white hover:bg-ivory-50"
            }`}
          >
            {s === "type" ? "Type it" : s === "jira" ? "Jira ticket" : "ServiceNow"}
          </button>
        ))}
      </div>

      {source === "type" && (
        <div className="mt-2 space-y-2">
          <textarea
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="The problem as the architect heard it - symptoms, systems, what has been tried…"
            rows={4}
            className="w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[13px]"
          />
          <button
            type="button"
            disabled={!typed.trim() || busy}
            onClick={() => void startFrom(typed.trim().split("\n")[0].slice(0, 80) || "Untitled session", typed.trim(), "")}
            className="cursor-pointer rounded-lg bg-ivory-950 px-3 py-1.5 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800 disabled:opacity-50"
          >
            Start session
          </button>
        </div>
      )}

      {source === "jira" && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-1.5">
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void fetchTicket();
              }}
              placeholder="PROJ-4821"
              spellCheck={false}
              autoComplete="off"
              className={`${inputCls} font-mono`}
              aria-label="Jira ticket key"
            />
            <button
              type="button"
              onClick={() => void fetchTicket()}
              disabled={busy}
              className="shrink-0 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-[12px] font-semibold hover:bg-ivory-50 disabled:opacity-50"
            >
              {busy ? "Reading…" : "Fetch"}
            </button>
          </div>
          {!hasPmoCredentials() && (
            <p className="text-[12px] text-amber-700">
              Jira is not connected. <Link href="/setup" className="font-bold underline">Set it up in Setup → Delivery</Link>, then come back.
            </p>
          )}
          {jira && (
            <div className="rounded-lg border border-[var(--color-line)] bg-white p-2.5">
              <p className="text-[13px] font-bold text-ivory-950">
                {jira.key} · {jira.summary || "(no summary)"}
              </p>
              <p className="mt-0.5 text-[11px] text-ivory-500">
                {[jira.issueType, jira.status, jira.priority].filter(Boolean).join(" · ")}
                {jira.commentCount > 0 ? ` · ${jira.commentCount} comment${jira.commentCount === 1 ? "" : "s"}` : ""}
              </p>
              {jira.description && <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[12px] text-ivory-700">{jira.description}</p>}
              <button
                type="button"
                onClick={() => void startFrom(`${jira.key} ${jira.summary}`, jiraProblem(jira), jira.key)}
                disabled={busy}
                className="mt-2 cursor-pointer rounded-lg bg-emerald-700 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                Start session from ticket
              </button>
            </div>
          )}
        </div>
      )}

      {source === "snow" && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-1.5">
            <input
              value={table}
              onChange={(e) => setTable(e.target.value)}
              placeholder="incident"
              list="arena-snow-tables"
              spellCheck={false}
              autoComplete="off"
              className={`${inputCls} max-w-40 font-mono`}
              aria-label="ServiceNow table"
            />
            <datalist id="arena-snow-tables">
              {SNOW_TABLES.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.label}
                </option>
              ))}
            </datalist>
            <input
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void fetchRecord();
              }}
              placeholder="INC0001234"
              spellCheck={false}
              autoComplete="off"
              className={`${inputCls} font-mono`}
              aria-label="Record number"
            />
            <button
              type="button"
              onClick={() => void fetchRecord()}
              disabled={busy}
              className="shrink-0 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-[12px] font-semibold hover:bg-ivory-50 disabled:opacity-50"
            >
              {busy ? "Reading…" : "Fetch"}
            </button>
          </div>
          {!hasSnowCredentials() && (
            <p className="text-[12px] text-amber-700">
              ServiceNow is not connected. <Link href="/setup" className="font-bold underline">Set it up in Setup → Delivery</Link>, then come back.
            </p>
          )}
          {snow && (
            <div className="rounded-lg border border-[var(--color-line)] bg-white p-2.5">
              <p className="text-[13px] font-bold text-ivory-950">
                {snow.number} · {snow.shortDescription || "(no short description)"}
              </p>
              <p className="mt-0.5 text-[11px] text-ivory-500">
                {[snow.table, snow.state, snow.assignedTo].filter(Boolean).join(" · ")}
              </p>
              {snow.description && <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[12px] text-ivory-700">{snow.description}</p>}
              <button
                type="button"
                onClick={() => void startFrom(`${snow.number} ${snow.shortDescription}`, snowProblem(snow), "")}
                disabled={busy}
                className="mt-2 cursor-pointer rounded-lg bg-emerald-700 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                Start session from record
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-[12px] text-red-700">{error}</p>}
    </div>
  );
}
