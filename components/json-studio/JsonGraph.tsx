"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Braces, ChevronDown, ChevronUp, Copy, FoldVertical, Link2, ListFilter, ListTree, Maximize2, Minus, PanelRight, Plus, RotateCcw, UnfoldVertical } from "lucide-react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import type { JsonDocument } from "@/lib/json/document";
import { ancestorIds, getNode } from "@/lib/json/document";
import { projectGraph, searchGraphModel, type ChangeTone } from "@/lib/json/graph";
import { stringifyPath } from "@/lib/json/path";
import { diffSegments } from "@/lib/json/diffText";

interface JsonGraphNodeData extends Record<string, unknown> {
  label: string;
  type: string;
  preview: string;
  childCount: number;
  hiddenChildren: number;
  expandable: boolean;
  expanded: boolean;
  tone: ChangeTone;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}

const NODE_W = 232;
const NODE_H = 78;

// Changed nodes draw a burgundy border - the tone dots keep the exact
// change color (added / removed / modified / type) so both read at once.
const TONE_BORDER: Record<ChangeTone, string> = {
  neutral: "border-[#E8E2D8]",
  added: "border-[#722F37]",
  removed: "border-[#722F37]",
  modified: "border-[#722F37]",
  type: "border-[#722F37]",
};

const TONE_DOT: Record<ChangeTone, string> = {
  neutral: "bg-[#A39B8E]",
  added: "bg-[#32815B]",
  removed: "bg-[#B84C42]",
  modified: "bg-[#B98335]",
  type: "bg-[#7A5C9E]",
};

const EDGE_STROKE: Record<ChangeTone, string> = {
  neutral: "#A39B8E",
  added: "#32815B",
  removed: "#B84C42",
  modified: "#B98335",
  type: "#7A5C9E",
};

function toneLabel(t: ChangeTone): string {
  return t === "neutral" ? "unchanged" : t;
}

