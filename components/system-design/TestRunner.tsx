"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Button from "../ui/Button";
import Input from "../ui/Input";
import { preflightRun, redactHeaders, type PreflightVerdict } from "@/lib/system-design/runner";
import { findEnvRefs, findMissingVars, resolveEnvVars, scrubSecrets, type CredVault } from "@/lib/system-design/credentials";
import { buildSendHeaders, authTokenPrefill } from "@/lib/system-design/headers";
import { buildMockResult, sleep } from "@/lib/system-design/mock";
import { saveSystemRun, listSystemRuns, deleteSystemRun, type SystemRunRecord } from "@/lib/system-design/runStore";
import { newId, resolveSystemBaseUrl, type SystemEnvironment, type SystemOperation, type SystemNode, type SystemInterface } from "@/lib/system-design/model";

interface HeaderRow {
  key: string;
  value: string;
}

export function TestRunner({
  operation,
  iface,
  system,
  environments,
  activeEnvironmentId,
  vault = {},
  onClose,
}: {
  operation: SystemOperation;
  iface: SystemInterface;
  system: SystemNode;
  environments: SystemEnvironment[];
  activeEnvironmentId: string | null;
  vault?: CredVault;
  onClose: () => void;
}) {
  const activeEnv = environments.find((e) => e.id === activeEnvironmentId) ?? environments[0] ?? null;
  const [envId, setEnvId] = useState<string>(activeEnv?.id ?? "");
  const [baseUrl, setBaseUrl] = useState(() => resolveSystemBaseUrl([system], activeEnv, system.id));
  const [token, setToken] = useState(() => authTokenPrefill(operation.headers));
  const [method, setMethod] = useState<"GET" | "POST" | "PUT" | "PATCH" | "DELETE">(
    ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(operation.method) ? operation.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" : "GET"
  );
  const [path, setPath] = useState(operation.path);
  const [headers, setHeaders] = useState<HeaderRow[]>(() =>
    operation.headers?.length
      ? operation.headers.map((h) => ({ key: h.key, value: h.value }))
      : [{ key: "Content-Type", value: "application/json" }]
  );
  const [body, setBody] = useState(() => operation.sampleBody ?? "{}");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<null | {
    status: number;
    statusText: string;
    durationMs: number;
    endpoint: string;
    redirects: number;
    responseHeaders: Record<string, string>;
    responseBodyPreview: string;
    truncated: boolean;
  }>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SystemRunRecord[]>([]);

  useEffect(() => {
    void listSystemRuns(20).then(setHistory).catch(() => setHistory([]));
  }, []);

  const env = environments.find((e) => e.id === envId) ?? null;
  useEffect(() => {
    if (env) setBaseUrl(resolveSystemBaseUrl([system], env, system.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envId, system.id]);

  const allowHost = useMemo(() => {
    try {
      return new URL(baseUrl).hostname;
    } catch {
      return "";
    }
  }, [baseUrl]);

  const verdict: PreflightVerdict = useMemo(
    () =>
      preflightRun({
        baseUrl,
        path,
        method,
        allowHost,
        timeoutMs: 25000,
        bodyBytes: new TextEncoder().encode(body).length,
      }),
    [baseUrl, path, method, allowHost, body]
  );

  const mocked = !!operation.mock;
  const send = async () => {
    if ((!mocked && !verdict.ok) || sending) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      // Mock mode: canned response, zero network, saved to history like live.
      if (operation.mock) {
        const canned = buildMockResult(operation.mock);
        await sleep(canned.durationMs);
        const statusText = canned.statusText ? `${canned.statusText} (mock)` : "(mock)";
        setResult({
          status: canned.status,
          statusText,
          durationMs: canned.durationMs,
          endpoint: `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`,
          redirects: 0,
          responseHeaders: {},
          responseBodyPreview: canned.bodyPreview,
          truncated: false,
        });
        try {
          const record: SystemRunRecord = {
            id: newId("run"),
            createdAt: Date.now(),
            operationName: `${system.name} · ${operation.name} (mock)`,
            systemName: system.name,
            environmentName: env?.name ?? "(no environment)",
            method,
            endpoint: `${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`,
            status: canned.status,
            statusText,
            durationMs: canned.durationMs,
            truncated: false,
            requestHeaders: {},
            requestBodyPreview: method === "GET" ? "" : body.slice(0, 10000),
            responseHeaders: {},
            responseBodyPreview: canned.bodyPreview.slice(0, 10000),
          };
          await saveSystemRun(record);
          setHistory(await listSystemRuns(20));
        } catch {
          /* run display matters more than history persistence */
        }
        return;
      }
      // Stored op headers prefill the rows above - resolve $env at send.
      const built = buildSendHeaders(undefined, headers, vault);
      if (built.missing.length > 0) {
        throw new Error(
          `Missing session credentials: ${built.missing.map((m) => `$env.${m}`).join(", ")}. Add them under Credentials in the project bar.`
        );
      }
      const missing = findMissingVars([body, token], vault);
      if (missing.length > 0) {
        throw new Error(
          `Missing session credentials: ${missing.map((m) => `$env.${m}`).join(", ")}. Add them under Credentials in the project bar.`
        );
      }
      const resolvedBody = resolveEnvVars(method === "GET" ? "" : body, vault).text;
      const resolvedToken = resolveEnvVars(token, vault).text;
      const response = await fetch("/api/system/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: verdict.url,
          allowHost,
          method,
          headers: built.headers,
          body: resolvedBody,
          timeoutMs: 25000,
          authToken: resolvedToken || undefined,
        }),
      });
      const text = await response.text();
      let data: {
        success?: boolean;
        status?: number;
        statusText?: string;
        durationMs?: number;
        endpoint?: string;
        redirects?: number;
        requestHeaders?: Record<string, string>;
        requestBodyPreview?: string;
        responseHeaders?: Record<string, string>;
        responseBodyPreview?: string;
        truncated?: boolean;
        error?: string;
      };
      try {
        data = JSON.parse(text) as typeof data;
      } catch {
        throw new Error(
          response.ok
            ? "Execution backend returned an unreadable response."
            : `Execution backend failed (HTTP ${response.status})${text ? `: ${text.slice(0, 200)}` : "."}`
        );
      }
      if (!response.ok || data.error) {
        throw new Error(typeof data.error === "string" ? data.error : `Run failed (HTTP ${response.status}).`);
      }
      setResult({
        status: data.status ?? 0,
        statusText: data.statusText ?? "",
        durationMs: data.durationMs ?? 0,
        endpoint: data.endpoint ?? verdict.url,
        redirects: data.redirects ?? 0,
        responseHeaders: data.responseHeaders ?? {},
        responseBodyPreview: data.responseBodyPreview ?? "",
        truncated: !!data.truncated,
      });
      try {
        const record: SystemRunRecord = {
          id: newId("run"),
          createdAt: Date.now(),
          operationName: `${system.name} · ${operation.name}`,
          systemName: system.name,
          environmentName: env?.name ?? "(no environment)",
          method,
          endpoint: data.endpoint ?? verdict.url,
          status: data.status ?? 0,
          statusText: data.statusText ?? "",
          durationMs: data.durationMs ?? 0,
          truncated: !!data.truncated,
          // Vault secrets resolve at send time only - scrub before IDB history.
          requestHeaders: redactHeaders(data.requestHeaders ?? {}),
          requestBodyPreview: scrubSecrets(data.requestBodyPreview ?? "", vault).slice(0, 10000),
          responseHeaders: redactHeaders(data.responseHeaders ?? {}),
          responseBodyPreview: scrubSecrets(data.responseBodyPreview ?? "", vault).slice(0, 10000),
        };
        await saveSystemRun(record);
        setHistory(await listSystemRuns(20));
      } catch {
        /* run display matters more than history persistence */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Run failed.");
    } finally {
      setSending(false);
    }
  };

  const setHeader = (i: number, patch: Partial<HeaderRow>) => {
    setHeaders((prev) => prev.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  };

  // Postman-style reveal: masked by default, click the eye to inspect the
  // resolved value, auto-remasks after 10s. Same-tab eyes only.
  const [revealed, setRevealed] = useState<string | null>(null);
  const revealTimer = useRef<number | null>(null);
  useEffect(() => {
    const t = revealTimer.current;
    return () => {
      if (t !== null) window.clearTimeout(t);
    };
  }, []);
  const toggleReveal = (name: string) => {
    if (revealTimer.current !== null) window.clearTimeout(revealTimer.current);
    if (revealed === name) {
      setRevealed(null);
      revealTimer.current = null;
      return;
    }
    setRevealed(name);
    revealTimer.current = window.setTimeout(() => {
      setRevealed(null);
      revealTimer.current = null;
    }, 10000);
  };

  // Resolution proof: every $env ref across body/token/headers with its
  // vault status. Names and lengths only - values never render.
  const envStatus: { name: string; chars: number | null }[] = useMemo(() => {
    const names: string[] = [];
    for (const t of [body, token, ...headers.map((h) => h.value)]) {
      for (const n of findEnvRefs(t)) {
        if (!names.includes(n)) names.push(n);
      }
    }
    return names.map((n) => ({ name: n, chars: n in vault ? vault[n].length : null }));
  }, [body, token, headers, vault]);

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="runner-title" onClick={onClose}>
      <div
        className="modal-card max-w-3xl flex flex-col"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)] shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
              Test mode · {system.name} · {iface.name}
            </p>
            <h2 id="runner-title" className="mt-1 truncate text-lg font-bold text-ivory-950">
              {operation.method} {operation.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close test runner"
            className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Target */}
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
              Environment
              <select
                value={envId}
                onChange={(e) => setEnvId(e.target.value)}
                className="mt-0.5 w-full cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 text-xs font-semibold normal-case tracking-normal text-ivory-950"
              >
                <option value="">Custom base URL</option>
                {environments.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
              Base URL
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                spellCheck={false}
                placeholder="https://…"
                aria-label="Base URL"
                className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
              />
            </label>
          </div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
            Bearer token (memory only - never stored, never exported; $env.NAME works too)
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste a session/API token for this call only"
              autoComplete="off"
              spellCheck={false}
              className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
            />
          </label>

          {/* Request line */}
          <div className="flex gap-1.5">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as "GET" | "POST" | "PUT" | "PATCH" | "DELETE")}
              aria-label="Method"
              className="cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 font-mono text-xs font-bold text-ivory-950"
            >
              {(["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <Input
              placeholder="/path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              aria-label="Request path"
            />
          </div>

          {/* Mock mode */}
          {operation.mock && (
            <div className="rounded-xl border border-bronze-300 bg-bronze-100 px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-bronze-700">
                Mocked · serves HTTP {operation.mock.status} after {operation.mock.latencyMs}ms
              </p>
              <p className="mt-0.5 text-[11px] text-ivory-700">
                Nothing leaves the browser. Clear the mock on the operation to go live.
              </p>
            </div>
          )}

          {/* Preflight */}
          <div className={`rounded-xl border px-3 py-2.5 ${verdict.ok ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}`}>
            <p className={`text-[10px] font-bold uppercase tracking-wider ${verdict.ok ? "text-green-800" : "text-amber-800"}`}>
              Preflight · {verdict.ok ? "clear to send" : "blocked"}
            </p>
            {verdict.url && (
              <p className="mt-1 break-all font-mono text-[11px] text-ivory-800">{verdict.url}</p>
            )}
            {!verdict.ok && (
              <ul className="mt-1 space-y-0.5">
                {verdict.reasons.map((r) => (
                  <li key={r} className="text-[11px] text-amber-900">· {r}</li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-[10px] text-ivory-600">
              25s timeout · 1 MB request cap · same-host redirects only (max 2) · auth headers redacted in history
            </p>
          </div>

          {/* Headers */}
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ivory-600">Headers (prefilled from the operation - edits apply to this send only; Authorization/Cookie are never forwarded, use the token above)</p>
            <div className="space-y-1">
              {headers.map((h, i) => (
                <div key={i} className="flex gap-1.5">
                  <input
                    value={h.key}
                    onChange={(e) => setHeader(i, { key: e.target.value })}
                    placeholder="Header"
                    spellCheck={false}
                    aria-label={`Header ${i + 1} name`}
                    className="w-40 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 font-mono text-[11px] text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                  />
                  <input
                    value={h.value}
                    onChange={(e) => setHeader(i, { value: e.target.value })}
                    placeholder="Value"
                    spellCheck={false}
                    aria-label={`Header ${i + 1} value`}
                    className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 font-mono text-[11px] text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setHeaders((prev) => prev.filter((_, j) => j !== i))}
                    aria-label="Remove header"
                    className="rounded p-1 text-ivory-400 hover:text-red-700 transition-colors cursor-pointer"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setHeaders((prev) => [...prev, { key: "", value: "" }])}
                className="text-[11px] font-semibold text-bronze-600 hover:text-bronze-700 cursor-pointer"
              >
                + Header
              </button>
            </div>
          </div>

          {/* Body */}
          {method !== "GET" && (
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
              Body (JSON)
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                spellCheck={false}
                rows={5}
                aria-label="Request body"
                className="mt-1 w-full resize-y rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] p-2.5 font-mono text-[11px] leading-relaxed text-ivory-950 focus:border-bronze-500 focus:outline-none"
              />
            </label>
          )}

          {error && (
            <p className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-2 text-xs text-red-700" role="alert">
              {error}
            </p>
          )}
          {envStatus.length > 0 && (
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ivory-600">
                Vault refs at send time
              </p>
              <ul className="mt-1 space-y-0.5">
                {envStatus.map((s) => (
                  <li key={s.name} className="flex items-center gap-1.5 font-mono text-[11px]">
                    {s.chars === null ? (
                      <span className="text-red-700">✗ $env.{s.name} - missing in vault, send will block</span>
                    ) : (
                      <>
                        <span className="text-green-800">
                          ✓ $env.{s.name} - resolves (
                          {revealed === s.name ? (
                            <span className="break-all rounded bg-ivory-950 px-1 text-ivory-100">{vault[s.name]}</span>
                          ) : (
                            <>•••, {s.chars} chars</>
                          )}
                          )
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleReveal(s.name)}
                          aria-label={revealed === s.name ? `Hide $env.${s.name} value` : `Reveal $env.${s.name} value for 10 seconds`}
                          title={revealed === s.name ? "Hide again" : "Reveal value for 10 seconds"}
                          className="rounded p-0.5 text-ivory-500 hover:text-ivory-950 cursor-pointer"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                            <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button size="sm" onClick={() => void send()} disabled={(!mocked && !verdict.ok) || sending} className="w-full">
            {sending ? "Sending…" : "Send (Test mode)"}
          </Button>

          {/* Response */}
          {result && (
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] p-3">
              <p className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                <span className={`rounded px-1.5 py-0.5 font-bold ${result.status >= 200 && result.status < 300 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>
                  {result.status} {result.statusText}
                </span>
                <span className="text-ivory-600">{result.durationMs}ms</span>
                {result.redirects > 0 && <span className="text-ivory-600">{result.redirects} redirect{result.redirects === 1 ? "" : "s"}</span>}
                {result.truncated && <span className="text-amber-700">truncated</span>}
              </p>
              <p className="mt-1 break-all font-mono text-[10px] text-ivory-500">{result.endpoint}</p>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ivory-950 p-2.5 font-mono text-[11px] leading-relaxed text-ivory-100">
                {result.responseBodyPreview || "(empty body)"}
              </pre>
            </div>
          )}

          {/* History */}
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
              Recent runs ({history.length})
            </p>
            {history.length === 0 ? (
              <p className="text-[11px] text-ivory-500">No runs yet - sends land here with redacted headers.</p>
            ) : (
              <ul className="space-y-1">
                {history.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-surface)] px-2.5 py-1.5">
                    <span className={`rounded px-1 py-px font-mono text-[10px] font-bold ${r.status >= 200 && r.status < 300 ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>
                      {r.status}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ivory-800">
                      {r.method} {r.endpoint}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-ivory-500">{r.durationMs}ms</span>
                    <button
                      type="button"
                      onClick={() => void (async () => {
                        try {
                          await deleteSystemRun(r.id);
                          setHistory(await listSystemRuns(20));
                        } catch {
                          /* fail-soft */
                        }
                      })()}
                      aria-label="Delete run"
                      className="rounded p-1 text-ivory-400 hover:text-red-700 transition-colors cursor-pointer"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
