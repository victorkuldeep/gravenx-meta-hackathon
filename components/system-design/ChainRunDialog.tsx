"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import { apiFetch } from "@/lib/api";
import { preflightRun } from "@/lib/system-design/runner";
import { compileMapping } from "@/lib/system-design/mapping";
import { resolveChain, CHAIN_MAX_HOPS } from "@/lib/system-design/chain";
import { saveSystemRun } from "@/lib/system-design/runStore";
import { computeVerdict } from "@/lib/system-design/verdict";
import { buildSendHeaders, authTokenPrefill } from "@/lib/system-design/headers";
import { buildMockResult, sleep } from "@/lib/system-design/mock";
import type { OperationMock } from "@/lib/system-design/model";
import { findMissingVars, resolveEnvVars, scrubSecrets, type CredVault } from "@/lib/system-design/credentials";
import { downloadRunMarkdown, renderRunMarkdown } from "@/lib/system-design/runMarkdown";
import {
  newId,
  resolveRunScope,
  resolveSystemBaseUrl,
  type RunScope,
  type SystemConnection,
  type SystemOperation,
  type SystemProject,
  type SystemEnvironment,
} from "@/lib/system-design/model";

interface HopTrace {
  lane: number;
  edgeId: string;
  label: string;
  kind: "call" | "mapping";
  status: "ok" | "failed" | "skipped";
  durationMs: number;
  endpoint: string;
  /** Response (or compiled mapping) body. */
  bodyPreview: string;
  /** Request body sent for this hop ("" when none). */
  requestBody: string;
  note: string;
}

const CALLABLE = ["GET", "POST", "PUT", "PATCH", "DELETE"];

const hostOf = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "";
  }
};

async function callApi(args: {
  baseUrl: string;
  allowHost: string;
  method: string;
  path: string;
  body: string;
  token: string;
  headers: { key: string; value: string }[];
  /** Present = serve the canned response with zero network. */
  mock?: OperationMock | null;
}): Promise<{ status: number; statusText: string; durationMs: number; endpoint: string; bodyPreview: string; truncated: boolean }> {
  const base = args.baseUrl.trim().replace(/\/+$/, "");
  const path = args.path.trim().startsWith("/") ? args.path.trim() : `/${args.path.trim()}`;
  const url = `${base}${path}`;
  if (args.mock) {
    const canned = buildMockResult(args.mock);
    await sleep(canned.durationMs);
    return {
      status: canned.status,
      statusText: canned.statusText,
      durationMs: canned.durationMs,
      endpoint: url,
      bodyPreview: canned.bodyPreview,
      truncated: false,
    };
  }
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
    throw new Error(typeof data.error === "string" ? data.error : `Hop failed (HTTP ${response.status}).`);
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

/** Position of a hop's system in its lane path (for the upstream breadcrumb). */
function hopFocusIndex(
  lane: { edges: { id: string }[] },
  edgeId: string
): number {
  if (!edgeId) return -1;
  const idx = lane.edges.findIndex((e) => e.id === edgeId);
  return idx < 0 ? -1 : idx + 1;
}

function TraceHop({
  hop,
  systems,
  focusIdx,
}: {
  hop: HopTrace;
  systems: string[];
  focusIdx: number;
}) {
  const [open, setOpen] = useState(false);
  const dot =
    hop.status === "ok"
      ? "bg-green-600"
      : hop.status === "skipped"
        ? "bg-ivory-400"
        : "bg-red-600";
  return (
    <li className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-2.5 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-1.5 text-left text-[11px]"
      >
        <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 flex-1 truncate font-semibold text-ivory-950">{hop.label}</span>
        {hop.durationMs > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-ivory-500">{hop.durationMs}ms</span>
        )}
        <span aria-hidden="true" className="shrink-0 text-[10px] text-ivory-500">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {focusIdx >= 0 && (
        <p className="mt-0.5 font-mono text-[10px] text-ivory-500">
          ↑ upstream:{" "}
          {systems.map((s, i) => (
            <span key={i} className={i === focusIdx ? "font-bold text-ivory-950" : undefined}>
              {i > 0 ? " → " : ""}
              {s}
            </span>
          ))}
        </p>
      )}
      {hop.endpoint && <p className="mt-0.5 break-all font-mono text-[10px] text-ivory-500">{hop.endpoint}</p>}
      {hop.note && <p className="mt-0.5 text-[11px] text-amber-800">{hop.note}</p>}
      {open && hop.requestBody && (
        <div className="mt-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ivory-600">Request sent</p>
          <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ivory-950 p-2 font-mono text-[10px] leading-relaxed text-ivory-100">
            {hop.requestBody}
          </pre>
        </div>
      )}
      {open && hop.bodyPreview && (
        <div className="mt-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-ivory-600">
            {hop.kind === "mapping" ? "Compiled body" : "Response"}
          </p>
          <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ivory-950 p-2 font-mono text-[10px] leading-relaxed text-ivory-100">
            {hop.bodyPreview}
          </pre>
        </div>
      )}
    </li>
  );
}

