"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, Link2 } from "lucide-react";
import type { ExecutionModel, ExecutionNode } from "@/lib/log-decomposer/model";

const GraphView = dynamic(() => import("./GraphView").then((m) => m.GraphView), {
  ssr: false,
  loading: () => <p className="px-1 py-8 text-center text-[12px] text-ivory-500">Loading graph canvas…</p>,
});

const STATUS_DOT: Record<string, string> = {
  SUCCESS: "bg-emerald-600",
  FAILED: "bg-red-600",
  WARNING: "bg-amber-500",
  RUNNING: "bg-sky-500",
  UNKNOWN: "bg-ivory-300",
};

const TYPE_COLOR: Record<string, string> = {
  TRANSACTION: "bg-ivory-950",
  TRIGGER: "bg-[#722F37]",
  CODE_UNIT: "bg-bronze-700",
  METHOD: "bg-ivory-600",
  SOQL: "bg-sky-700",
  DML: "bg-amber-600",
  CALLOUT: "bg-violet-700",
  FLOW: "bg-teal-700",
  EXCEPTION: "bg-red-600",
  SYSTEM: "bg-ivory-400",
  ASYNC: "bg-ivory-400",
};

const LINES_PER_PAGE = 1000;
const MAX_TIMELINE_ROWS = 60;

function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;
}

