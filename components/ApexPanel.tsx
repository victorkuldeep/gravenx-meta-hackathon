"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { isSessionExpiredMessage } from "@/lib/salesforce/client";
import { getPreferences } from "@/lib/setup/preferences";
import {
  LOG_CATEGORIES,
  LOG_LEVELS,
  apexHeaderLine,
  apexSummary,
  type ApexRunResult,
  type LogCategory,
  type LogLevel,
} from "@/lib/salesforce/apex";
import Button from "./ui/Button";

interface ApexPanelProps {
  instanceUrl: string;
  apiVersion: string;
  getToken: () => string;
  onSessionExpired?: () => void;
}

interface ApexHistoryEntry {
  id: number;
  at: number;
  preview: string;
  summary: string;
  ok: boolean;
}

const editorClass =
  "w-full rounded border border-ivory-400 bg-white px-3 py-2 font-mono text-xs text-ivory-950 placeholder-ivory-500 focus:border-bronze-500 focus:outline-none focus:ring-1 focus:ring-bronze-500 resize-y";

/**
 * Anonymous Apex runner, Workbench "Apex Execute" style: Log Category + Log
 * Level ride the SOAP DebuggingHeader and the debug log comes back inline -
 * no TraceFlag litter, no log polling.
 */
export function ApexPanel({ instanceUrl, apiVersion, getToken, onSessionExpired }: ApexPanelProps) {
  const [code, setCode] = useState("System.debug('Hello from GRAVENX');");
  const [logCategory, setLogCategory] = useState<LogCategory>(() => getPreferences().apexLogCategory as LogCategory);
  const [logLevel, setLogLevel] = useState<LogLevel>(() => getPreferences().apexLogLevel as LogLevel);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<ApexRunResult | null>(null);
  const [responseMs, setResponseMs] = useState<number | null>(null);
  const [history, setHistory] = useState<ApexHistoryEntry[]>([]);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const run = async () => {
    const token = getToken();
    if (!token) {
      setRunError("Session token unavailable. Please reconnect.");
      return;
    }
    if (!code.trim()) {
      setRunError("Write some Apex first.");
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setRunError(null);
    setResult(null);
    try {
      const response = await apiFetch(
        "/api/salesforce/apex",
        { instanceUrl, token, apiVersion, code, logCategory, logLevel },
        120000,
        ctrl.signal
      );
      const data = (await response.json()) as {
        ok?: boolean;
        result?: ApexRunResult;
        responseTime?: number;
        error?: string;
      };
      if (!response.ok || !data.ok || !data.result) {
        const message = typeof data.error === "string" ? data.error : "Request failed";
        setRunError(message);
        if (isSessionExpiredMessage(message)) onSessionExpired?.();
        return;
      }
      const parsed = data.result;
      setResult(parsed);
      setResponseMs(typeof data.responseTime === "number" ? data.responseTime : null);
      const firstLine = code.trim().split("\n")[0].slice(0, 80);
      setHistory((p) => [{ id: ++idRef.current, at: Date.now(), preview: firstLine, summary: apexSummary(parsed), ok: parsed.success }, ...p].slice(0, 20));
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const message = err instanceof Error ? err.message : "Run failed";
      setRunError(message);
      if (isSessionExpiredMessage(message)) onSessionExpired?.();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-[#27241F]">Anonymous Apex</h2>
            <p className="text-xs text-[#777168]">Execute Apex without deploying - Workbench-style logs with category + level.</p>
          </div>
          <span className="rounded border border-ivory-300 bg-ivory-100 px-1.5 py-0.5 font-mono text-[10px] text-ivory-600">
            POST /tooling via SOAP executeAnonymous
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-[#27241F]" htmlFor="apex-log-category">
            Log Category:
            <select
              id="apex-log-category"
              value={logCategory}
              onChange={(e) => setLogCategory(e.target.value as LogCategory)}
              disabled={running}
              className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] text-[#27241F] disabled:opacity-60"
            >
              {LOG_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-[#27241F]" htmlFor="apex-log-level">
            Log Level:
            <select
              id="apex-log-level"
              value={logLevel}
              onChange={(e) => setLogLevel(e.target.value as LogLevel)}
              disabled={running}
              className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] text-[#27241F] disabled:opacity-60"
            >
              {LOG_LEVELS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
        </div>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          rows={8}
          aria-label="Apex code"
          placeholder="System.debug('Hello');"
          className={`${editorClass} mt-2 min-h-[160px]`}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void run()} disabled={running} title="Run against the connected org">
            {running ? "Running…" : "Execute"}
          </Button>
          {running && (
            <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>
              Stop
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setCode("")} disabled={running} title="Clear the editor">
            Reset
          </Button>
          <span className="flex-1" />
          <span className="font-mono text-[11px] text-ivory-500">{code.length} chars</span>
        </div>
        {runError && (
          <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 whitespace-pre-wrap" role="alert">
            {runError}
          </div>
        )}
        {result && (
          <div className="mt-2">
            <h3 className="text-[13px] font-semibold text-[#27241F]">Results</h3>
            <div className={`mt-1 rounded-lg border px-3 py-2 ${result.success ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-sm font-bold ${result.success ? "text-green-700" : "text-red-700"}`}>
                  {result.success ? "Success" : result.compiled ? "Runtime exception" : "Compile failed"}
                </span>
                {responseMs !== null && <span className="text-xs text-ivory-600">{responseMs}ms</span>}
                {result.debugLog && (
                  <span className="flex-1" />
                )}
                {result.debugLog && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void navigator.clipboard.writeText(result.debugLog as string).catch(() => {});
                    }}
                    title="Copy the full log"
                  >
                    Copy log
                  </Button>
                )}
              </div>
              {!result.success && (
                <p className="mt-1 font-mono text-xs text-red-700">{apexSummary(result)}</p>
              )}
              {result.exceptionStackTrace && (
                <pre className="mt-1 max-h-[160px] overflow-auto font-mono text-[11px] text-red-700 whitespace-pre-wrap">{result.exceptionStackTrace}</pre>
              )}
            </div>
            <pre className="mt-2 max-h-[320px] overflow-auto rounded-lg border border-[#E8E2D8] bg-white px-3 py-2 font-mono text-[11px] text-[#27241F] whitespace-pre-wrap">
              {apexHeaderLine(apiVersion, logCategory, logLevel)}
              {"\n"}Execute Anonymous: {code.trim()}
              {result.debugLog ? `\n${result.debugLog}` : "\n(no debug log returned - raise the Log Level)"}
            </pre>
            {responseMs !== null && (
              <p className="mt-1 text-center text-[11px] text-ivory-500">
                Requested in {(responseMs / 1000).toFixed(3)} sec
              </p>
            )}
          </div>
        )}
      </div>
      {history.length > 0 && (
        <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-[#27241F]">This session</h3>
            <Button size="sm" variant="ghost" onClick={() => setHistory([])} title="Clear session history">
              Clear
            </Button>
          </div>
          <ul className="mt-2 space-y-1">
            {history.map((h) => (
              <li key={h.id} className="flex items-center gap-2 text-[12px]">
                <span className={`h-2 w-2 shrink-0 rounded-full ${h.ok ? "bg-green-500" : "bg-red-500"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-mono text-[#27241F]" title={h.preview}>
                  {h.preview || "(empty)"}
                </span>
                <span className="shrink-0 truncate text-[#777168]" title={h.summary}>{h.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