export function ChainRunDialog({
  startEdgeId,
  project,
  environments,
  activeEnvironmentId,
  vault = {},
  onClose,
  onVisUpdate,
  onSaveScope,
  scenarioId = null,
  expectStatus = null,
}: {
  startEdgeId: string;
  project: SystemProject;
  environments: SystemEnvironment[];
  activeEnvironmentId: string | null;
  vault?: CredVault;
  onClose: () => void;
  onVisUpdate: (edgeId: string, status: "running" | "ok" | "failed" | null) => void;
  /** Persist the picked lanes + overrides (travels with the project). */
  onSaveScope: (scope: RunScope) => void;
  /** Launching scenario (validation epic): stamped on the saved run with a
   * deterministic verdict against expectStatus. Null for ad-hoc runs. */
  scenarioId?: string | null;
  expectStatus?: number | null;
}) {
  const lanes = useMemo(() => resolveChain(project, startEdgeId), [project, startEdgeId]);
  // Run scope: picked lanes + per-edge operation overrides. Saved scope
  // replays when it targets this start edge, otherwise run everything.
  const [lanesOn, setLanesOn] = useState<number[]>(
    () => resolveRunScope(project, startEdgeId, lanes.length).lanes
  );
  const [opByEdge, setOpByEdge] = useState<Record<string, string>>(
    () => resolveRunScope(project, startEdgeId, lanes.length).opByEdge
  );
  const persistScope = (nextLanes: number[], nextOps: Record<string, string>) => {
    onSaveScope({ startEdgeId, lanes: nextLanes, opByEdge: nextOps });
  };
  const toggleLane = (n: number) => {
    const next = lanesOn.includes(n)
      ? lanesOn.filter((x) => x !== n)
      : [...lanesOn, n].sort((a, b) => a - b);
    setLanesOn(next);
    persistScope(next, opByEdge);
  };
  const startEdge = project.connections.find((c) => c.id === startEdgeId) ?? null;
  const activeEnv = environments.find((e) => e.id === activeEnvironmentId) ?? environments[0] ?? null;

  const involvedSystems = useMemo(() => {
    const ids = new Set<string>();
    for (const lane of lanes) {
      for (const e of lane.edges) {
        ids.add(e.sourceId);
        ids.add(e.targetId);
      }
    }
    return [...ids]
      .map((id) => project.systems.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s);
  }, [lanes, project]);

  const [bases, setBases] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const s of involvedSystems) out[s.id] = resolveSystemBaseUrl(project.systems, activeEnv, s.id);
    return out;
  });
  const [token, setToken] = useState(() => {
    const src = startEdge
      ? project.operations.find((o) => o.id === startEdge.sourceOperationId)?.headers
      : undefined;
    const firstTargetId = lanes[0]?.edges[0]?.targetOperationId;
    const first = firstTargetId ? project.operations.find((o) => o.id === firstTargetId)?.headers : undefined;
    return authTokenPrefill(src) || authTokenPrefill(first);
  });
  // Seed defaults to the start operation's stored sample body (the User
  // Input pattern) - the user edits per run, never configures twice.
  const [seedBody, setSeedBody] = useState(() =>
    startEdge
      ? (project.operations.find((o) => o.id === startEdge.sourceOperationId)?.sampleBody ?? "{}")
      : "{}"
  );
  const [running, setRunning] = useState(false);
  const [trace, setTrace] = useState<HopTrace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [runAt, setRunAt] = useState<number>(() => Date.now());

  const downloadMarkdown = () => {
    const byLane = lanes.map((lane, li) => ({
      path: [
        sysOf(lane.edges[0]?.sourceId ?? "")?.name ?? "?",
        ...lane.edges.map((e) => sysOf(e.targetId)?.name ?? "?"),
      ],
      hops: trace
        .filter((t) => t.lane === li + 1)
        .map((t) => ({
          label: t.label,
          status: t.status,
          durationMs: t.durationMs,
          endpoint: t.endpoint,
          requestBody: scrubSecrets(t.requestBody, vault),
          responseBody: scrubSecrets(t.bodyPreview, vault),
          note: t.note,
        })),
      stopped: lane.stopped,
    }));
    downloadRunMarkdown(
      renderRunMarkdown({
        title: `Chain run from ${sysOf(startEdge?.sourceId ?? "")?.name ?? "?"}`,
        projectName: project.name,
        environmentName: activeEnv?.name ?? "(no environment)",
        startedAt: runAt,
        seedBody: scrubSecrets(seedBody, vault),
        lanes: byLane,
      }),
      `system-run-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${runAt}.md`
    );
  };

  const firstSourceOp = startEdge
    ? (project.operations.find((o) => o.id === startEdge.sourceOperationId) ?? null)
    : null;
  const seedCallable = !!firstSourceOp && CALLABLE.includes(firstSourceOp.method);

  const opOf = (id: string | undefined) => project.operations.find((o) => o.id === id) ?? null;
  const sysOf = (id: string) => project.systems.find((s) => s.id === id) ?? null;
  /** Effective target operation for an edge: run-scope override wins, else the bound op. */
  const effOpOf = (edge: SystemConnection): SystemOperation | null => {
    const override = opByEdge[edge.id];
    if (override) {
      const op = opOf(override);
      if (op) return op;
    }
    return opOf(edge.targetOperationId);
  };
  /** Unique edges in the enabled lanes, for per-hop operation picks. */
  const scopedEdges = useMemo(() => {
    const seen = new Set<string>();
    const out: SystemConnection[] = [];
    lanes.forEach((lane, idx) => {
      if (!lanesOn.includes(idx + 1)) return;
      for (const e of lane.edges) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e);
      }
    });
    return out;
  }, [lanes, lanesOn]);
  const opsForEdge = (edge: SystemConnection): SystemOperation[] => {
    const ifaces = new Set(
      project.interfaces.filter((i) => i.systemId === edge.targetId).map((i) => i.id)
    );
    return project.operations.filter((o) => ifaces.has(o.interfaceId));
  };
  const setEdgeOp = (edgeId: string, opId: string) => {
    const next = { ...opByEdge };
    if (opId) next[edgeId] = opId;
    else delete next[edgeId];
    setOpByEdge(next);
    persistScope(lanesOn, next);
  };

  // Preflight every callable hop URL upfront (bodies resolve at runtime).
  // Any block stops the run before anything fires - fix bases first.
  const blocks: string[] = useMemo(() => {
    const out: string[] = [];
    const checked = new Set<string>();
    const check = (label: string, baseUrl: string, path: string, method: string, mocked: boolean) => {
      // Mocked hops serve canned responses with zero network - no base needed.
      if (mocked) return;
      const v = preflightRun({
        baseUrl, path, method,
        allowHost: hostOf(baseUrl),
        timeoutMs: 25000,
        bodyBytes: 0,
      });
      if (!v.ok) out.push(`${label}: ${v.reasons[0]}`);
    };
    if (seedCallable && firstSourceOp && startEdge) {
      check(
        `Seed · ${firstSourceOp.name}`,
        bases[startEdge.sourceId] ?? "", firstSourceOp.path, firstSourceOp.method,
        !!firstSourceOp.mock
      );
    }
    for (const lane of lanes) {
      for (const e of lane.edges) {
        if (checked.has(e.id)) continue;
        checked.add(e.id);
        const top = effOpOf(e);
        if (!top) continue;
        check(
          `${sysOf(e.targetId)?.name ?? e.targetId} · ${top.name}`,
          bases[e.targetId] ?? "", top.path, top.method,
          !!top.mock
        );
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanes, bases, seedCallable]);

  // Session-credential refs ($env.NAME) across seed, token, stored op
  // headers and stored edge templates - missing entries block the run
  // before anything fires.
  const credMissing: string[] = useMemo(() => {
    const texts = [seedBody, token];
    for (const lane of lanes) {
      for (const e of lane.edges) {
        if (e.mapping?.template) texts.push(e.mapping.template);
      }
    }
    const checkedOps = new Set<string>();
    const collectOp = (opId: string | undefined) => {
      if (!opId || checkedOps.has(opId)) return;
      checkedOps.add(opId);
      const op = project.operations.find((o) => o.id === opId);
      for (const h of op?.headers ?? []) texts.push(h.value);
    };
    collectOp(startEdge?.sourceOperationId);
    for (const lane of lanes) {
      for (const e of lane.edges) collectOp(effOpOf(e)?.id);
    }
    return findMissingVars(texts, vault);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanes, seedBody, token, vault, startEdge, project.operations]);

  const run = async () => {
    if (running || lanes.length === 0) return;
    setRunning(true);
    setRunAt(Date.now());
    setError(null);
    setTrace([]);
    setDone(false);
    const trail: HopTrace[] = [];
    const push = (t: HopTrace) => {
      trail.push(t);
      setTrace([...trail]);
    };
    const edgeOk = new Map<string, boolean>();
    const markEdge = (edgeId: string, ok: boolean) => {
      const prev = edgeOk.get(edgeId);
      const next = prev === false || !ok ? false : true;
      edgeOk.set(edgeId, next);
      onVisUpdate(edgeId, !ok ? "failed" : "ok");
    };
    try {
      if (credMissing.length > 0) {
        throw new Error(
          `Missing session credentials: ${credMissing.map((m) => `$env.${m}`).join(", ")}. Add them under Credentials in the project bar.`
        );
      }
      const resolvedSeed = resolveEnvVars(seedBody, vault).text;
      const resolvedToken = resolveEnvVars(token, vault).text;
      // Stored op headers ride along untouched - $env resolves at send.
      const headersFor = (opId: string | undefined) =>
        buildSendHeaders(project.operations.find((o) => o.id === opId)?.headers, [], vault).headers;
      // Every hop output stays addressable as {{steps.<systemId>}}; the seed
      // doubles as the source output when the first op is an event.
      const outputs: Record<string, string> = {};
      // Bodies actually sent, keyed by target system - {{request}} /
      // {{requests.*}} let downstream hops replay what middleware received,
      // even when the hop answered with a bare ack.
      const requests: Record<string, string> = {};
      let lastRequest = "";
      persistScope(lanesOn, opByEdge);
      for (const [laneIdx, lane] of lanes.entries()) {
        const laneNo = laneIdx + 1;
        if (!lanesOn.includes(laneNo)) {
          push({
            lane: laneNo, edgeId: "",
            label: "Lane skipped by run scope",
            kind: "mapping", status: "skipped",
            durationMs: 0, endpoint: "", bodyPreview: "", requestBody: "", note: "unchecked in run scope",
          });
          continue;
        }
        let inbound = "";
        lastRequest = "";
        let first = true;
        for (const e of lane.edges) {
          const top = effOpOf(e);
          if (!top) {
            push({
              lane: laneNo, edgeId: e.id,
              label: `Hop: ${sysOf(e.targetId)?.name ?? e.targetId} - no bound target operation, lane stops`,
              kind: "call", status: "failed", durationMs: 0, endpoint: "", bodyPreview: "", requestBody: "", note: "stopped",
            });
            markEdge(e.id, false);
            break;
          }
          // Seed: first hop calls the start edge's source op (when callable),
          // otherwise the manual seed body starts the flow.
          if (first) {
            first = false;
            if (seedCallable && firstSourceOp) {
              const sys = sysOf(startEdge!.sourceId);
              onVisUpdate(e.id, "running");
              try {
                const r = await callApi({
                  baseUrl: bases[startEdge!.sourceId] ?? "",
                  allowHost: hostOf(bases[startEdge!.sourceId] ?? ""),
                  method: firstSourceOp.method, path: firstSourceOp.path,
                  body: resolvedSeed, token: resolvedToken,
                  headers: headersFor(firstSourceOp.id),
                  mock: firstSourceOp.mock ?? null,
                });
                inbound = r.bodyPreview;
                outputs[startEdge!.sourceId] = r.bodyPreview;
                requests[startEdge!.sourceId] = resolvedSeed;
                lastRequest = resolvedSeed;
                push({
                  lane: laneNo, edgeId: e.id,
                  label: `Seed · ${firstSourceOp.method} ${firstSourceOp.name} (${sys?.name ?? "?"})${firstSourceOp.mock ? " (mock)" : ""}`,
                  kind: "call", status: r.status >= 200 && r.status < 300 ? "ok" : "failed",
                  durationMs: r.durationMs, endpoint: r.endpoint, bodyPreview: r.bodyPreview,
                  requestBody: firstSourceOp.method === "GET" ? "" : resolvedSeed,
                  note: r.status >= 200 && r.status < 300 ? (firstSourceOp.mock ? "mocked - no network" : "") : "stopped",
                });
                if (r.status < 200 || r.status >= 300) {
                  markEdge(e.id, false);
                  break;
                }
              } catch (err) {
                push({
                  lane: laneNo, edgeId: e.id, label: `Seed · ${firstSourceOp.name}`,
                  kind: "call", status: "failed", durationMs: 0, endpoint: "",
                  bodyPreview: "", requestBody: firstSourceOp.method === "GET" ? "" : resolvedSeed,
                  note: err instanceof Error ? err.message : "failed",
                });
                markEdge(e.id, false);
                break;
              }
            } else {
              inbound = resolvedSeed;
              outputs[startEdge!.sourceId] = resolvedSeed;
            }
          }
          // Mapping: stored on the edge, passthrough when absent (stated).
          // Templates see {{response}} (previous hop), {{seed}} and every
          // {{steps.<systemId>}} captured so far - cross-hop by design.
          const mapping = e.mapping ?? { mode: "passthrough" as const, template: "" };
          const compiled = compileMapping(mapping.mode, mapping.template, inbound, {
            seed: resolvedSeed,
            steps: outputs,
            request: lastRequest,
            requests,
          });
          push({
            lane: laneNo, edgeId: e.id,
            label: `Mapping · ${mapping.mode}${e.mapping ? "" : " (default)"}`,
            kind: "mapping",
            status: compiled.ok ? "ok" : "failed",
            durationMs: 0, endpoint: "",
            bodyPreview: compiled.body.slice(0, 2000),
            requestBody: inbound.slice(0, 2000),
            note: compiled.ok
              ? (compiled.missing.length > 0 ? `nulled: ${compiled.missing.join(", ")}` : "")
              : (compiled.error ?? "mapping failed"),
          });
          if (!compiled.ok) {
            markEdge(e.id, false);
            break;
          }
          // Target call ($env refs in stored templates resolve at send time).
          onVisUpdate(e.id, "running");
          let sentBody = "";
          try {
            sentBody = resolveEnvVars(compiled.body, vault).text;
            requests[e.targetId] = sentBody;
            lastRequest = sentBody;
            const r = await callApi({
              baseUrl: bases[e.targetId] ?? "",
              allowHost: hostOf(bases[e.targetId] ?? ""),
              method: top.method, path: top.path,
              body: sentBody,
              token: resolvedToken,
              headers: headersFor(top.id),
              mock: top.mock ?? null,
            });
            const ok = r.status >= 200 && r.status < 300;
            push({
              lane: laneNo, edgeId: e.id,
              label: `Call · ${top.method} ${top.name} (${sysOf(e.targetId)?.name ?? "?"})${top.mock ? " (mock)" : ""}`,
              kind: "call", status: ok ? "ok" : "failed",
              durationMs: r.durationMs, endpoint: r.endpoint, bodyPreview: r.bodyPreview,
              requestBody: sentBody.slice(0, 2000),
              note: ok ? (top.mock ? "mocked - no network" : "") : "stopped",
            });
            markEdge(e.id, ok);
            if (!ok) break;
            inbound = r.bodyPreview;
            outputs[e.targetId] = r.bodyPreview;
          } catch (err) {
            push({
              lane: laneNo, edgeId: e.id,
              label: `Call · ${top.method} ${top.name}`,
              kind: "call", status: "failed", durationMs: 0, endpoint: "",
              bodyPreview: "", requestBody: sentBody.slice(0, 2000),
              note: err instanceof Error ? err.message : "failed",
            });
            markEdge(e.id, false);
            break;
          }
        }
        if (lane.stopped) {
          push({
            lane: laneNo, edgeId: lane.edges[lane.edges.length - 1]?.id ?? "",
            label: lane.stopped, kind: "mapping", status: "failed",
            durationMs: 0, endpoint: "", bodyPreview: "", requestBody: "", note: "stopped",
          });
        }
      }
      setDone(true);
      try {
        const terminal = trail.some((t) => t.status === "failed") ? 500 : 200;
        const verdict = scenarioId ? computeVerdict(expectStatus, terminal) : null;
        await saveSystemRun({
          id: newId("run"),
          createdAt: Date.now(),
          projectId: project.id,
          ...(scenarioId ? { scenarioId } : {}),
          ...(verdict ? { verdict } : {}),
          operationName: `Chain from ${sysOf(startEdge?.sourceId ?? "")?.name ?? "?"} (${lanes.length} lane${lanes.length === 1 ? "" : "s"})`,
          systemName: sysOf(startEdge?.sourceId ?? "")?.name ?? "",
          environmentName: activeEnv?.name ?? "(no environment)",
          method: "CHAIN",
          endpoint: "",
          status: terminal,
          statusText: trail.some((t) => t.status === "failed") ? "chain with failures" : "chain complete",
          durationMs: trail.reduce((n, t) => n + t.durationMs, 0),
          truncated: false,
          requestHeaders: {},
          requestBodyPreview: seedBody.slice(0, 10000),
          responseHeaders: {},
          responseBodyPreview: "",
          kind: "chain",
          steps: trail.map((t) => ({
            label: `L${t.lane} · ${t.label}`,
            status: t.status === "ok" ? 200 : 500,
            statusText: t.status,
            durationMs: t.durationMs,
            endpoint: t.endpoint,
            requestBodyPreview: scrubSecrets(t.requestBody, vault).slice(0, 2000),
            responseBodyPreview: scrubSecrets(t.bodyPreview, vault).slice(0, 2000),
          })),
        });
      } catch {
        /* trace display matters more than history persistence */
      }
    } finally {
      setRunning(false);
    }
  };

  const failed = trace.some((t) => t.status === "failed");

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="chain-title" onClick={onClose}>
      <div
        className="modal-card max-w-3xl flex flex-col"
        style={{ maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)] shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
              Chain run · Test mode · {lanes.length} lane{lanes.length === 1 ? "" : "s"}
            </p>
            <h2 id="chain-title" className="mt-1 truncate text-lg font-bold text-ivory-950">
              Flow from {sysOf(startEdge?.sourceId ?? "")?.name ?? "?"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chain run"
            className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Resolved lanes */}
          <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-ivory-600">
              Resolved path{lanes.length === 1 ? "" : "s"} (max {CHAIN_MAX_HOPS} hops)
            </p>
            {lanes.length === 0 ? (
              <p className="mt-1 text-[11px] text-red-700">Start edge not found - nothing to run.</p>
            ) : (
              <ol className="mt-1.5 space-y-1">
                {lanes.map((lane, i) => (
                  <li key={i} className="flex items-start gap-1.5 font-mono text-[11px] text-ivory-800">
                    <input
                      type="checkbox"
                      checked={lanesOn.includes(i + 1)}
                      onChange={() => toggleLane(i + 1)}
                      aria-label={`Run lane ${i + 1}`}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#7A5C3A] cursor-pointer"
                    />
                    <span>
                      <span className="font-bold text-ivory-950">L{i + 1}</span>{" "}
                      {lane.edges.map((e) => sysOf(e.sourceId)?.name ?? "?").join(" → ")} →{" "}
                      {sysOf(lane.edges[lane.edges.length - 1]?.targetId ?? "")?.name ?? "?"}
                      {lane.stopped && <span className="text-amber-700"> · stops: {lane.stopped}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Hop operations - pick which API fires per link (edge binding is the default) */}
          {scopedEdges.length > 0 && (
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ivory-600">
                Hop operations · checked lanes only
              </p>
              <div className="mt-1.5 space-y-1.5">
                {scopedEdges.map((e) => {
                  const bound = e.targetOperationId ?? "";
                  const value = opByEdge[e.id] ?? bound;
                  const ops = opsForEdge(e);
                  return (
                    <label key={e.id} className="flex items-center gap-2 text-[11px]">
                      <span className="min-w-0 flex-1 truncate font-mono text-ivory-700">
                        {sysOf(e.sourceId)?.name ?? "?"} → {sysOf(e.targetId)?.name ?? "?"}
                        {e.label ? ` · ${e.label}` : ""}
                      </span>
                      <select
                        value={value}
                        onChange={(ev) => setEdgeOp(e.id, ev.target.value)}
                        aria-label={`Operation for ${sysOf(e.sourceId)?.name ?? "?"} to ${sysOf(e.targetId)?.name ?? "?"}`}
                        className="max-w-[220px] cursor-pointer rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[10px] text-ivory-950"
                      >
                        <option value="">(edge binding)</option>
                        {ops.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.method} {o.path} · {o.name}
                            {o.mock ? " (mock)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10px] text-ivory-500">
                Overrides persist with the project, so a shared simulation replays the same path.
              </p>
            </div>
          )}

          {/* Per-system bases + token */}
          <div className="grid sm:grid-cols-2 gap-1.5">
            {involvedSystems.map((s) => (
              <label key={s.id} className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                {s.name} base URL
                <input
                  value={bases[s.id] ?? ""}
                  onChange={(e) => setBases((prev) => ({ ...prev, [s.id]: e.target.value }))}
                  spellCheck={false}
                  placeholder="https://…"
                  aria-label={`${s.name} base URL`}
                  className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                />
              </label>
            ))}
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
              Bearer token, all hops (memory only; $env.NAME works)
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Token for every hop"
                aria-label="Bearer token for every hop"
                className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
              />
            </label>
          </div>

          {/* Seed body */}
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
            {seedCallable ? "First call body" : "Seed payload (first op is an event - you supply the trigger)"}
            <textarea
              value={seedBody}
              onChange={(e) => setSeedBody(e.target.value)}
              spellCheck={false}
              rows={3}
              aria-label="Seed payload"
              className="mt-0.5 w-full resize-y rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-2 font-mono text-[11px] leading-relaxed text-ivory-950 focus:border-bronze-500 focus:outline-none"
            />
          </label>

              {error && (
                <p className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-2 text-xs text-red-700" role="alert">
                  {error}
                </p>
              )}
              {credMissing.length > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                    Missing session credentials
                  </p>
                  <p className="mt-1 text-[11px] text-amber-900">
                    {credMissing.map((m) => `$env.${m}`).join(", ")} - add them under Credentials
                    in the project bar before running.
                  </p>
                </div>
              )}
              {blocks.length > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                    Preflight blocked - fix bases to run
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {blocks.map((b) => (
                      <li key={b} className="text-[11px] text-amber-900">· {b}</li>
                    ))}
                  </ul>
                </div>
              )}
              <Button size="sm" onClick={() => void run()} disabled={running || lanes.length === 0 || blocks.length > 0 || credMissing.length > 0} className="w-full">
                {running ? "Running flow…" : done ? "Run again" : "Run full flow (Test mode)"}
              </Button>

          {/* Trace */}
          {trace.length > 0 && (
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ivory-600">
                  Trace · {trace.filter((t) => t.status === "ok").length}/{trace.length} steps ok
                  {failed ? " · failures stop their lane" : ""}
                </p>
                <button
                  type="button"
                  onClick={downloadMarkdown}
                  title="Download this run as Markdown (vault secrets scrubbed)"
                  className="shrink-0 rounded-md border border-[var(--color-line)] bg-white px-2 py-1 font-mono text-[10px] font-bold text-bronze-700 hover:border-bronze-500 transition-colors cursor-pointer"
                >
                  ↓ .md
                </button>
              </div>
              <div className="mt-1.5 space-y-3">
                {lanes.map((lane, li) => {
                  const laneNo = li + 1;
                  const hops = trace
                    .map((t, idx) => ({ ...t, key: `${t.lane}-${idx}` }))
                    .filter((t) => t.lane === laneNo);
                  if (hops.length === 0) return null;
                  const systems = [
                    sysOf(lane.edges[0]?.sourceId ?? "")?.name ?? "?",
                    ...lane.edges.map((e) => sysOf(e.targetId)?.name ?? "?"),
                  ];
                  return (
                    <div key={laneNo}>
                      <p className="font-mono text-[11px] text-ivory-600">
                        <span className="font-bold text-ivory-950">L{laneNo}</span>{" "}
                        {systems.join(" → ")}
                      </p>
                      <ol className="mt-1 space-y-1.5">
                        {hops.map((h) => (
                          <TraceHop
                            key={h.key}
                            hop={h}
                            systems={systems}
                            focusIdx={hopFocusIndex(lane, h.edgeId)}
                          />
                        ))}
                      </ol>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
