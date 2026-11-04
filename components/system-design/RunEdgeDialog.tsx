"use client";

import { useMemo, useRef, useState } from "react";
import Button from "../ui/Button";
import { apiFetch } from "@/lib/api";
import { preflightRun } from "@/lib/system-design/runner";
import { compileMapping, type MappingMode } from "@/lib/system-design/mapping";
import { saveSystemRun } from "@/lib/system-design/runStore";
import { findMissingVars, resolveEnvVars, scrubSecrets, type CredVault } from "@/lib/system-design/credentials";
import { buildSendHeaders, authTokenPrefill } from "@/lib/system-design/headers";
import {
  newId,
  resolveSystemBaseUrl,
  type SystemConnection,
  type SystemProject,
  type SystemEnvironment,
} from "@/lib/system-design/model";

interface StepResult {
  status: number;
  statusText: string;
  durationMs: number;
  endpoint: string;
  bodyPreview: string;
  truncated: boolean;
}

type Phase = "setup" | "step1" | "mapping" | "step2" | "done";

async function sendStep(args: {
  baseUrl: string;
  allowHost: string;
  method: string;
  path: string;
  body: string;
  token: string;
  headers: { key: string; value: string }[];
}): Promise<StepResult> {
  const base = args.baseUrl.trim().replace(/\/+$/, "");
  const path = args.path.trim().startsWith("/") ? args.path.trim() : `/${args.path.trim()}`;
  const url = `${base}${path}`;
  const response = await apiFetch(
    "/api/system/run",
    {
      url,
      allowHost: args.allowHost,
      method: args.method,
      headers: args.headers,
      body: args.method === "GET" ? "" : args.body,
      timeoutMs: 25000,
      authToken: args.token || undefined,
    },
    40000
  );
  const text = await response.text();
  let data: {
    success?: boolean;
    status?: number;
    statusText?: string;
    durationMs?: number;
    endpoint?: string;
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
        : `Execution backend failed (HTTP ${response.status}).`
    );
  }
  if (!response.ok || data.error) {
    throw new Error(typeof data.error === "string" ? data.error : `Step failed (HTTP ${response.status}).`);
  }
  return {
    status: data.status ?? 0,
    statusText: data.statusText ?? "",
    durationMs: data.durationMs ?? 0,
    endpoint: data.endpoint ?? url,
    bodyPreview: data.responseBodyPreview ?? "",
    truncated: !!data.truncated,
  };
}

const hostOf = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "";
  }
};

