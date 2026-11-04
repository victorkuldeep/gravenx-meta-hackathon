"use client";

import { useEffect, useMemo, useState } from "react";
import type { GraphEdge, GraphIndex, GraphNode } from "@/lib/graph/index";
import { loadGraphIndex } from "@/lib/graph/load";
import { graphKindLabel, graphNodeHref, GRAPH_SURFACE_LABELS } from "@/lib/graph/links";

const EDGE_VERB: Record<GraphEdge["kind"], string> = {
  contains: "contains",
  connects: "connects to",
  binds: "binds",
  invokes: "invokes",
  "maps-to": "maps to",
  references: "references",
  links: "linked",
  proposes: "proposes",
  supersedes: "supersedes",
  message: "messages",
};

function Counterpart({ index, edge, self }: { index: GraphIndex; edge: GraphEdge; self: string }) {
  const other = index.nodes.find((n) => n.key === (edge.from === self ? edge.to : edge.from));
  if (!other) return null;
  const href = graphNodeHref(other);
  const label = (
    <>
      <span className="font-mono text-[9px] uppercase text-[#A39B8E]">{GRAPH_SURFACE_LABELS[other.surface] ?? other.surface} · {graphKindLabel(other.kind)}</span>{" "}
      <span className="font-medium text-[#3A352D]">{other.name}</span>
      {other.stub && <span className="font-mono text-[9px] text-[#A39B8E]"> (missing)</span>}
    </>
  );
  return (
    <li className="flex items-baseline gap-1.5 text-[12px]">
      <span className="shrink-0 font-mono text-[10px] text-[#A39B8E]">{EDGE_VERB[edge.kind]}</span>
      {href ? (
        <a href={href} className="min-w-0 flex-1 truncate hover:text-[#8A6A2F] hover:underline">
          {label}
        </a>
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
    </li>
  );
}

/**
 * Self-loading strip for detail panels: reads the live index once, then
 * renders the compact strip for one record. The full record lives in the
 * Knowledge tab - recordHref deep-links it (?node=).
 */
export function RecordWhereUsed({ surface, recordId }: { surface: string; recordId: string }) {
  const [index, setIndex] = useState<GraphIndex | null>(null);
  useEffect(() => {
    let live = true;
    void loadGraphIndex()
      .then((g) => {
        if (live) setIndex(g);
      })
      .catch(() => {
        /* strip stays hidden - the panel works without it */
      });
    return () => {
      live = false;
    };
  }, []);
  if (!index) return null;
  const nodeKey = `${surface}:${recordId}`;
  return (
    <WhereUsedStrip
      index={index}
      nodeKey={nodeKey}
      recordHref={`/knowledge?node=${encodeURIComponent(nodeKey)}`}
    />
  );
}

/**
 * Compact where-used strip: "Used by N · Uses M", expandable to the linked
 * records with jump links. Read-only - links are edited where they live.
 */
export function WhereUsedStrip({ index, nodeKey, recordHref }: { index: GraphIndex; nodeKey: string; recordHref?: string }) {
  const [open, setOpen] = useState(false);
  const node: GraphNode | undefined = useMemo(() => index.nodes.find((n) => n.key === nodeKey), [index, nodeKey]);
  const inbound = useMemo(() => index.edges.filter((e) => e.to === nodeKey), [index, nodeKey]);
  const outbound = useMemo(() => index.edges.filter((e) => e.from === nodeKey), [index, nodeKey]);
  if (!node) return null;
  if (inbound.length === 0 && outbound.length === 0) return null;
  return (
    <div className="rounded-xl border border-[#E8E2D8] bg-[#FBFAF7] px-2.5 py-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-1.5 text-left"
      >
        <span className="font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Where used</span>
        <span className="text-[12px] text-[#777168]">
          Used by <span className="font-semibold text-[#27241F]">{inbound.length}</span> · Uses{" "}
          <span className="font-semibold text-[#27241F]">{outbound.length}</span>
        </span>
        <span className="ml-auto text-[11px] text-[#A39B8E]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {inbound.length > 0 && (
            <ul className="space-y-1">
              {inbound.slice(0, 8).map((e, i) => (
                <Counterpart key={`${e.from}-${e.to}-${i}`} index={index} edge={e} self={nodeKey} />
              ))}
              {inbound.length > 8 && <li className="text-[11px] text-[#A39B8E]">…and {inbound.length - 8} more</li>}
            </ul>
          )}
          {outbound.length > 0 && (
            <ul className="space-y-1 border-t border-[#E8E2D8] pt-1.5">
              {outbound.slice(0, 8).map((e, i) => (
                <Counterpart key={`${e.from}-${e.to}-${i}`} index={index} edge={e} self={nodeKey} />
              ))}
              {outbound.length > 8 && <li className="text-[11px] text-[#A39B8E]">…and {outbound.length - 8} more</li>}
            </ul>
          )}
          {recordHref && (
            <a href={recordHref} className="block text-[12px] font-semibold text-[#8A6A2F] hover:underline">
              Open full record →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
