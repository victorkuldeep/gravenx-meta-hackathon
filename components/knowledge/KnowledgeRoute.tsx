"use client";

import { useEffect, useMemo, useState } from "react";
import { loadGraphIndex } from "@/lib/graph/load";
import type { GraphEdge, GraphIndex, GraphNode } from "@/lib/graph/index";
import { graphKindLabel, graphNodeHref, GRAPH_SURFACE_LABELS } from "@/lib/graph/links";

/**
 * Knowledge tab: the architecture repository as one browsable index.
 * Records on the left, the selected record's inbound/outbound references
 * on the right, unresolved references honestly listed at the bottom.
 * Read-only - every jump link lands where the record is edited.
 */

const SURFACES = ["system", "wireframe", "sequence", "decision", "requirement", "console", "mapping", "schema", "draw"] as const;

function isRecord(n: GraphNode): boolean {
  return !!n.recordId || n.kind === "external-issue";
}

function EdgeRow({ index, edge, self }: { index: GraphIndex; edge: GraphEdge; self: string }) {
  const other = index.nodes.find((n) => n.key === (edge.from === self ? edge.to : edge.from));
  if (!other) return null;
  const href = graphNodeHref(other);
  const body = (
    <>
      <span className="font-mono text-[9px] uppercase text-[#A39B8E]">
        {GRAPH_SURFACE_LABELS[other.surface] ?? other.surface} · {graphKindLabel(other.kind)}
      </span>{" "}
      <span className="font-medium text-[#27241F]">{other.name}</span>
      {edge.label && <span className="text-[#777168]"> — {edge.label}</span>}
      {edge.resolution !== "id" && <span className="font-mono text-[9px] text-[#A39B8E]"> ({edge.resolution})</span>}
      {other.stub && <span className="font-mono text-[9px] text-[#A39B8E]"> (missing)</span>}
    </>
  );
  return (
    <li className="text-[12px] leading-relaxed">
      {href ? (
        <a href={href} className="hover:text-[#8A6A2F] hover:underline">
          {body}
        </a>
      ) : (
        body
      )}
    </li>
  );
}

