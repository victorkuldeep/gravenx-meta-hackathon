"use client";

/**
 * Flow Lab tab: named run sequences. A flow pins a start edge, the lanes to
 * simulate, and per-edge operation overrides. Running a flow applies it as
 * the chain scope and opens the chain runner - shared simulations replay
 * the same path, e.g. GET → POST as-is vs event-wrapped.
 */

import { useMemo, useState } from "react";
import Button from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { resolveChain, type ChainLane } from "@/lib/system-design/chain";
import { newId, operationsForSystem, type FlowDef, type SystemProject } from "@/lib/system-design/model";
import { edgeLabel, fieldLabel, panelShell, type Mutate } from "./shared";

/** Readable branch path: Salesforce → Middleware → Kafka. */
function lanePath(project: SystemProject, lane: ChainLane): string {
  if (lane.edges.length === 0) return "—";
  const name = (id: string) => project.systems.find((s) => s.id === id)?.name ?? "?";
  return [name(lane.edges[0].sourceId), ...lane.edges.map((e) => name(e.targetId))].join(" → ");
}

interface Props {
  project: SystemProject;
  mutate: Mutate;
  onRunFlow: (flow: FlowDef) => void;
}

function FlowEditor({ project, flow, mutate }: { project: SystemProject; flow: FlowDef; mutate: Mutate }) {
  const lanes = useMemo(() => resolveChain(project, flow.startEdgeId), [project, flow.startEdgeId]);
  const patch = (p: Partial<FlowDef>) =>
    mutate((prev) => ({ ...prev, flows: prev.flows.map((f) => (f.id === flow.id ? { ...f, ...p } : f)) }));

  const laneEdges = useMemo(() => {
    const seen = new Map<string, SystemProject["connections"][number]>();
    for (const n of flow.lanes) {
      for (const e of lanes[n - 1]?.edges ?? []) seen.set(e.id, e);
    }
    return [...seen.values()];
  }, [lanes, flow.lanes]);

  return (
    <div className="mt-2 space-y-2 border-t border-[var(--color-line-soft)] pt-2">
      <div className="flex flex-wrap gap-1.5">
        <label className="block min-w-52 flex-1">
          <span className={fieldLabel}>Starts at (first hop)</span>
          <select
            value={flow.startEdgeId}
            onChange={(e) => patch({ startEdgeId: e.target.value, lanes: [], opByEdge: {} })}
            className="w-full cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 font-mono text-xs"
          >
            {project.connections.map((c) => (
              <option key={c.id} value={c.id}>{edgeLabel(project, c.id)}</option>
            ))}
          </select>
        </label>
      </div>
      {lanes.length === 0 ? (
        <p className="text-[11px] text-ivory-500">Start edge no longer exists - pick another.</p>
      ) : (
        <>
          <div>
            <span className={fieldLabel}>Which branches run ({flow.lanes.length}/{lanes.length})</span>
            <ul className="space-y-1">
              {lanes.map((lane, i) => {
                const on = flow.lanes.includes(i + 1);
                return (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => patch({ lanes: on ? flow.lanes.filter((n) => n !== i + 1) : [...flow.lanes, i + 1].sort((a, b) => a - b) })}
                      aria-pressed={on}
                      className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left cursor-pointer ${on ? "border-ivory-950 bg-ivory-950 text-ivory-100" : "border-[var(--color-line)] bg-white text-ivory-800 hover:border-bronze-500"}`}
                    >
                      <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] font-bold ${on ? "border-ivory-100 bg-bronze-500 text-white" : "border-[var(--color-line)] text-transparent"}`}>✓</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-bold">Path {i + 1}: {lanePath(project, lane)}</span>
                        <span className={`block font-mono text-[10px] ${on ? "text-ivory-300" : "text-ivory-500"}`}>
                          {lane.edges.length} hop{lane.edges.length === 1 ? "" : "s"}{lane.stopped ? ` · ${lane.stopped}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {laneEdges.length > 0 && (
            <div>
              <span className={fieldLabel}>Which API each hop calls (blank = the edge&apos;s own binding)</span>
              <ul className="space-y-1">
                {laneEdges.map((e) => {
                  const groups = operationsForSystem(project, e.sourceId);
                  const ops = groups.flatMap((g) => g.ops.map((o) => ({ ...o, ifaceName: g.iface.name })));
                  return (
                    <li key={e.id} className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ivory-600">{edgeLabel(project, e.id)}</span>
                      <select
                        value={flow.opByEdge[e.id] ?? ""}
                        onChange={(ev) => {
                          const next = { ...flow.opByEdge };
                          if (!ev.target.value) delete next[e.id];
                          else next[e.id] = ev.target.value;
                          patch({ opByEdge: next });
                        }}
                        aria-label={`Operation override for ${edgeLabel(project, e.id)}`}
                        className="w-56 cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-2 py-1 font-mono text-[11px]"
                      >
                        <option value="">Edge binding</option>
                        {ops.map((o) => (
                          <option key={o.id} value={o.id}>{o.method} {o.name} ({o.ifaceName})</option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function FlowsTab({ project, mutate, onRunFlow }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDeleteFlow, setPendingDeleteFlow] = useState<string | null>(null);

  return (
    <div className={panelShell}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-ivory-950">Flow Lab · {project.flows.length}</h2>
        <span className="text-[11px] text-ivory-500">saved end-to-end paths · travel with the project</span>
        <div className="ml-auto flex gap-1.5">
          {project.runScope && (
            <Button
              size="sm"
              variant="ghost"
              title="Save the last chain-runner picks as a flow"
              onClick={() => {
                const id = newId("flow");
                mutate((p) => ({
                  ...p,
                  flows: [...p.flows, { id, name: `Flow ${p.flows.length + 1}`, startEdgeId: project.runScope!.startEdgeId ?? project.connections[0]?.id ?? "", lanes: project.runScope!.lanes, opByEdge: { ...project.runScope!.opByEdge } }],
                }));
                setExpandedId(id);
              }}
            >
              From last run
            </Button>
          )}
          <Button
            size="sm"
            disabled={project.connections.length === 0}
            onClick={() => {
              const start = project.connections[0];
              const count = resolveChain(project, start.id).length;
              const id = newId("flow");
              mutate((p) => ({
                ...p,
                flows: [...p.flows, { id, name: `Flow ${p.flows.length + 1}`, startEdgeId: start.id, lanes: Array.from({ length: count }, (_, i) => i + 1), opByEdge: {} }],
              }));
              setExpandedId(id);
            }}
          >
            + Flow
          </Button>
        </div>
      </div>

      {project.flows.length === 0 ? (
        <p className="mt-3 text-xs text-ivory-500">
          No flows yet. The easiest start: run a chain on the canvas, then save its picks with “From last run”. Or build one by hand: pick where it starts, tick the branches to simulate, choose the API per hop.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {project.flows.map((f) => {
            const expanded = expandedId === f.id;
            const startMissing = !project.connections.some((c) => c.id === f.startEdgeId);
            return (
              <li key={f.id} className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <input
                    value={f.name}
                    onChange={(e) => mutate((p) => ({ ...p, flows: p.flows.map((x) => (x.id === f.id ? { ...x, name: e.target.value } : x)) }))}
                    spellCheck={false}
                    aria-label="Flow name"
                    className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs font-bold text-ivory-950 hover:border-[var(--color-line)] focus:border-bronze-500 focus:outline-none"
                  />
                  <span className="shrink-0 font-mono text-[10px] text-ivory-500">
                    {f.lanes.length} path{f.lanes.length === 1 ? "" : "s"} · {Object.keys(f.opByEdge).length} API pick{Object.keys(f.opByEdge).length === 1 ? "" : "s"}
                  </span>
                  {startMissing && <span className="shrink-0 rounded-md bg-red-700/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-red-700">start edge gone</span>}
                  <button type="button" onClick={() => setExpandedId(expanded ? null : f.id)} aria-expanded={expanded} className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-ivory-600 hover:bg-ivory-300 cursor-pointer">{expanded ? "▾" : "▸"}</button>
                  <Button size="sm" disabled={startMissing || f.lanes.length === 0} onClick={() => onRunFlow(f)}>Run</Button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteFlow(f.id)}
                    aria-label={`Delete flow ${f.name}`}
                    className="rounded px-1.5 py-0.5 text-ivory-400 hover:text-red-700 cursor-pointer"
                  >
                    ×
                  </button>
                  {pendingDeleteFlow === f.id && (
                    <ConfirmDialog
                      title={`Delete flow "${f.name}"?`}
                      message="The run sequence and its lane mapping are removed. This cannot be undone."
                      confirmLabel="Delete flow"
                      onCancel={() => setPendingDeleteFlow(null)}
                      onConfirm={() => {
                        setPendingDeleteFlow(null);
                        setExpandedId(null);
                        mutate((p) => ({ ...p, flows: p.flows.filter((x) => x.id !== f.id) }));
                      }}
                    />
                  )}
                </div>
                {!expanded && !startMissing && (
                  <p className="mt-0.5 truncate font-mono text-[10px] text-ivory-500">{edgeLabel(project, f.startEdgeId)}</p>
                )}
                {expanded && <FlowEditor project={project} flow={f} mutate={mutate} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