function JsonGraphNodeInner({ id, data, selected }: NodeProps<Node<JsonGraphNodeData>>) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${data.label}, ${data.type}${data.expandable ? (data.expanded ? ", expanded" : ", collapsed") : ""}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          data.onSelect(id);
        } else if (e.key === "ArrowRight" && data.expandable && !data.expanded) {
          e.preventDefault();
          data.onToggle(id);
        } else if (e.key === "ArrowLeft" && data.expandable && data.expanded) {
          e.preventDefault();
          data.onToggle(id);
        }
      }}
      onClick={() => {
        // Clicking a container both selects it and opens/closes it.
        if (data.expandable) data.onToggle(id);
        data.onSelect(id);
      }}
      className={`w-[232px] rounded-xl border-2 bg-white px-2.5 py-2 shadow-sm transition-colors ${TONE_BORDER[data.tone]} ${data.tone !== "neutral" ? "ring-1 ring-[#722F37]/40" : ""} ${
        selected ? "ring-4 ring-[#A98450]/40" : ""
      }`}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0, width: 2, height: 2, pointerEvents: "none" }} />
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[data.tone]}`} title={toneLabel(data.tone)} aria-hidden="true" />
        {data.expandable && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onToggle(id);
            }}
            aria-label={data.expanded ? "Collapse" : "Expand"}
            className="shrink-0 rounded p-0.5 text-[10px] leading-none text-[#A39B8E] hover:text-[#27241F] cursor-pointer"
          >
            {data.expanded ? "▾" : "▸"}
          </button>
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#27241F]" title={data.label}>
          {data.label}
        </span>
        <span className="shrink-0 rounded border border-[#E8E2D8] bg-[#F8F6F0] px-1 font-mono text-[10px] text-[#777168]">
          {data.type}
        </span>
      </div>
      <p className="mt-0.5 truncate font-mono text-[11px] text-[#777168]" title={data.preview}>
        {data.expandable
          ? `${data.childCount} ${data.childCount === 1 ? "child" : "children"}${data.hiddenChildren > 0 ? ` · +${data.hiddenChildren} more` : ""}`
          : data.preview === ""
            ? "—"
            : data.preview}
      </p>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0, width: 2, height: 2, pointerEvents: "none" }} />
    </div>
  );
}

const JsonGraphNode = memo(JsonGraphNodeInner);

const nodeTypes = { jsonNode: JsonGraphNode };

export interface JsonGraphProps {
  doc: JsonDocument;
  tones?: Map<string, ChangeTone>;
  onRevealInTree?: (path: (string | number)[]) => void;
  /** Controlled selection (Graph Diff sync). Omit for internal state. */
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Render subset + ancestors (change-category filters). */
  includeOnly?: Set<string> | null;
  /** Paired A/B values for the selection: renders an inline change highlight. Diff views only. */
  compareValues?: { oldValue: unknown; newValue: unknown } | null;
}

function layouted(
  doc: JsonDocument,
  expanded: Set<string>,
  tones: Map<string, ChangeTone> | undefined,
  onToggle: (id: string) => void,
  onSelect: (id: string) => void,
  includeOnly?: Set<string> | null
): { nodes: Node<JsonGraphNodeData>[]; edges: Edge[]; pos: Map<string, { x: number; y: number }>; truncated: boolean; visible: number; total: number } {
  const proj = projectGraph(doc, { expanded, tones, includeOnly: includeOnly ?? null });
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 28, ranksep: 64, marginx: 30, marginy: 30 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of proj.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of proj.edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const pos = new Map<string, { x: number; y: number }>();
  const nodes: Node<JsonGraphNodeData>[] = proj.nodes.map((n) => {
    const p = g.node(n.id);
    pos.set(n.id, { x: p.x, y: p.y });
    return {
      id: n.id,
      type: "jsonNode",
      position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 },
      data: {
        label: n.label,
        type: n.type,
        preview: n.preview,
        childCount: n.childCount,
        hiddenChildren: n.hiddenChildren,
        expandable: n.expandable,
        expanded: n.expanded,
        tone: n.tone,
        onToggle,
        onSelect,
      },
    };
  });
  const toneById = new Map(proj.nodes.map((n) => [n.id, n.tone] as const));
  const edges: Edge[] = proj.edges.map((e) => {
    const tone = toneById.get(e.target) ?? "neutral";
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: "default",
      style: { stroke: EDGE_STROKE[tone], strokeWidth: tone === "neutral" ? 1.5 : 2 },
    };
  });
  return { nodes, edges, pos, truncated: proj.truncated, visible: proj.visible, total: proj.total };
}

/**
 * Read-only JSON graph: hierarchical canvas, search across the full
 * model, inspector with copy actions, reveal-in-tree sync.
 */
function JsonGraphFlow({ doc, tones, onRevealInTree, selectedId: controlledId, onSelect, includeOnly, compareValues }: JsonGraphProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<JsonGraphNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const selectedId = controlledId !== undefined ? controlledId : internalSelectedId;
  const setSelectedId = useCallback(
    (id: string | null) => {
      if (onSelect) onSelect(id);
      else setInternalSelectedId(id);
      // Selecting a node always reveals the inspector - hiding stays manual.
      if (id !== null) setInspectorOpen(true);
    },
    [onSelect]
  );
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [diffOnly, setDiffOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [hitIndex, setHitIndex] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const posRef = useRef(new Map<string, { x: number; y: number }>());
  const reducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const { setCenter, fitView, zoomIn, zoomOut } = useReactFlow();

  const onToggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Reset expansion when the document identity changes.
  const docKey = `${doc.rootId}:${doc.size}`;
  const [lastDocKey, setLastDocKey] = useState(docKey);
  useEffect(() => {
    if (docKey !== lastDocKey) {
      setLastDocKey(docKey);
      setExpanded(new Set());
      setSelectedId(null);
    }
  }, [docKey, lastDocKey, setSelectedId]);

  // Changed-nodes-only scope: every changed node plus its ancestors, so a
  // 5-diff needle in a 500-node haystack stays traversable. Intersects with
  // the category filter when both are active.
  const diffOnlySet = useMemo(() => {
    if (!diffOnly || !tones) return null;
    const keep = new Set<string>();
    for (const [id, tone] of tones) {
      if (tone === "neutral") continue;
      let cur: string | null = id;
      const guard = new Set<string>();
      while (cur !== null && !guard.has(cur) && doc.nodes.has(cur)) {
        guard.add(cur);
        keep.add(cur);
        cur = doc.nodes.get(cur)?.parent ?? null;
      }
    }
    return keep;
  }, [diffOnly, tones, doc]);

  const effectiveInclude = useMemo(() => {
    if (diffOnlySet && includeOnly) return new Set([...diffOnlySet].filter((id) => includeOnly.has(id)));
    return diffOnlySet ?? includeOnly;
  }, [diffOnlySet, includeOnly]);

  const laid = useMemo(
    () => layouted(doc, expanded, tones, onToggle, setSelectedId, effectiveInclude),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, expanded, tones, effectiveInclude]
  );

  useEffect(() => {
    posRef.current = laid.pos;
    setNodes(laid.nodes.map((n) => ({ ...n, selected: n.id === selectedId })));
    setEdges(laid.edges);
  }, [laid, selectedId, setNodes, setEdges]);

  // Controlled selection follows with expansion + centering (finding sync).
  const lastFollowed = useRef<string | null>(null);
  useEffect(() => {
    if (controlledId === undefined || controlledId === lastFollowed.current) return;
    lastFollowed.current = controlledId;
    if (!controlledId) return;
    const ancestors = ancestorIds(doc, controlledId);
    if (ancestors.length > 0) {
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const a of ancestors) next.add(a);
        return next;
      });
    }
    window.setTimeout(() => {
      const p = posRef.current.get(controlledId);
      if (p) setCenter(p.x, p.y, { zoom: 1, duration: reducedMotion ? 0 : 250 });
    }, 150);
  }, [controlledId, doc, setCenter, reducedMotion]);

  const hits = useMemo(() => searchGraphModel(doc, query, stringifyPath), [doc, query]);

  const gotoHit = useCallback(
    (index: number) => {
      const hit = hits[index];
      if (!hit) return;
      setHitIndex(index);
      // Expand ancestors so the match renders, then center it.
      const ancestors = ancestorIds(doc, hit.id);
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const a of ancestors) next.add(a);
        return next;
      });
      setSelectedId(hit.id);
      window.setTimeout(() => {
        const p = posRef.current.get(hit.id);
        if (p) setCenter(p.x, p.y, { zoom: 1, duration: reducedMotion ? 0 : 250 });
      }, 60);
    },
    [hits, doc, setCenter, reducedMotion, setSelectedId]
  );

  useEffect(() => {
    setHitIndex(0);
  }, [query]);

  const selected = selectedId ? (getNode(doc, selectedId) ?? null) : null;

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  const expandAll = () => {
    const all = new Set<string>();
    for (const n of doc.nodes.values()) {
      if ((n.type === "object" || n.type === "array") && n.children.length > 0) all.add(n.id);
      if (all.size >= 1500) break;
    }
    setExpanded(all);
    // A blind refit after a big expansion zooms to microscopic nodes and the
    // canvas reads as empty - center the root at a readable zoom instead.
    window.setTimeout(() => {
      const p = posRef.current.get(doc.rootId);
      if (p) setCenter(p.x, p.y, { zoom: 0.85, duration: reducedMotion ? 0 : 250 });
      else fitView({ padding: 0.15, maxZoom: 1, duration: reducedMotion ? 0 : 250 });
    }, 120);
  };

  const collapseAll = () => {
    setExpanded(new Set());
    window.setTimeout(() => {
      fitView({ padding: 0.15, maxZoom: 1, duration: reducedMotion ? 0 : 250 });
    }, 60);
  };

  return (
    <div className="relative h-[560px] w-full overflow-hidden rounded-xl border border-[#E8E2D8] bg-[#FAF8F2]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => setSelectedId(node.id)}
        onPaneClick={() => setSelectedId(null)}
        minZoom={0.2}
        fitView
        fitViewOptions={{ padding: 0.15, duration: reducedMotion ? 0 : undefined }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1.2} color="#E3DCCB" bgColor="#FAF8F2" />
        {laid.visible > 50 && (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeColor="#D9CFB6"
            style={{ background: "#FFFFFF", border: "1px solid #E8E2D8", borderRadius: 8 }}
          />
        )}
        <Controls position="bottom-left" />
      </ReactFlow>

      {/* Toolbar - icon only, tooltips carry the labels */}
      <div className="absolute left-3 top-3 z-30 flex flex-wrap items-center gap-1">
        <span className="rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#777168]">
          {laid.visible}/{laid.total} nodes{laid.truncated ? " · capped" : ""}
        </span>
        <ToolBtn label="Zoom in" onClick={() => zoomIn({ duration: reducedMotion ? 0 : 200 })}>
          <Plus size={13} aria-hidden="true" />
        </ToolBtn>
        <ToolBtn label="Zoom out" onClick={() => zoomOut({ duration: reducedMotion ? 0 : 200 })}>
          <Minus size={13} aria-hidden="true" />
        </ToolBtn>
        <ToolBtn label="Fit to view" onClick={() => fitView({ padding: 0.15, maxZoom: 1, duration: reducedMotion ? 0 : 250 })}>
          <Maximize2 size={13} aria-hidden="true" />
        </ToolBtn>
        <ToolBtn
          label="Reset view"
          onClick={() => {
            setExpanded(new Set());
            setSelectedId(null);
            fitView({ padding: 0.15, maxZoom: 1, duration: reducedMotion ? 0 : 250 });
          }}
        >
          <RotateCcw size={13} aria-hidden="true" />
        </ToolBtn>
        <ToolBtn label="Expand all (capped)" onClick={expandAll}>
          <UnfoldVertical size={13} aria-hidden="true" />
        </ToolBtn>
        <ToolBtn label="Collapse all to root" onClick={collapseAll}>
          <FoldVertical size={13} aria-hidden={true} />
        </ToolBtn>
        {tones && (
          <ToolBtn
            label={diffOnly ? "Show all nodes" : "Show changed nodes only"}
            onClick={() => setDiffOnly((v) => !v)}
            active={diffOnly}
          >
            <ListFilter size={13} aria-hidden={true} />
          </ToolBtn>
        )}
      </div>

      {/* Search */}
      <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5">
        <div className="flex items-center gap-1 rounded-lg border border-[#E8E2D8] bg-white px-2 py-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className="text-[#A39B8E]">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits.length > 0) gotoHit((hitIndex + 1) % hits.length);
            }}
            placeholder="Search keys, values, paths…"
            aria-label="Search graph"
            spellCheck={false}
            className="w-40 bg-transparent font-mono text-[12px] focus:outline-none"
          />
          {query !== "" && (
            <span className="font-mono text-[10px] text-[#A39B8E]" aria-live="polite">
              {hits.length === 0 ? "0" : `${Math.min(hitIndex + 1, hits.length)}/${hits.length}`}
            </span>
          )}
        </div>
        {hits.length > 0 && (
          <>
            <ToolBtn label="Previous match" onClick={() => gotoHit((hitIndex - 1 + hits.length) % hits.length)}>
              <ChevronUp size={13} aria-hidden="true" />
            </ToolBtn>
            <ToolBtn label="Next match" onClick={() => gotoHit((hitIndex + 1) % hits.length)}>
              <ChevronDown size={13} aria-hidden="true" />
            </ToolBtn>
          </>
        )}
        <ToolBtn label={inspectorOpen ? "Hide inspector panel" : "Show inspector panel"} onClick={() => setInspectorOpen((v) => !v)} active={!inspectorOpen}>
          <PanelRight size={13} aria-hidden="true" />
        </ToolBtn>
      </div>

      {/* Inspector */}
      {inspectorOpen && selected && (
        <div className="absolute bottom-3 right-3 top-16 z-30 flex w-72 flex-col overflow-hidden rounded-xl border border-[#E8E2D8] bg-white shadow-sm">
          <div className="border-b border-[#E8E2D8] px-3 py-2">
            <p className="truncate text-[13px] font-semibold text-[#27241F]" title={selected.label}>{selected.label}</p>
            <p className="font-mono text-[10px] text-[#A39B8E]">{selected.type}{selected.key !== null ? ` · key ${JSON.stringify(selected.key)}` : " · root"}</p>
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 py-2 text-[12px]">
            <InspectorRow k="Path" v={stringifyPath(selected.path)} mono />
            <InspectorRow k="Parent" v={selected.parent ?? "—"} mono />
            {typeof selected.key === "number" && <InspectorRow k="Index" v={String(selected.key)} mono />}
            {(selected.type === "object" || selected.type === "array") && (
              <InspectorRow k="Children" v={String(selected.children.length)} mono />
            )}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#A39B8E]">Value</p>
              <pre className="mt-0.5 max-h-48 overflow-auto rounded-lg bg-[#F8F6F0] p-2 font-mono text-[11px] text-[#27241F]">
                {JSON.stringify(selected.value, null, 2) ?? "—"}
              </pre>
            </div>
            {compareValues && (
              <ChangeBlock oldValue={compareValues.oldValue} newValue={compareValues.newValue} />
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 border-t border-[#E8E2D8] px-3 py-2">
            <button onClick={() => void copyText(stringifyPath(selected.path), "path")} className="inline-flex items-center gap-1 rounded-md border border-[#E8E2D8] px-2 py-1 text-[11px] hover:border-[#A98450] transition-colors cursor-pointer">
              {copied === "path" ? "Copied" : (<><Link2 size={12} aria-hidden="true" /> Copy path</>)}
            </button>
            <button onClick={() => void copyText(JSON.stringify(selected.value), "value")} className="inline-flex items-center gap-1 rounded-md border border-[#E8E2D8] px-2 py-1 text-[11px] hover:border-[#A98450] transition-colors cursor-pointer">
              {copied === "value" ? "Copied" : (<><Braces size={12} aria-hidden="true" /> Copy JSON value</>)}
            </button>
            {(selected.type === "object" || selected.type === "array") && (
              <button onClick={() => void copyText(JSON.stringify(selected.value, null, 2), "subtree")} className="inline-flex items-center gap-1 rounded-md border border-[#E8E2D8] px-2 py-1 text-[11px] hover:border-[#A98450] transition-colors cursor-pointer">
                {copied === "subtree" ? "Copied" : (<><Copy size={12} aria-hidden="true" /> Copy subtree</>)}
              </button>
            )}
            {onRevealInTree && (
              <button onClick={() => onRevealInTree(selected.path)} className="inline-flex items-center gap-1 rounded-md bg-[#211F1B] px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90 transition-opacity cursor-pointer">
                <ListTree size={12} aria-hidden="true" /> Reveal in tree
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToolBtn({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active ?? undefined}
      className={`rounded-lg border p-1.5 transition-colors cursor-pointer ${active ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] bg-white text-[#777168] hover:text-[#27241F]"}`}
    >
      {children}
    </button>
  );
}