export function KnowledgeRoute() {
  const [index, setIndex] = useState<GraphIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [surface, setSurface] = useState<string>("all");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadGraphIndex()
      .then((g) => {
        if (live) setIndex(g);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  // Deep link: /knowledge?node=<key> opens the record.
  useEffect(() => {
    try {
      const k = new URLSearchParams(window.location.search).get("node");
      if (k) setSelected(k);
    } catch {
      /* ignore */
    }
  }, []);

  const records = useMemo(() => {
    if (!index) return [];
    const q = query.trim().toLowerCase();
    return index.nodes
      .filter((n) => isRecord(n))
      .filter((n) => (surface === "all" ? true : n.surface === surface))
      .filter((n) => (!q ? true : n.name.toLowerCase().includes(q) || n.key.toLowerCase().includes(q)))
      .sort((a, b) => a.surface.localeCompare(b.surface) || a.name.localeCompare(b.name));
  }, [index, query, surface]);

  const node = index?.nodes.find((n) => n.key === selected) ?? null;
  const inbound = useMemo(() => index?.edges.filter((e) => e.to === selected) ?? [], [index, selected]);
  const outbound = useMemo(() => index?.edges.filter((e) => e.from === selected) ?? [], [index, selected]);
  const refIssues = useMemo(() => index?.unresolved.filter((u) => u.from === selected) ?? [], [index, selected]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h2 className="text-[15px] font-semibold text-[#27241F]">Knowledge</h2>
          <p className="text-[12px] text-[#777168]">
            {index ? (
              <>
                {records.length} records · {index.edges.length} links · {index.unresolved.length} unresolved
              </>
            ) : failed ? (
              "Index unavailable in this browser."
            ) : (
              "Reading the architecture…"
            )}
          </p>
        </div>
        <div className="ml-auto flex gap-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search records…"
            spellCheck={false}
            aria-label="Search records"
            className="w-44 rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[12px] text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none"
          />
          <select
            value={surface}
            onChange={(e) => setSurface(e.target.value)}
            aria-label="Surface filter"
            className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] font-semibold text-[#27241F] focus:border-[#C9A86A] focus:outline-none"
          >
            <option value="all">All surfaces</option>
            {SURFACES.map((s) => (
              <option key={s} value={s}>
                {GRAPH_SURFACE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-h-0 rounded-xl border border-[#E8E2D8] bg-white">
          <ul className="max-h-[60vh] divide-y divide-[#F0EBE0] overflow-y-auto">
            {records.map((r) => (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => setSelected(r.key)}
                  aria-pressed={selected === r.key}
                  className={`block w-full cursor-pointer px-3 py-2 text-left transition-colors ${
                    selected === r.key ? "bg-[#F5EEDF]" : "hover:bg-[#FBFAF7]"
                  }`}
                >
                  <span className="block truncate text-[13px] font-semibold text-[#27241F]">{r.name}</span>
                  <span className="block truncate font-mono text-[10px] text-[#A39B8E]">
                    {GRAPH_SURFACE_LABELS[r.surface] ?? r.surface} · {graphKindLabel(r.kind)}
                  </span>
                </button>
              </li>
            ))}
            {records.length === 0 && index && (
              <li className="px-3 py-6 text-center text-[12px] text-[#A39B8E]">No records match - log work on any canvas first.</li>
            )}
          </ul>
        </div>

        <div className="min-h-0 rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
          {!node ? (
            <p className="py-8 text-center text-[12px] text-[#A39B8E]">Pick a record to see everything pointing at it - and everything it points at.</p>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
                  {GRAPH_SURFACE_LABELS[node.surface] ?? node.surface} · {graphKindLabel(node.kind)}
                </p>
                <h3 className="mt-0.5 text-[15px] font-semibold text-[#27241F]">{node.name}</h3>
                {(() => {
                  const href = graphNodeHref(node);
                  return href ? (
                    <a href={href} className="text-[12px] font-semibold text-[#8A6A2F] hover:underline">
                      Open in {GRAPH_SURFACE_LABELS[node.surface] ?? node.surface} →
                    </a>
                  ) : null;
                })()}
              </div>
              <div>
                <h4 className="font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Used by · {inbound.length}</h4>
                {inbound.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {index && inbound.map((e, i) => <EdgeRow key={`${e.from}-${i}`} index={index} edge={e} self={node.key} />)}
                  </ul>
                ) : (
                  <p className="mt-1 text-[12px] text-[#A39B8E]">Nothing references this record yet.</p>
                )}
              </div>
              <div>
                <h4 className="font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Uses · {outbound.length}</h4>
                {outbound.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {index && outbound.map((e, i) => <EdgeRow key={`${e.to}-${i}`} index={index} edge={e} self={node.key} />)}
                  </ul>
                ) : (
                  <p className="mt-1 text-[12px] text-[#A39B8E]">This record references nothing.</p>
                )}
              </div>
              {refIssues.length > 0 && (
                <div>
                  <h4 className="font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Unresolved · {refIssues.length}</h4>
                  <ul className="mt-1 space-y-0.5">
                    {refIssues.map((u, i) => (
                      <li key={`${u.raw}-${i}`} className="font-mono text-[11px] text-[#A02C2C]">
                        {u.surface}: {u.name && u.name !== u.raw ? `${u.name} (${u.raw})` : u.raw}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {index && index.unresolved.length > 0 && (
        <details className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-2.5">
          <summary className="cursor-pointer text-[12px] font-semibold text-[#777168]">
            {index.unresolved.length} dangling references studio-wide - imports, renames and deletions surface here
          </summary>
          <ul className="mt-1.5 max-h-48 space-y-0.5 overflow-y-auto">
            {index.unresolved.slice(0, 60).map((u, i) => (
              <li key={`${u.from}-${u.raw}-${i}`} className="font-mono text-[11px] text-[#777168]">
                {u.surface}: {u.name && u.name !== u.raw ? `${u.name} (${u.raw})` : u.raw}
              </li>
            ))}
            {index.unresolved.length > 60 && (
              <li className="font-mono text-[11px] text-[#A39B8E]">…and {index.unresolved.length - 60} more</li>
            )}
          </ul>
        </details>
      )}
    </div>
  );
}
