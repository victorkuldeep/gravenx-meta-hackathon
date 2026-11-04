"use client";

/**
 * API Catalog tab: every operation defined anywhere in the project - from a
 * node inspector, an edge binding, or this tab - lands here automatically
 * because the catalog reads the same project.operations registry. Search,
 * edit, mock, test, locate on canvas, or bind to edges.
 */

import { useEffect, useMemo, useState } from "react";
import Button from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import Input from "../../ui/Input";
import { listSystemRuns } from "@/lib/system-design/runStore";
import {
  newId,
  type OperationHeader,
  type OperationMethod,
  type SystemOperation,
  type SystemProject,
} from "@/lib/system-design/model";
import { edgeLabel, fieldLabel, methodBadge, monoInput, panelShell, textInput, type Mutate } from "./shared";

const METHODS: OperationMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "EVENT", "QUERY"];

interface Props {
  project: SystemProject;
  mutate: Mutate;
  onTest: (opId: string) => void;
  onLocate: (systemId: string) => void;
  onBind: (opId: string) => void;
}

function MockEditor({ op, onChange }: { op: SystemOperation; onChange: (patch: Partial<SystemOperation>) => void }) {
  const [open, setOpen] = useState(!!op.mock);
  if (!open && !op.mock) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          onChange({ mock: { status: 200, body: "{}", latencyMs: 0 } });
        }}
        className="rounded-lg border border-dashed border-[var(--color-line)] px-2 py-1 text-[11px] font-semibold text-ivory-600 hover:border-bronze-500 hover:text-ivory-950 cursor-pointer"
      >
        + Add mock response
      </button>
    );
  }
  const m = op.mock ?? { status: 200, body: "{}", latencyMs: 0 };
  return (
    <div className="rounded-lg border border-bronze-500/40 bg-bronze-500/5 p-2">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[11px] font-bold text-ivory-950">Mock response <span className="font-normal text-ivory-500">· served with zero network</span></p>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            onChange({ mock: undefined });
          }}
          className="text-[11px] font-semibold text-red-700 hover:underline cursor-pointer"
        >
          Remove mock
        </button>
      </div>
      <div className="mt-1.5 grid grid-cols-[90px_1fr] gap-1.5">
        <label className="block">
          <span className={fieldLabel}>Status</span>
          <input
            type="number"
            min={100}
            max={599}
            value={m.status}
            onChange={(e) => onChange({ mock: { ...m, status: Number(e.target.value) || 200 } })}
            className={monoInput}
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>Latency ms</span>
          <input
            type="number"
            min={0}
            max={30000}
            value={m.latencyMs}
            onChange={(e) => onChange({ mock: { ...m, latencyMs: Math.max(0, Number(e.target.value) || 0) } })}
            className={monoInput}
          />
        </label>
      </div>
      <label className="mt-1.5 block">
        <span className={fieldLabel}>Body</span>
        <textarea
          value={m.body}
          onChange={(e) => onChange({ mock: { ...m, body: e.target.value.slice(0, 20000) } })}
          spellCheck={false}
          rows={4}
          className={`${monoInput} min-h-16 resize-y`}
        />
      </label>
    </div>
  );
}