function ChangeBlock({ oldValue, newValue }: { oldValue: unknown; newValue: unknown }) {
  const stra = typeof oldValue === "string" ? oldValue : (JSON.stringify(oldValue, null, 2) ?? "");
  const strb = typeof newValue === "string" ? newValue : (JSON.stringify(newValue, null, 2) ?? "");
  const segs = diffSegments(stra, strb);
  const paint = (side: "a" | "b") => {
    if (!segs) {
      const text = side === "a" ? stra : strb;
      return <pre className="mt-0.5 max-h-40 overflow-auto rounded-lg bg-[#F8F6F0] p-2 font-mono text-[11px] text-[#27241F]">{text}</pre>;
    }
    return (
      <pre className="mt-0.5 max-h-40 overflow-auto rounded-lg bg-[#F8F6F0] p-2 font-mono text-[11px] text-[#27241F] whitespace-pre-wrap break-all">
        {segs
          .filter((s) => (side === "a" ? s.kind !== "add" : s.kind !== "del"))
          .map((s, k) =>
            s.kind === "same" ? (
              <span key={k}>{s.text}</span>
            ) : (
              <span key={k} className={s.kind === "del" ? "bg-[#F3D9D4] text-[#8B4049]" : "bg-[#D9EBDE] text-[#2F7D4F]"}>
                {s.text}
              </span>
            )
          )}
      </pre>
    );
  };
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#A39B8E]">Change A to B</p>
      <div className="mt-0.5 space-y-1.5">
        <div>
          <p className="font-mono text-[10px] text-[#A39B8E]">A</p>
          {paint("a")}
        </div>
        <div>
          <p className="font-mono text-[10px] text-[#A39B8E]">B</p>
          {paint("b")}
        </div>
      </div>
    </div>
  );
}

function InspectorRow({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#A39B8E]">{k}</p>
      <p className={`break-all text-[12px] text-[#27241F] ${mono ? "font-mono text-[11px]" : ""}`}>{v}</p>
    </div>
  );
}

export function JsonGraph(props: JsonGraphProps) {
  return (
    <ReactFlowProvider>
      <JsonGraphFlow {...props} />
    </ReactFlowProvider>
  );
}
