"use client";

/**
 * Scenarios tab: named test cases. A scenario pins a flow, a target
 * environment, a seed input payload, mock overrides for systems that are
 * not reachable (VPN / Zscaler / not built yet), and an expected status.
 * Run applies the mocks, seeds the start payload, and opens the chain
 * runner - then compare the verdict against the expectation.
 */

import { useEffect, useMemo, useState } from "react";
import Button from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import {
  newId,
  type OperationMock,
  type ScenarioDef,
  type SystemProject,
} from "@/lib/system-design/model";
import { listSystemRuns, type SystemRunRecord } from "@/lib/system-design/runStore";
import { edgeLabel, fieldLabel, methodBadge, monoInput, panelShell, type Mutate } from "./shared";

interface Props {
  project: SystemProject;
  mutate: Mutate;
  onRunScenario: (s: ScenarioDef) => void;
}

const BLANK_MOCK: OperationMock = { status: 200, body: "{}", latencyMs: 0 };

function ScenarioEditor({ project, scenario, mutate }: { project: SystemProject; scenario: ScenarioDef; mutate: Mutate }) {
  const [mockOpId, setMockOpId] = useState("");
  const patch = (p: Partial<ScenarioDef>) =>
    mutate((prev) => ({ ...prev, scenarios: prev.scenarios.map((s) => (s.id === scenario.id ? { ...s, ...p } : s)) }));

  let payloadValid = true;
  try {
    JSON.parse(scenario.inputPayload);
  } catch {
    payloadValid = scenario.inputPayload.trim() === "" ? true : false;
  }

  const allOps = useMemo(
    () =>
      project.operations.map((o) => {
        const iface = project.interfaces.find((f) => f.id === o.interfaceId);
        const sys = project.systems.find((s) => s.id === iface?.systemId);
        return { op: o, systemName: sys?.name ?? "?" };
      }),
    [project]
  );

  const flow = project.flows.find((f) => f.id === scenario.flowId) ?? null;

  return (
    <div className="mt-2 space-y-2 border-t border-[var(--color-line-soft)] pt-2">
      <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
        <label className="block">
          <span className={fieldLabel}>Flow</span>
          <select
            value={scenario.flowId ?? ""}
            onChange={(e) => patch({ flowId: e.target.value || null })}
            className="w-full cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 text-xs"
          >
            <option value="">— pick a flow —</option>
            {project.flows.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>Environment</span>
          <select
            value={scenario.environmentId ?? ""}
            onChange={(e) => patch({ environmentId: e.target.value || null })}
            className="w-full cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 text-xs"
          >
            <option value="">Active environment</option>
            {project.environments.map((e) => (
              <option key={e.id} value={e.id}>{e.name}{e.isProduction ? " · PROD" : ""}</option>
            ))}
          </select>
        </label>
      </div>
      {flow && (
        <p className="font-mono text-[10px] text-ivory-500">
          {edgeLabel(project, flow.startEdgeId)} · {flow.lanes.length} lane{flow.lanes.length === 1 ? "" : "s"}
        </p>
      )}
      <div className="grid grid-cols-1 gap-1.5 md:grid-cols-[1fr_110px]">
        <label className="block">
          <span className={fieldLabel}>Seed input payload {!payloadValid && <span className="text-red-700">· invalid JSON</span>}</span>
          <textarea
            value={scenario.inputPayload}
            onChange={(e) => patch({ inputPayload: e.target.value.slice(0, 20000) })}
            spellCheck={false}
            rows={4}
            className={`${monoInput} min-h-16 resize-y`}
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>Expect status</span>
          <input
            type="number"
            min={100}
            max={599}
            value={scenario.expectStatus ?? ""}
            placeholder="—"
            onChange={(e) => {
              const n = Number(e.target.value);
              patch({ expectStatus: e.target.value === "" || !Number.isInteger(n) || n < 100 || n > 599 ? null : n });
            }}
            className={monoInput}
          />
          <span className="mt-1 block text-[10px] leading-snug text-ivory-500">Checked by eye against run evidence.</span>
        </label>
      </div>
      {(scenario.validates ?? []).length > 0 && (
        <div>
          <span className={fieldLabel}>Validates · {(scenario.validates ?? []).length} risk finding{(scenario.validates ?? []).length === 1 ? "" : "s"}</span>
          <ul className="mt-1 space-y-1">
            {(scenario.validates ?? []).map((v, i) => (
              <li key={`${v.rule}:${v.refId}`} className="flex items-center gap-1.5 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-2 py-1">
                <span className="font-mono text-[10px] font-bold text-ivory-950">{v.rule}</span>
                <span className="font-mono text-[10px] text-ivory-500">{v.mode === "reproduce" ? "reproduce" : "withstand"} · {v.refId}</span>
                <button
                  type="button"
                  onClick={() => patch({ validates: (scenario.validates ?? []).filter((_, j) => j !== i) })}
                  aria-label={`Stop validating ${v.rule}`}
                  className="ml-auto rounded px-1.5 text-ivory-400 hover:text-red-700 cursor-pointer"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <span className={fieldLabel}>Mock overrides · {Object.keys(scenario.mockOverrides).length} (for unreachable / not-ready systems)</span>
        {Object.keys(scenario.mockOverrides).length === 0 ? (
          <p className="text-[11px] text-ivory-500">No overrides - the run hits live systems.</p>
        ) : (
          <ul className="space-y-1.5">
            {Object.entries(scenario.mockOverrides).map(([opId, m]) => {
              const found = allOps.find((a) => a.op.id === opId);
              return (
                <li key={opId} className="rounded-lg border border-bronze-500/40 bg-bronze-500/5 p-2">
                  <div className="flex items-center gap-1.5">
                    {found && <span className={methodBadge(found.op.method)}>{found.op.method}</span>}
                    <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-ivory-950">
                      {found ? `${found.systemName} · ${found.op.name}` : `Deleted operation ${opId}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...scenario.mockOverrides };
                        delete next[opId];
                        patch({ mockOverrides: next });
                      }}
                      className="rounded px-1.5 text-ivory-400 hover:text-red-700 cursor-pointer"
                      aria-label="Remove mock override"
                    >
                      ×
                    </button>
                  </div>
                  <div className="mt-1.5 grid grid-cols-[90px_1fr] gap-1.5">
                    <label className="block"><span className={fieldLabel}>Status</span>
                      <input type="number" min={100} max={599} value={m.status}
                        onChange={(e) => patch({ mockOverrides: { ...scenario.mockOverrides, [opId]: { ...m, status: Number(e.target.value) || 200 } } })}
                        className={monoInput} />
                    </label>
                    <label className="block"><span className={fieldLabel}>Latency ms</span>
                      <input type="number" min={0} max={30000} value={m.latencyMs}
                        onChange={(e) => patch({ mockOverrides: { ...scenario.mockOverrides, [opId]: { ...m, latencyMs: Math.max(0, Number(e.target.value) || 0) } } })}
                        className={monoInput} />
                    </label>
                  </div>
                  <label className="mt-1.5 block"><span className={fieldLabel}>Body</span>
                    <textarea value={m.body}
                      onChange={(e) => patch({ mockOverrides: { ...scenario.mockOverrides, [opId]: { ...m, body: e.target.value.slice(0, 20000) } } })}
                      spellCheck={false} rows={3} className={`${monoInput} min-h-12 resize-y`} />
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-1.5 flex gap-1.5">
          <select value={mockOpId} onChange={(e) => setMockOpId(e.target.value)} aria-label="Operation to mock" className="min-w-0 flex-1 cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 text-xs">
            <option value="">— mock an operation —</option>
            {allOps.filter((a) => !scenario.mockOverrides[a.op.id]).map((a) => (
              <option key={a.op.id} value={a.op.id}>{a.systemName} · {a.op.method} {a.op.name}</option>
            ))}
          </select>
          <Button
            size="sm"
            variant="ghost"
            disabled={!mockOpId}
            onClick={() => {
              if (!mockOpId) return;
              patch({ mockOverrides: { ...scenario.mockOverrides, [mockOpId]: { ...BLANK_MOCK } } });
              setMockOpId("");
            }}
          >
            + Mock
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ScenariosTab({ project, mutate, onRunScenario }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDeleteScenario, setPendingDeleteScenario] = useState<string | null>(null);
  const [runs, setRuns] = useState<SystemRunRecord[]>([]);

  useEffect(() => {
    let live = true;
    void listSystemRuns(100)
      .catch(() => [])
      .then((r) => {
        if (live) setRuns(r);
      });
    return () => {
      live = false;
    };
  }, [project.scenarios.length]);

  const latestRun = (scenarioId: string): SystemRunRecord | null => {
    let best: SystemRunRecord | null = null;
    for (const r of runs) {
      if (r.scenarioId !== scenarioId) continue;
      if (!best || r.createdAt > best.createdAt) best = r;
    }
    return best;
  };

  return (
    <div className={panelShell}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-ivory-950">Scenarios · {project.scenarios.length}</h2>
        <span className="text-[11px] text-ivory-500">flow + seed input + mocks + expectation</span>
        <div className="ml-auto">
          <Button
            size="sm"
            onClick={() => {
              const id = newId("scn");
              mutate((p) => ({
                ...p,
                scenarios: [...p.scenarios, { id, name: `Scenario ${p.scenarios.length + 1}`, flowId: p.flows[0]?.id ?? null, environmentId: null, inputPayload: "{}", mockOverrides: {}, expectStatus: null }],
              }));
              setExpandedId(id);
            }}
          >
            + Scenario
          </Button>
        </div>
      </div>

      {project.scenarios.length === 0 ? (
        <p className="mt-3 text-xs text-ivory-500">
          No scenarios yet. Define a happy path once - seed input, mocked remotes, expected status - then replay it before every deploy.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {project.scenarios.map((s) => {
            const expanded = expandedId === s.id;
            const flow = project.flows.find((f) => f.id === s.flowId);
            return (
              <li key={s.id} className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <input
                    value={s.name}
                    onChange={(e) => mutate((p) => ({ ...p, scenarios: p.scenarios.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)) }))}
                    spellCheck={false}
                    aria-label="Scenario name"
                    className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs font-bold text-ivory-950 hover:border-[var(--color-line)] focus:border-bronze-500 focus:outline-none"
                  />
                  <span className="shrink-0 font-mono text-[10px] text-ivory-500">
                    {flow ? flow.name : "no flow"} · {Object.keys(s.mockOverrides).length} mock{Object.keys(s.mockOverrides).length === 1 ? "" : "s"}{s.expectStatus ? ` · expect ${s.expectStatus}` : ""}
                    {(s.validates ?? []).length > 0 && ` · validates ${(s.validates ?? []).map((v) => v.rule).join(", ")}`}
                  </span>
                  {(() => {
                    const last = latestRun(s.id);
                    if (!last || !last.verdict) return null;
                    const tone = last.verdict === "fail" ? "text-red-700" : "text-[#2F6B45]";
                    return (
                      <span title={`Last run ${new Date(last.createdAt).toLocaleString()} ended ${last.status}${last.verdict === "override-pass" ? " (signed override)" : ""}`} className={`shrink-0 font-mono text-[10px] font-bold ${tone}`}>
                        {last.verdict === "override-pass" ? "override-pass" : last.verdict} · {last.status}
                      </span>
                    );
                  })()}
                  <button type="button" onClick={() => setExpandedId(expanded ? null : s.id)} aria-expanded={expanded} className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-ivory-600 hover:bg-ivory-300 cursor-pointer">{expanded ? "▾" : "▸"}</button>
                  <Button size="sm" disabled={!flow} title={flow ? "Apply mocks, seed input, open chain runner" : "Pick a flow first"} onClick={() => onRunScenario(s)}>Run</Button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteScenario(s.id)}
                    aria-label={`Delete scenario ${s.name}`}
                    className="rounded px-1.5 py-0.5 text-ivory-400 hover:text-red-700 cursor-pointer"
                  >
                    ×
                  </button>
                  {pendingDeleteScenario === s.id && (
                    <ConfirmDialog
                      title={`Delete scenario "${s.name}"?`}
                      message="Its seed input and mock overrides are removed. This cannot be undone."
                      confirmLabel="Delete scenario"
                      onCancel={() => setPendingDeleteScenario(null)}
                      onConfirm={() => {
                        setPendingDeleteScenario(null);
                        setExpandedId(null);
                        mutate((p) => ({ ...p, scenarios: p.scenarios.filter((x) => x.id !== s.id) }));
                      }}
                    />
                  )}
                </div>
                {expanded && <ScenarioEditor project={project} scenario={s} mutate={mutate} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