export function RunEdgeDialog({
  edge,
  project,
  environments,
  activeEnvironmentId,
  vault = {},
  onClose,
  onSaveSample,
}: {
  edge: SystemConnection;
  project: SystemProject;
  environments: SystemEnvironment[];
  activeEnvironmentId: string | null;
  vault?: CredVault;
  onClose: () => void;
  onSaveSample: (opId: string, body: string) => void;
}) {
  const sourceOp = project.operations.find((o) => o.id === edge.sourceOperationId) ?? null;
  const targetOp = project.operations.find((o) => o.id === edge.targetOperationId) ?? null;
  const sourceSys = project.systems.find((s) => s.id === edge.sourceId) ?? null;
  const targetSys = project.systems.find((s) => s.id === edge.targetId) ?? null;
  const activeEnv = environments.find((e) => e.id === activeEnvironmentId) ?? environments[0] ?? null;

  const [base1, setBase1] = useState(() => resolveSystemBaseUrl(project.systems, activeEnv, edge.sourceId));
  const [base2, setBase2] = useState(() => resolveSystemBaseUrl(project.systems, activeEnv, edge.targetId));
  const [token, setToken] = useState(() =>
    authTokenPrefill(targetOp?.headers) || authTokenPrefill(sourceOp?.headers)
  );
  const [body1, setBody1] = useState(sourceOp?.sampleBody ?? "{}");
  const [mode, setMode] = useState<MappingMode>("passthrough");
  const [template, setTemplate] = useState('{\n  "data": {{response}}\n}');
  const [phase, setPhase] = useState<Phase>("setup");
  const [step1, setStep1] = useState<StepResult | null>(null);
  const [rendered, setRendered] = useState<{ body: string; missing: string[] } | null>(null);
  const [step2, setStep2] = useState<StepResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tplRef = useRef<HTMLTextAreaElement>(null);

  const insertRef = (ref: string) => {
    const ta = tplRef.current;
    if (!ta) {
      setTemplate((t) => t + ref);
      return;
    }
    const start = ta.selectionStart ?? template.length;
    const end = ta.selectionEnd ?? template.length;
    setTemplate(template.slice(0, start) + ref + template.slice(end));
    const caret = start + ref.length;
    window.setTimeout(() => {
      tplRef.current?.focus();
      tplRef.current?.setSelectionRange(caret, caret);
    }, 0);
  };
  const tplChip = (label: string, ref: string, title: string) => (
    <button
      key={ref}
      type="button"
      onClick={() => insertRef(ref)}
      title={`${title} - click to insert`}
      className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[10px] text-ivory-800 hover:border-bronze-500 hover:text-ivory-950 transition-colors cursor-pointer"
    >
      {label}
    </button>
  );

  const pre1 = useMemo(
    () =>
      preflightRun({
        baseUrl: base1, path: sourceOp?.path ?? "/", method: sourceOp?.method ?? "GET",
        allowHost: hostOf(base1), timeoutMs: 25000, bodyBytes: new TextEncoder().encode(body1).length,
      }),
    [base1, sourceOp, body1]
  );
  const pre2 = useMemo(
    () =>
      preflightRun({
        baseUrl: base2, path: targetOp?.path ?? "/", method: targetOp?.method ?? "GET",
        allowHost: hostOf(base2), timeoutMs: 25000, bodyBytes: 4096,
      }),
    [base2, targetOp]
  );
  const canRun = !!sourceOp && !!targetOp && pre1.ok && pre2.ok && !busy;

  const run = async () => {
    if (!canRun || !sourceOp || !targetOp) return;
    setBusy(true);
    setError(null);
    setStep1(null);
    setStep2(null);
    setRendered(null);
    try {
      // Stored op headers ride along untouched - $env resolves at send.
      const head1 = buildSendHeaders(sourceOp.headers, [], vault);
      const head2 = buildSendHeaders(targetOp.headers, [], vault);
      const missing = [...head1.missing, ...head2.missing].filter((m, i, a) => a.indexOf(m) === i);
      const freeMissing = findMissingVars([body1, token], vault);
      for (const m of freeMissing) if (!missing.includes(m)) missing.push(m);
      if (missing.length > 0) {
        throw new Error(
          `Missing session credentials: ${missing.map((m) => `$env.${m}`).join(", ")}. Add them under Credentials in the project bar.`
        );
      }
      const resolvedBody1 = resolveEnvVars(body1, vault).text;
      const resolvedToken = resolveEnvVars(token, vault).text;
      setPhase("step1");
      const r1 = await sendStep({
        baseUrl: base1, allowHost: hostOf(base1), method: sourceOp.method,
        path: sourceOp.path, body: resolvedBody1, token: resolvedToken,
        headers: head1.headers,
      });
      setStep1(r1);
      if (r1.status < 200 || r1.status >= 300) {
        throw new Error(`Step 1 stopped the run (HTTP ${r1.status}) - fix the source call first.`);
      }
      setPhase("mapping");
      const compiled = compileMapping(mode, template, r1.bodyPreview, {
        seed: resolvedBody1,
        steps: { [edge.sourceId]: r1.bodyPreview },
      });
      if (!compiled.ok) {
        throw new Error(`Mapping failed (not HTTP): ${compiled.error}`);
      }
      setRendered({ body: compiled.body, missing: compiled.missing });
      setPhase("step2");
      const r2 = await sendStep({
        baseUrl: base2, allowHost: hostOf(base2), method: targetOp.method,
        path: targetOp.path, body: resolveEnvVars(compiled.body, vault).text, token: resolvedToken,
        headers: head2.headers,
      });
      setStep2(r2);
      setPhase("done");
      try {
        await saveSystemRun({
          id: newId("run"),
          createdAt: Date.now(),
          projectId: project.id,
          operationName: `Edge: ${sourceSys?.name ?? edge.sourceId} → ${targetSys?.name ?? edge.targetId}`,
          systemName: sourceSys?.name ?? "",
          environmentName: activeEnv?.name ?? "(no environment)",
          method: `${sourceOp.method}+${targetOp.method}`,
          endpoint: r2.endpoint,
          status: r2.status,
          statusText: r2.statusText,
          durationMs: r1.durationMs + r2.durationMs,
          truncated: r1.truncated || r2.truncated,
          requestHeaders: {},
          requestBodyPreview: scrubSecrets(compiled.body, vault).slice(0, 10000),
          responseHeaders: {},
          responseBodyPreview: scrubSecrets(r2.bodyPreview, vault).slice(0, 10000),
          kind: "edge",
          steps: [
            { label: `1 · ${sourceOp.name}`, status: r1.status, statusText: r1.statusText, durationMs: r1.durationMs, endpoint: r1.endpoint },
            { label: mode === "passthrough" ? "mapping · passthrough" : "mapping · template", status: 0, statusText: compiled.missing.length > 0 ? `${compiled.missing.length} refs nulled` : "clean", durationMs: 0, endpoint: "" },
            { label: `2 · ${targetOp.name}`, status: r2.status, statusText: r2.statusText, durationMs: r2.durationMs, endpoint: r2.endpoint },
          ],
        });
      } catch {
        /* trace display matters more than history persistence */
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Edge run failed.");
      if (!step1) setPhase("setup");
    } finally {
      setBusy(false);
    }
  };

  const stepDot = (done: boolean, ok: boolean) => (
    <span
      aria-hidden="true"
      className={`h-2 w-2 shrink-0 rounded-full ${done ? (ok ? "bg-green-600" : "bg-red-600") : "bg-ivory-300"}`}
    />
  );

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="runedge-title" onClick={onClose}>
      <div
        className="modal-card max-w-3xl flex flex-col"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)] shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
              Edge run · Test mode
            </p>
            <h2 id="runedge-title" className="mt-1 truncate text-lg font-bold text-ivory-950">
              {sourceSys?.name ?? "?"} → {targetSys?.name ?? "?"}
              {edge.label ? <span className="font-mono font-normal text-ivory-600"> · {edge.label}</span> : null}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close edge run"
            className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {!sourceOp || !targetOp ? (
            <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900" role="alert">
              Both ends need bound operations before this edge can run. Bind them in the inspector.
            </p>
          ) : (
            <>
              {/* Step 1 */}
              <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-ivory-950">
                  {stepDot(!!step1, (step1?.status ?? 0) >= 200 && (step1?.status ?? 0) < 300)}
                  Step 1 · {sourceOp.method} {sourceOp.name}
                  <span className="font-mono font-normal text-ivory-500">{sourceSys?.name}</span>
                </p>
                <div className="mt-2 grid sm:grid-cols-2 gap-1.5">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                    Base URL
                    <input
                      value={base1}
                      onChange={(e) => setBase1(e.target.value)}
                      spellCheck={false}
                      placeholder="https://…"
                      aria-label="Step 1 base URL"
                      className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                    />
                  </label>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                    Bearer token (memory only; $env.NAME works)
                    <input
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Token for both steps"
                      aria-label="Bearer token for both steps"
                      className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                    />
                  </label>
                </div>
                {sourceOp.method !== "GET" && (
                  <label className="mt-1.5 block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                    Step 1 body
                    <textarea
                      value={body1}
                      onChange={(e) => setBody1(e.target.value)}
                      spellCheck={false}
                      rows={3}
                      aria-label="Step 1 request body"
                      className="mt-0.5 w-full resize-y rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-2 font-mono text-[11px] leading-relaxed text-ivory-950 focus:border-bronze-500 focus:outline-none"
                    />
                  </label>
                )}
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => onSaveSample(sourceOp.id, body1)}
                    title="Remember this body on the operation for next time"
                    className="text-[11px] font-semibold text-bronze-600 hover:text-bronze-700 cursor-pointer"
                  >
                    Save body as sample
                  </button>
                </div>
                {step1 && (
                  <div className="mt-2 rounded-lg bg-ivory-950 p-2.5 font-mono text-[11px] leading-relaxed text-ivory-100">
                    <p>
                      <span className={`font-bold ${step1.status >= 200 && step1.status < 300 ? "text-green-400" : "text-red-400"}`}>
                        {step1.status} {step1.statusText}
                      </span>{" "}
                      <span className="text-ivory-400">{step1.durationMs}ms</span>
                    </p>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all">{step1.bodyPreview || "(empty body)"}</pre>
                  </div>
                )}
              </section>

              {/* Mapping */}
              <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-ivory-950">
                  {stepDot(!!rendered, true)}
                  Mapping · source response → step 2 body
                </p>
                <div className="mt-2 flex gap-1.5" role="radiogroup" aria-label="Mapping mode">
                  {(["passthrough", "template"] as const).map((m) => (
                    <button
                      key={m}
                      role="radio"
                      aria-checked={mode === m}
                      onClick={() => setMode(m)}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors cursor-pointer ${mode === m ? "bg-ivory-950 text-ivory-100 border-ivory-950" : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-600 hover:text-ivory-950"}`}
                    >
                      {m === "passthrough" ? "Pass-through" : "Template"}
                    </button>
                  ))}
                </div>
                {mode === "template" ? (
                  <>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tplChip("response", "{{response}}", "Step 1 output")}
                      {tplChip("seed", "{{seed}}", "Step 1 input body")}
                      {tplChip(sourceSys?.name ?? "source step", `{{steps.${edge.sourceId}}}`, "Step 1 output by system")}
                      {tplChip("$env", "$env.", "Session credential prefix")}
                    </div>
                    <textarea
                      ref={tplRef}
                      value={template}
                      onChange={(e) => setTemplate(e.target.value)}
                      spellCheck={false}
                      rows={4}
                      aria-label="Mapping template"
                      placeholder={'{\n  "x": {{response}}\n}'}
                      className="mt-1.5 w-full resize-y rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-2 font-mono text-[11px] leading-relaxed text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                    />
                  </>
                ) : (
                  <p className="mt-1.5 text-[11px] text-ivory-600">
                    Forwards the step-1 response body untouched. Fails loudly when it is not JSON.
                  </p>
                )}
                {rendered && (
                  <div className="mt-2">
                    {rendered.missing.length > 0 && (
                      <p className="mb-1 text-[11px] text-amber-800">
                        Nulled refs (missing in source): {rendered.missing.join(", ")}
                      </p>
                    )}
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ivory-950 p-2.5 font-mono text-[11px] leading-relaxed text-ivory-100">
                      {rendered.body}
                    </pre>
                  </div>
                )}
              </section>

              {/* Step 2 */}
              <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-ivory-950">
                  {stepDot(!!step2, (step2?.status ?? 0) >= 200 && (step2?.status ?? 0) < 300)}
                  Step 2 · {targetOp.method} {targetOp.name}
                  <span className="font-mono font-normal text-ivory-500">{targetSys?.name}</span>
                </p>
                <label className="mt-2 block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                  Base URL
                  <input
                    value={base2}
                    onChange={(e) => setBase2(e.target.value)}
                    spellCheck={false}
                    placeholder="https://…"
                    aria-label="Step 2 base URL"
                    className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                  />
                </label>
                <p className="mt-1 font-mono text-[10px] text-ivory-500">
                  {targetOp.method} {base2.replace(/\/+$/, "")}
                  {targetOp.path.startsWith("/") ? targetOp.path : `/${targetOp.path}`}
                </p>
                {step2 && (
                  <div className="mt-2 rounded-lg bg-ivory-950 p-2.5 font-mono text-[11px] leading-relaxed text-ivory-100">
                    <p>
                      <span className={`font-bold ${step2.status >= 200 && step2.status < 300 ? "text-green-400" : "text-red-400"}`}>
                        {step2.status} {step2.statusText}
                      </span>{" "}
                      <span className="text-ivory-400">{step2.durationMs}ms</span>
                    </p>
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all">{step2.bodyPreview || "(empty body)"}</pre>
                  </div>
                )}
              </section>

              {(!pre1.ok || !pre2.ok) && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Preflight blocked</p>
                  <ul className="mt-1 space-y-0.5">
                    {[...pre1.reasons, ...pre2.reasons].map((r) => (
                      <li key={r} className="text-[11px] text-amber-900">· {r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {error && (
                <p className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-2 text-xs text-red-700" role="alert">
                  {error}
                </p>
              )}
              <Button size="sm" onClick={() => void run()} disabled={!canRun} className="w-full">
                {busy ? `Running… (${phase})` : "Run edge end-to-end (Test mode)"}
              </Button>
              <p className="text-[10px] text-ivory-500">
                Stops on first failure · mapping errors are reported distinctly from HTTP errors · trace saved to run
                history.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