function TreeNode({
  node,
  byId,
  depth,
  selectedId,
  expanded,
  onToggle,
  onSelect,
}: {
  node: ExecutionNode;
  byId: Map<string, ExecutionNode>;
  depth: number;
  selectedId: string | null;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const kids = node.children.map((c) => byId.get(c)).filter((n): n is ExecutionNode => !!n);
  const open = expanded.has(node.id);
  const selected = node.id === selectedId;
  return (
    <li>
      <div className="flex items-center gap-1.5">
        {kids.length > 0 ? (
          <button
            type="button"
            onClick={() => onToggle(node.id)}
            aria-label={open ? "Collapse" : "Expand"}
            className="inline-flex w-4 shrink-0 cursor-pointer items-center justify-center rounded p-0.5 text-ivory-500 hover:bg-ivory-100"
          >
            {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          style={{ marginLeft: depth * 10 }}
          className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left cursor-pointer ${
            selected ? "bg-[#FDF9F1] ring-1 ring-inset ring-[#722F37]" : "hover:bg-ivory-100"
          }`}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[node.status] ?? STATUS_DOT.UNKNOWN}`} title={node.status} />
          <span className={`shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white ${TYPE_COLOR[node.type] ?? TYPE_COLOR.SYSTEM}`}>
            {node.type === "CODE_UNIT" ? "UNIT" : node.type}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ivory-950" title={node.label}>
            {node.label}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-ivory-500">{fmtMs(node.durationMs)}</span>
        </button>
      </div>
      {open && kids.length > 0 && (
        <ul>
          {kids.map((k) => (
            <TreeNode key={k.id} node={k} byId={byId} depth={depth + 1} selectedId={selectedId} expanded={expanded} onToggle={onToggle} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function ExplorePanel({
  execution,
  selectedNodeId,
  onSelectNode,
  selectedLine,
  onSelectLine,
  chain = [],
  onOpenChainLog,
}: {
  execution: ExecutionModel;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  selectedLine: number | null;
  onSelectLine: (line: number | null) => void;
  /** Same-request siblings, oldest first; strip hides when the log stands alone. */
  chain?: { id: string; operation: string; status: string; current: boolean }[];
  onOpenChainLog?: (salesforceLogId: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(execution.rootIds));
  const [rawPage, setRawPage] = useState(0);
  const [rawSearch, setRawSearch] = useState("");
  const [rawTheme, setRawTheme] = useState<"light" | "dark">("light");
  const rawDark = rawTheme === "dark";
  const [view, setView] = useState<"tree" | "graph">("tree");

  const byId = useMemo(() => new Map(execution.nodes.map((n) => [n.id, n])), [execution]);
  const selected = selectedNodeId ? (byId.get(selectedNodeId) ?? null) : null;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const categories = useMemo(() => {
    const s = new Set(execution.events.map((e) => e.category));
    return ["all", ...[...s].sort()];
  }, [execution]);

  const visibleEvents = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rq = rawSearch.trim().toLowerCase();
    return execution.events.filter((e) => {
      if (category !== "all" && e.category !== category) return false;
      if (q && !`${e.type} ${e.raw}`.toLowerCase().includes(q)) return false;
      if (rq && !e.raw.toLowerCase().includes(rq)) return false;
      return true;
    });
  }, [execution, filter, category, rawSearch]);

  const selectedEventLines = useMemo(() => {
    if (!selected) return new Set<number>();
    const s = new Set<number>();
    for (const eid of selected.eventIds) {
      const e = execution.events.find((ev) => ev.id === eid);
      if (e) s.add(e.line);
    }
    return s;
  }, [selected, execution]);

  const lines = useMemo(() => {
    const all = new Map<number, string>();
    for (const e of visibleEvents) all.set(e.line, e.raw);
    return [...all.entries()].sort((a, b) => a[0] - b[0]);
  }, [visibleEvents]);

  const pageCount = Math.max(1, Math.ceil(lines.length / LINES_PER_PAGE));
  const page = Math.min(rawPage, pageCount - 1);
  const pageLines = lines.slice(page * LINES_PER_PAGE, (page + 1) * LINES_PER_PAGE);

  /** First event category per raw line - drives severity tinting in the viewer. */
  const lineCategory = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of execution.events) {
      if (!m.has(e.line)) m.set(e.line, e.category);
    }
    return m;
  }, [execution]);

  const lineTextClass = (line: number, isSel: boolean): string => {
    if (isSel) return "bg-[#722F37] text-white";
    const cat = lineCategory.get(line);
    if (cat === "EXCEPTION") return rawDark ? "text-red-300 hover:bg-ivory-800" : "text-red-700 hover:bg-red-50";
    if (cat === "LIMIT") return rawDark ? "text-amber-300 hover:bg-ivory-800" : "text-amber-800 hover:bg-amber-50";
    return rawDark ? "text-ivory-200 hover:bg-ivory-800" : "text-ivory-900 hover:bg-[#F4EFE6]";
  };

  const timelineRows = useMemo(() => {
    const total = execution.metadata.durationMs ?? 0;
    return execution.nodes
      .filter((n) => (n.durationMs ?? 0) > 0 && n.startMs !== undefined && execution.metadata.startMs !== undefined)
      .sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0))
      .slice(0, MAX_TIMELINE_ROWS)
      .map((n) => ({
        node: n,
        left: total > 0 ? ((n.startMs! - execution.metadata.startMs!) / total) * 100 : 0,
        width: Math.max(total > 0 ? ((n.durationMs ?? 0) / total) * 100 : 0, 0.5),
      }));
  }, [execution]);

  const jumpToEvent = (line: number) => {
    onSelectLine(line);
    const idx = lines.findIndex(([l]) => l === line);
    if (idx >= 0) setRawPage(Math.floor(idx / LINES_PER_PAGE));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {chain.length > 1 && (
        <section
          aria-label="Request chain"
          className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2"
        >
          <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[#722F37]">
            <Link2 size={12} aria-hidden="true" /> Chain · oldest first
          </span>
          {chain.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1.5">
              {i > 0 && <ChevronRight size={10} aria-hidden="true" className="text-ivory-400" />}
              <button
                type="button"
                onClick={() => onOpenChainLog?.(c.id)}
                title={`${c.operation} · ${c.status}`}
                aria-current={c.current || undefined}
                className={`cursor-pointer rounded-full border px-2 py-0.5 font-mono text-[10px] ${
                  c.current ? "border-[#722F37] bg-[#722F37] text-white" : "border-[var(--color-line)] bg-white hover:border-bronze-600"
                }`}
              >
                {i + 1} · {c.operation.length > 30 ? `${c.operation.slice(0, 30)}…` : c.operation}
              </button>
            </span>
          ))}
        </section>
      )}
      <div className="flex min-h-0 flex-col gap-3">
        <section className="flex max-h-[38vh] flex-col rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-bold text-ivory-950">Execution {view === "tree" ? "tree" : "flow"}</h3>
            <span className="text-[11px] text-ivory-500">
              {execution.nodes.length} nodes · {execution.events.length} events
              {execution.unknownEventCount > 0 ? ` · ${execution.unknownEventCount} unknown` : ""}
              {" · select a node to inspect"}
            </span>
            <span className="flex overflow-hidden rounded-lg border border-[var(--color-line)]" role="group" aria-label="Execution view">
              {(["tree", "graph"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`cursor-pointer px-2.5 py-1 text-[11px] font-bold capitalize ${view === v ? "bg-ivory-950 text-white" : "bg-white text-ivory-500 hover:text-ivory-950"}`}
                >
                  {v === "graph" ? "Flow" : "Tree"}
                </button>
              ))}
            </span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter tree + raw…"
              aria-label="Filter tree and raw log"
              spellCheck={false}
              className="ml-auto min-w-0 w-44 rounded-lg border border-[var(--color-line)] bg-white px-2 py-1 text-[12px] placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Event category"
              className="rounded-lg border border-[var(--color-line)] bg-white px-1.5 py-1 text-[12px]"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c === "all" ? "All" : c}
                </option>
              ))}
            </select>
          </div>
          {view === "tree" ? (
            <ul className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
              {execution.rootIds.map((id) => {
                const n = byId.get(id);
                return n ? (
                  <TreeNode key={id} node={n} byId={byId} depth={0} selectedId={selectedNodeId} expanded={expanded} onToggle={toggle} onSelect={onSelectNode} />
                ) : null;
              })}
            </ul>
          ) : (
            <div className="mt-2 min-h-[300px] flex-1 overflow-hidden rounded-lg border border-[var(--color-line)]">
              <GraphView execution={execution} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
            </div>
          )}
        </section>

        <section className="isolate overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
          <h3 className="text-[13px] font-bold text-ivory-950">
            Timeline <span className="font-normal text-[11px] text-ivory-500">· {fmtMs(execution.metadata.durationMs)} total</span>
          </h3>
          <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
            {timelineRows.map(({ node, left, width }) => (
              <button
                key={node.id}
                type="button"
                onClick={() => onSelectNode(node.id)}
                title={`${node.label} · ${fmtMs(node.durationMs)}`}
                className={`block w-full cursor-pointer overflow-hidden rounded px-0.5 py-px text-left ${node.id === selectedNodeId ? "bg-[#FDF9F1] ring-1 ring-inset ring-[#722F37]" : "hover:bg-ivory-100"}`}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className={`shrink-0 font-mono text-[10px] text-ivory-600 ${node.id === selectedNodeId ? "w-56 whitespace-normal break-all" : "w-40 truncate"}`}
                  >
                    {node.label}
                  </span>
                  <span className="h-3 min-w-0 flex-1 overflow-hidden rounded bg-ivory-100">
                    <span
                      className={`block h-3 rounded ${node.status === "FAILED" ? "bg-red-500" : "bg-[#4E342E]"}`}
                      style={{ marginLeft: `${Math.min(100, left)}%`, width: `${Math.min(100 - Math.min(100, left), width)}%` }}
                    />
                  </span>
                  <span className="w-14 shrink-0 text-right font-mono text-[10px] text-ivory-500">{fmtMs(node.durationMs)}</span>
                </span>
              </button>
            ))}
            {timelineRows.length === 0 && <p className="text-[12px] text-ivory-500">No timed nodes - the log has no usable timestamps.</p>}
          </div>
        </section>
      </div>

      <div className="flex min-h-0 flex-col gap-3">
        {selected ? (
          <section className="rounded-xl border border-[var(--color-line)] bg-white p-3 shadow-sm">
            <div className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[selected.status] ?? STATUS_DOT.UNKNOWN}`} />
              <p className="min-w-0 flex-1 truncate font-mono text-[12px] font-bold text-ivory-950" title={selected.label}>
                {selected.label}
              </p>
              <button
                type="button"
                onClick={() => onSelectNode(null)}
                aria-label="Clear selection"
                className="cursor-pointer rounded p-0.5 text-ivory-500 hover:bg-ivory-200"
              >
                ×
              </button>
            </div>
            <dl className="mt-1.5 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11px]">
              <dt className="text-ivory-500">Type</dt>
              <dd className="font-mono font-bold text-ivory-950">{selected.type}</dd>
              <dt className="text-ivory-500">Status</dt>
              <dd className="font-bold text-ivory-950">{selected.status}</dd>
              <dt className="text-ivory-500">Duration</dt>
              <dd className="font-mono text-ivory-950">{fmtMs(selected.durationMs)}</dd>
              <dt className="text-ivory-500">Events</dt>
              <dd className="font-mono text-ivory-950">{selected.eventIds.length}</dd>
              {selected.source && (
                <>
                  <dt className="text-ivory-500">Source</dt>
                  <dd className="truncate font-mono text-ivory-950" title={`${selected.source.className}.${selected.source.methodName}`}>
                    {selected.source.className}.{selected.source.methodName}
                  </dd>
                </>
              )}
            </dl>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selected.eventIds.slice(0, 6).map((eid) => {
                const e = execution.events.find((ev) => ev.id === eid);
                return e ? (
                  <button
                    key={eid}
                    type="button"
                    onClick={() => jumpToEvent(e.line)}
                    className="cursor-pointer rounded-full border border-[var(--color-line)] bg-white px-2 py-0.5 font-mono text-[10px] hover:border-bronze-600"
                  >
                    L{e.line + 1} {e.type}
                  </button>
                ) : null;
              })}
            </div>
          </section>
        ) : null}

        <section className="flex min-h-[52vh] flex-col rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-bold text-ivory-950">Raw log</h3>
            <span className="flex overflow-hidden rounded-lg border border-[var(--color-line)]" role="group" aria-label="Raw log theme">
              {(["light", "dark"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setRawTheme(t)}
                  aria-pressed={rawTheme === t}
                  className={`cursor-pointer px-2.5 py-1 text-[11px] font-bold ${rawTheme === t ? "bg-ivory-950 text-white" : "bg-white text-ivory-500 hover:text-ivory-950"}`}
                >
                  {t === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </span>
            <input
              value={rawSearch}
              onChange={(e) => {
                setRawSearch(e.target.value);
                setRawPage(0);
              }}
              placeholder="Search raw…"
              aria-label="Search raw log"
              spellCheck={false}
              className="ml-auto min-w-0 w-36 rounded-lg border border-[var(--color-line)] bg-white px-2 py-1 font-mono text-[12px] placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
            />
            <span className="text-[11px] text-ivory-500">
              p{page + 1}/{pageCount}
            </span>
          </div>
          <div
            className={`mt-2 min-h-0 flex-1 overflow-y-auto rounded-lg p-2 font-mono text-[11px] leading-relaxed ${
              rawDark ? "bg-ivory-950" : "border border-[var(--color-line)] bg-white"
            }`}
          >
            {pageLines.map(([line, raw]) => {
              const isSel = selectedLine === line || selectedEventLines.has(line);
              return (
                <button
                  key={line}
                  type="button"
                  onClick={() => onSelectLine(line)}
                  title={lineCategory.get(line) === "EXCEPTION" ? "Exception line" : lineCategory.get(line) === "LIMIT" ? "Governor limit line" : undefined}
                  className={`flex w-full cursor-pointer gap-2 rounded px-1 text-left ${lineTextClass(line, isSel)}`}
                >
                  <span className={`w-12 shrink-0 select-none text-right ${isSel ? "text-white" : rawDark ? "text-ivory-500" : "text-ivory-400"}`}>
                    {line + 1}
                  </span>
                  <span className="min-w-0 flex-1 break-all whitespace-pre-wrap">{raw}</span>
                </button>
              );
            })}
            {pageLines.length === 0 && (
              <p className={`px-1 py-4 text-center ${rawDark ? "text-ivory-400" : "text-ivory-500"}`}>No lines match the current filter.</p>
            )}
          </div>
          {pageCount > 1 ? (
            <div className="mt-2 flex items-center gap-1.5">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setRawPage(0)}
                aria-label="First raw page"
                className="cursor-pointer rounded border border-[var(--color-line)] p-1.5 disabled:cursor-default disabled:opacity-40"
              >
                <ChevronsLeft size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setRawPage(page - 1)}
                aria-label="Previous raw page"
                className="cursor-pointer rounded border border-[var(--color-line)] p-1.5 disabled:cursor-default disabled:opacity-40"
              >
                <ChevronLeft size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                disabled={page >= pageCount - 1}
                onClick={() => setRawPage(page + 1)}
                aria-label="Next raw page"
                className="cursor-pointer rounded border border-[var(--color-line)] p-1.5 disabled:cursor-default disabled:opacity-40"
              >
                <ChevronRight size={13} aria-hidden="true" />
              </button>
              <span className="ml-auto text-[11px] text-ivory-500">{lines.length.toLocaleString()} matching lines</span>
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-ivory-500">{lines.length.toLocaleString()} lines · fits on one page</p>
          )}
        </section>
      </div>
    </div>
  );
}