function HeadersEditor({ op, onChange }: { op: SystemOperation; onChange: (headers: OperationHeader[]) => void }) {
  const rows = op.headers ?? [];
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className={fieldLabel}>Headers · values as $env.NAME refs, never literals</span>
        {rows.length < 20 && (
          <button
            type="button"
            onClick={() => onChange([...rows, { key: "", value: "" }])}
            className="text-[11px] font-semibold text-bronze-600 hover:text-bronze-700 cursor-pointer"
          >
            + Header
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-ivory-500">No stored headers.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((h, i) => (
            <li key={i} className="flex gap-1">
              <input
                value={h.key}
                onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
                placeholder="X-Api-Key"
                spellCheck={false}
                aria-label={`Header ${i + 1} name`}
                className={`${monoInput} w-36`}
              />
              <input
                value={h.value}
                onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))}
                placeholder="$env.ZSP_TOKEN"
                spellCheck={false}
                aria-label={`Header ${i + 1} value`}
                className={monoInput}
              />
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                aria-label={`Remove header ${i + 1}`}
                className="shrink-0 rounded px-1.5 text-ivory-400 hover:text-red-700 cursor-pointer"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ApiCatalogTab({ project, mutate, onTest, onLocate, onBind }: Props) {
  const [query, setQuery] = useState("");
  const [orphansOnly, setOrphansOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDeleteOp, setPendingDeleteOp] = useState<string | null>(null);
  const [tested, setTested] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState({ systemId: "", interfaceId: "", name: "", path: "", method: "GET" as OperationMethod });

  useEffect(() => {
    let live = true;
    void listSystemRuns(100).then((runs) => {
      if (!live) return;
      setTested(new Set(runs.map((r) => `${r.systemName}␟${r.operationName}`)));
    });
    return () => {
      live = false;
    };
  }, []);

  const usage = useMemo(() => {
    const map = new Map<string, { edgeId: string; end: string }[]>();
    for (const c of project.connections) {
      if (c.sourceOperationId) {
        const l = map.get(c.sourceOperationId) ?? [];
        l.push({ edgeId: c.id, end: "source" });
        map.set(c.sourceOperationId, l);
      }
      if (c.targetOperationId) {
        const l = map.get(c.targetOperationId) ?? [];
        l.push({ edgeId: c.id, end: "target" });
        map.set(c.targetOperationId, l);
      }
    }
    return map;
  }, [project.connections]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return project.systems
      .map((s) => ({
        system: s,
        ifaces: project.interfaces
          .filter((f) => f.systemId === s.id)
          .map((iface) => ({
            iface,
            ops: project.operations.filter((o) => {
              if (o.interfaceId !== iface.id) return false;
              const uses = usage.get(o.id) ?? [];
              if (orphansOnly && uses.length > 0) return false;
              if (!q) return true;
              return `${o.name} ${o.path} ${o.method} ${o.version}`.toLowerCase().includes(q);
            }),
          }))
          .filter((g) => g.ops.length > 0 || (!q && !orphansOnly)),
      }))
      .filter((g) => g.ifaces.some((i) => i.ops.length > 0) || (!q && !orphansOnly && g.ifaces.length > 0));
  }, [project, query, orphansOnly, usage]);

  const patchOp = (opId: string, patch: Partial<SystemOperation>) =>
    mutate((p) => ({ ...p, operations: p.operations.map((o) => (o.id === opId ? { ...o, ...patch } : o)) }));

  const draftSystem = project.systems.find((s) => s.id === draft.systemId) ?? project.systems[0];
  const draftIfaces = project.interfaces.filter((f) => f.systemId === draftSystem?.id);

  return (
    <div className={panelShell}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-ivory-950">API Catalog · {project.operations.length}</h2>
        <span className="text-[11px] text-ivory-500">auto-collected from every node and edge</span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-ivory-700">
            <input type="checkbox" checked={orphansOnly} onChange={(e) => setOrphansOnly(e.target.checked)} />
            Unbound only
          </label>
          <div className="w-56">
            <Input placeholder="Search method, path, name…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search operations" />
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-2.5">
        <p className={fieldLabel}>New operation</p>
        <div className="flex flex-wrap gap-1.5">
          <select value={draftSystem?.id ?? ""} onChange={(e) => setDraft((d) => ({ ...d, systemId: e.target.value, interfaceId: "" }))} aria-label="System for new operation" className="cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 text-xs">
            {project.systems.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select value={draft.interfaceId || draftIfaces[0]?.id || ""} onChange={(e) => setDraft((d) => ({ ...d, interfaceId: e.target.value }))} aria-label="Interface for new operation" className="cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 text-xs">
            {draftIfaces.map((f) => (
              <option key={f.id} value={f.id}>{f.name} · {f.protocol}</option>
            ))}
          </select>
          <select value={draft.method} onChange={(e) => setDraft((d) => ({ ...d, method: e.target.value as OperationMethod }))} aria-label="Method for new operation" className="cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 font-mono text-xs">
            {METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Name" spellCheck={false} aria-label="New operation name" className={`${textInput} w-40`} />
          <input value={draft.path} onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value }))} placeholder="/path" spellCheck={false} aria-label="New operation path" className={`${monoInput} w-52`} />
          <Button
            size="sm"
            disabled={!draftSystem || draftIfaces.length === 0 || !draft.name.trim() || !draft.path.trim()}
            onClick={() => {
              const ifaceId = draft.interfaceId || draftIfaces[0]?.id;
              if (!ifaceId || !draft.name.trim() || !draft.path.trim()) return;
              mutate((p) => ({
                ...p,
                operations: [...p.operations, { id: newId("op"), interfaceId: ifaceId, name: draft.name.trim(), method: draft.method, path: draft.path.trim(), version: "v1" }],
              }));
              setDraft((d) => ({ ...d, name: "", path: "" }));
            }}
          >
            Add
          </Button>
        </div>
        {project.systems.length === 0 && <p className="mt-1 text-[11px] text-ivory-500">Add a system on the canvas first.</p>}
        {project.systems.length > 0 && draftIfaces.length === 0 && (
          <p className="mt-1 text-[11px] text-ivory-500">
            {draftSystem ? `${draftSystem.name} has no interfaces yet - select it on the canvas, then Operations → + Interface.` : "Pick a system above."}
          </p>
        )}
      </div>

      <div className="mt-3 space-y-3">
        {groups.length === 0 && <p className="text-xs text-ivory-500">No operations match.</p>}
        {groups.map(({ system, ifaces }) => (
          <section key={system.id} aria-label={`Operations on ${system.name}`}>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => onLocate(system.id)} title="Show on canvas" className="text-xs font-bold text-ivory-950 hover:text-bronze-700 hover:underline cursor-pointer">
                {system.name}
              </button>
              <span className="font-mono text-[10px] text-ivory-500">{system.systemType}</span>
            </div>
            {ifaces.map(({ iface, ops }) => (
              <div key={iface.id} className="mt-1.5 ml-2 border-l-2 border-[var(--color-line-soft)] pl-2.5">
                <p className="font-mono text-[10px] font-semibold text-ivory-600">{iface.name} · {iface.protocol}{iface.basePath ? ` · ${iface.basePath}` : ""}</p>
                <ul className="mt-1 space-y-1">
                  {ops.map((op) => {
                    const uses = usage.get(op.id) ?? [];
                    // Run history names single-test records "System · Op"
                    // (plus " (mock)" for mocked sends) - match those shapes.
                    const tag = `${system.name} · ${op.name}`;
                    const isTested =
                      tested.has(`${system.name}␟${tag}`) || tested.has(`${system.name}␟${tag} (mock)`);
                    const expanded = expandedId === op.id;
                    return (
                      <li key={op.id} className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className={methodBadge(op.method)}>{op.method}</span>
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ivory-950">
                            {op.name} <span className="font-mono font-normal text-ivory-500">{op.path} · {op.version}</span>
                          </span>
                          {op.mock ? (
                            <span className="rounded-md bg-bronze-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-bronze-700">MOCK</span>
                          ) : (
                            <span className="rounded-md bg-green-700/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-green-800">LIVE</span>
                          )}
                          <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${uses.length > 0 ? "bg-green-700/10 text-green-800" : "bg-ivory-500/10 text-ivory-600"}`}>
                            {uses.length > 0 ? `${uses.length} edge${uses.length > 1 ? "s" : ""}` : "unbound"}
                          </span>
                          {isTested && (
                            <span className="rounded-md bg-ivory-950 px-1.5 py-0.5 font-mono text-[10px] font-bold text-ivory-100">tested</span>
                          )}
                          <button type="button" onClick={() => onTest(op.id)} title="Test this operation" className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-bronze-600 hover:bg-bronze-500/10 cursor-pointer">Test</button>
                          <button type="button" onClick={() => onBind(op.id)} title="Bind to a connection end" className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-bronze-600 hover:bg-bronze-500/10 cursor-pointer">Bind</button>
                          <button type="button" onClick={() => setExpandedId(expanded ? null : op.id)} aria-expanded={expanded} title="Edit operation" className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-ivory-600 hover:bg-ivory-300 cursor-pointer">{expanded ? "▾" : "▸"}</button>
                        </div>
                        {uses.length > 0 && (
                          <p className="mt-0.5 truncate font-mono text-[10px] text-ivory-500">
                            bound: {uses.map((u) => `${edgeLabel(project, u.edgeId)} (${u.end})`).join(" · ")}
                          </p>
                        )}
                        {expanded && (
                          <div className="mt-2 space-y-2 border-t border-[var(--color-line-soft)] pt-2">
                            <div className="grid grid-cols-[90px_1fr_1fr_80px] gap-1.5">
                              <label className="block"><span className={fieldLabel}>Method</span>
                                <select value={op.method} onChange={(e) => patchOp(op.id, { method: e.target.value as OperationMethod })} className="w-full cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 font-mono text-xs">
                                  {METHODS.map((m) => (<option key={m} value={m}>{m}</option>))}
                                </select>
                              </label>
                              <label className="block"><span className={fieldLabel}>Name</span>
                                <input value={op.name} onChange={(e) => patchOp(op.id, { name: e.target.value })} spellCheck={false} className={textInput} />
                              </label>
                              <label className="block"><span className={fieldLabel}>Path</span>
                                <input value={op.path} onChange={(e) => patchOp(op.id, { path: e.target.value })} spellCheck={false} className={monoInput} />
                              </label>
                              <label className="block"><span className={fieldLabel}>Version</span>
                                <input value={op.version} onChange={(e) => patchOp(op.id, { version: e.target.value })} spellCheck={false} className={monoInput} />
                              </label>
                            </div>
                            <label className="block"><span className={fieldLabel}>Sample body (seed for runs)</span>
                              <textarea value={op.sampleBody ?? ""} onChange={(e) => patchOp(op.id, { sampleBody: e.target.value.slice(0, 20000) })} spellCheck={false} rows={3} className={`${monoInput} min-h-12 resize-y`} />
                            </label>
                            <HeadersEditor op={op} onChange={(headers) => patchOp(op.id, { headers })} />
                            <MockEditor op={op} onChange={(patch) => patchOp(op.id, patch)} />
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => setPendingDeleteOp(op.id)}
                                className="text-[11px] font-semibold text-red-700 hover:underline cursor-pointer"
                              >
                                Delete operation
                              </button>
                            </div>
                            {pendingDeleteOp === op.id && (
                              <ConfirmDialog
                                title={`Delete operation "${op.name}"?`}
                                message="Edge bindings to it read as unbound. This cannot be undone."
                                confirmLabel="Delete operation"
                                onCancel={() => setPendingDeleteOp(null)}
                                onConfirm={() => {
                                  setPendingDeleteOp(null);
                                  setExpandedId(null);
                                  mutate((p) => ({
                                    ...p,
                                    operations: p.operations.filter((o) => o.id !== op.id),
                                    connections: p.connections.map((c) => ({
                                      ...c,
                                      sourceOperationId: c.sourceOperationId === op.id ? undefined : c.sourceOperationId,
                                      targetOperationId: c.targetOperationId === op.id ? undefined : c.targetOperationId,
                                    })),
                                  }));
                                }}
                              />
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
