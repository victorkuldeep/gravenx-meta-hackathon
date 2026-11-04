"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, Controls, ReactFlow, useEdgesState, useNodesState, useReactFlow, type Edge, type EdgeChange, type Node, type NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ChevronLeft, ChevronRight, Diamond, RectangleHorizontal, Square, StickyNote, X } from "lucide-react";
import { SystemGlyph } from "@/components/system-design/SystemNode";
import { SYSTEM_TEMPLATES, type SystemType } from "@/lib/system-design/model";
import {
  bestSides,
  blankSketchNode,
  handleId,
  sketchId,
  type SketchEdge,
  type SketchEdgeKind,
  type SketchNodeKind,
  type SketchSide,
  type StudioSketch,
} from "@/lib/diagram-studio/sketch";

type EdgeDash = NonNullable<SketchEdge["dash"]>;
type EdgeWeight = NonNullable<SketchEdge["weight"]>;
import { registerSketchBridge, sketchSnapshotOf } from "@/lib/ai/sketchBridge";
import { studioNodeTypes } from "./StudioFlowNode";
import Button from "../ui/Button";

/**
 * Studio sketch canvas: freehand architecture drawing. System boxes reuse
 * the System glyphs (sketches already look like System); flowchart shapes
 * are studio-only. Links are static - no animation, no run state.
 *
 * Selection is controlled: the sketch mirror (sel) is the single writer and
 * selected flags echo back into the RF arrays, so a clicked link cannot be
 * cleared by a second racing handler. Select events arrive through the RF
 * change pipeline; identical id sets bail out to avoid render churn.
 */

/**
 * System palette: the full System inventory (19 templates), not a subset -
 * anything promotable to System must be placeable here. Single source:
 * SYSTEM_TEMPLATES, so new system kinds appear automatically.
 */

const SHAPE_BUTTONS: { kind: Exclude<SketchNodeKind, "system">; label: string; Icon: typeof Square }[] = [
  { kind: "process", label: "Process", Icon: Square },
  { kind: "decision", label: "Decision", Icon: Diamond },
  { kind: "terminator", label: "Terminator", Icon: RectangleHorizontal },
  { kind: "note", label: "Note", Icon: StickyNote },
];

const EDGE_KINDS: { id: SketchEdgeKind; label: string }[] = [
  { id: "bezier", label: "Curve" },
  { id: "straight", label: "Straight" },
  { id: "step", label: "Step" },
  { id: "smoothstep", label: "Smooth step" },
];

function iconOf(systemType: SystemType | undefined): string {
  return SYSTEM_TEMPLATES.find((t) => t.systemType === systemType)?.iconKey ?? "plus";
}

function templateName(systemType: SystemType): string {
  return SYSTEM_TEMPLATES.find((t) => t.systemType === systemType)?.name ?? "Custom System";
}

const allNodeTypes = studioNodeTypes;

type Sel = { nodes: string[]; edges: string[] };

const fieldCls =
  "mt-1 w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] font-normal focus:border-[#A98450] focus:outline-none";

/** Inspector link desk: list a box's links and add new ones without dragging. */
function NodeLinks({
  sketch,
  nodeId,
  addLink,
  dropEdge,
}: {
  sketch: StudioSketch;
  nodeId: string;
  addLink: (
    fromId: string,
    toId: string,
    opts: {
      label: string;
      kind: SketchEdgeKind;
      dash: EdgeDash;
      weight: EdgeWeight;
      sourceHandle?: string;
      targetHandle?: string;
    }
  ) => void;
  dropEdge: (id: string) => void;
}) {
  const [targetId, setTargetId] = useState("");
  const [dir, setDir] = useState<"out" | "in">("out");
  const [fromSide, setFromSide] = useState<SketchSide | "auto">("auto");
  const [toSide, setToSide] = useState<SketchSide | "auto">("auto");
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<SketchEdgeKind>("bezier");
  const [dash, setDash] = useState<EdgeDash>("solid");
  const [weight, setWeight] = useState<EdgeWeight>("thin");

  const others = sketch.nodes.filter((n) => n.id !== nodeId);
  const linked = sketch.edges.filter((e) => e.sourceId === nodeId || e.targetId === nodeId);
  const nameOf = (id: string) => sketch.nodes.find((n) => n.id === id)?.label ?? "?";

  const sideOptions: { id: SketchSide | "auto"; label: string }[] = [
    { id: "auto", label: "Auto" },
    { id: "top", label: "Top" },
    { id: "right", label: "Right" },
    { id: "bottom", label: "Bottom" },
    { id: "left", label: "Left" },
  ];

  const submitLink = () => {
    if (!targetId) return;
    const fromId = dir === "out" ? nodeId : targetId;
    const toId = dir === "out" ? targetId : nodeId;
    const from = sketch.nodes.find((n) => n.id === fromId)!;
    const to = sketch.nodes.find((n) => n.id === toId)!;
    const auto = bestSides({ x: from.x, y: from.y }, { x: to.x, y: to.y });
    const fs = fromSide === "auto" ? auto.from : fromSide;
    const ts = toSide === "auto" ? auto.to : toSide;
    addLink(fromId, toId, {
      label: label.trim(),
      kind,
      dash,
      weight,
      sourceHandle: handleId(from.kind, fs, "source"),
      targetHandle: handleId(to.kind, ts, "target"),
    });
    setLabel("");
  };

  return (
    <div className="border-t border-[#EFE9DC] pt-2">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[1.4px] text-[#A39B8E]">
        Links · {linked.length}
      </p>
      {linked.length > 0 && (
        <ul className="mt-1.5 max-h-36 space-y-1 overflow-y-auto pr-0.5">
          {linked.map((e) => {
            const out = e.sourceId === nodeId;
            const other = out ? e.targetId : e.sourceId;
            return (
              <li key={e.id} className="flex items-center gap-1.5 rounded-lg border border-[#E8E2D8] px-2 py-1">
                <span className="font-mono text-[10px] text-[#A39B8E]">{out ? "→" : "←"}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-[#27241F]" title={e.label || nameOf(other)}>
                  {e.label || nameOf(other)}
                </span>
                <button type="button" onClick={() => dropEdge(e.id)} title="Delete link" aria-label={`Delete link ${e.label || nameOf(other)}`}
                  className="rounded p-0.5 text-[#A39B8E] hover:text-[#B3261E] cursor-pointer">
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {others.length > 0 ? (
        <div className="mt-2 space-y-1.5 rounded-lg bg-[#FCFBF7] p-2">
          <div className="grid grid-cols-2 gap-1.5">
            <label className="block text-[11px] font-semibold text-[#27241F]">
              Direction
              <select value={dir} onChange={(e) => setDir(e.target.value as "out" | "in")} className={fieldCls}>
                <option value="out">This → box</option>
                <option value="in">Box → this</option>
              </select>
            </label>
            <label className="block text-[11px] font-semibold text-[#27241F]">
              Box
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={fieldCls} aria-label="Link target box">
                <option value="">Pick…</option>
                {others.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="block text-[11px] font-semibold text-[#27241F]">
              From dot
              <select value={fromSide} onChange={(e) => setFromSide(e.target.value as SketchSide | "auto")} className={fieldCls}>
                {sideOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] font-semibold text-[#27241F]">
              To dot
              <select value={toSide} onChange={(e) => setToSide(e.target.value as SketchSide | "auto")} className={fieldCls}>
                {sideOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-[11px] font-semibold text-[#27241F]">
            Label
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Create Order" className={fieldCls} />
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            <label className="block text-[11px] font-semibold text-[#27241F]">
              Route
              <select value={kind} onChange={(e) => setKind(e.target.value as SketchEdgeKind)} className={fieldCls}>
                {EDGE_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-[11px] font-semibold text-[#27241F]">
              Line
              <select value={dash} onChange={(e) => setDash(e.target.value as EdgeDash)} className={fieldCls}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </label>
            <label className="block text-[11px] font-semibold text-[#27241F]">
              Weight
              <select value={weight} onChange={(e) => setWeight(e.target.value as EdgeWeight)} className={fieldCls}>
                <option value="thin">Thin</option>
                <option value="medium">Medium</option>
                <option value="bold">Bold</option>
              </select>
            </label>
          </div>
          <Button size="sm" onClick={submitLink} disabled={!targetId} title="Add link without dragging">
            + Link
          </Button>
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-[#A39B8E]">Place a second box to link.</p>
      )}
    </div>
  );
}

function sameSel(a: Sel, b: Sel): boolean {
  return a.nodes.join(",") === b.nodes.join(",") && a.edges.join(",") === b.edges.join(",");
}

export function StudioCanvas({
  sketch,
  onChange,
  preview,
  shotRef,
}: {
  sketch: StudioSketch;
  onChange: (next: StudioSketch) => void;
  /** Clean view: connector dots + zoom widget hidden (also what PNG captures). */
  preview: boolean;
  shotRef: { current: HTMLDivElement | null };
}) {
  const flavor = sketch.flavor ?? "hybrid";
  const showSystems = flavor !== "flow";
  const showFlows = flavor !== "system";
  const containerRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, getNodes } = useReactFlow();
  const sketchRef = useRef(sketch);
  useEffect(() => {
    sketchRef.current = sketch;
  }, [sketch]);
  // Stable commit path: the route hands a fresh onChange every render, but
  // canvas callbacks must not rebuild (each rebuild replaces the RF node
  // array and re-fires selection). Everything commits through refs.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>({ nodes: [], edges: [] });
  const [past, setPast] = useState<StudioSketch[]>([]);
  const [future, setFuture] = useState<StudioSketch[]>([]);
  const [rfInstance, setRfInstance] = useState<{ fitView: (opts?: { padding?: number }) => void } | null>(null);
  const [palOpen, setPalOpen] = useState(true);
  const [inspOpen, setInspOpen] = useState(true);
  const draggingRef = useRef(false);

  const commit = useCallback((next: StudioSketch, undoable = true) => {
    if (undoable) {
      setPast((p) => [...p.slice(-49), sketchRef.current]);
      setFuture([]);
    }
    onChangeRef.current(next);
  }, []);

  const undo = useCallback(() => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [sketchRef.current, ...f].slice(0, 50));
    onChangeRef.current(prev);
  }, [past]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, sketchRef.current]);
    onChangeRef.current(next);
  }, [future]);

  // Fit once per sketch: never refit on edits, so committed moves stay put.
  useEffect(() => {
    rfInstance?.fitView({ padding: 0.2 });
  }, [rfInstance, sketch.id]);

  // AI bridge: the agent draws through the same commit path (undoable).
  useEffect(() => {
    registerSketchBridge({
      getSnapshot: () => sketchSnapshotOf(sketchRef.current),
      getSketch: () => sketchRef.current,
      apply: (fn) => {
        try {
          commit(fn(sketchRef.current));
          return { ok: true };
        } catch {
          return { ok: false, error: "Sketch apply failed." };
        }
      },
    });
    return () => registerSketchBridge(null);
  }, [commit, sketch.id]);

  const commitNote = useCallback((id: string, text: string) => {
    setEditingId(null);
    const cur = sketchRef.current.nodes.find((n) => n.id === id);
    if (!cur || cur.label === text) return;
    commit({ ...sketchRef.current, nodes: sketchRef.current.nodes.map((n) => (n.id === id ? { ...n, label: text } : n)) });
  }, [commit]);

  const rfNodes: Node[] = useMemo(
    () =>
      sketch.nodes.map((n): Node => {
        const position = { x: n.x, y: n.y };
        const selected = sel.nodes.includes(n.id);
        if (n.kind === "system") {
          return {
            id: n.id,
            type: "system",
            position,
            selected,
            data: { name: n.label, systemType: n.systemType ?? "custom", iconKey: iconOf(n.systemType), draft: true },
          };
        }
        if (n.kind === "note") {
          return {
            id: n.id,
            type: "note",
            position,
            selected,
            data: {
              text: n.label,
              editing: editingId === n.id,
              onBeginEdit: () => setEditingId(n.id),
              onCommit: (text: string) => commitNote(n.id, text),
              onCancel: () => setEditingId(null),
            },
          };
        }
        return { id: n.id, type: `flow-${n.kind}`, position, selected, data: { label: n.label } };
      }),
    [sketch, editingId, commitNote, sel]
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      sketch.edges.map((e) => ({
        id: e.id,
        source: e.sourceId,
        target: e.targetId,
        selected: sel.edges.includes(e.id),
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
        type: e.kind && e.kind !== "bezier" ? e.kind : undefined,
        // Fat hit area: thin links are hard to click.
        interactionWidth: 30,
        label: e.label || undefined,
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
        labelBgStyle: { fill: "#FFFFFF", fillOpacity: 0.95 },
        labelStyle: { fontSize: 10, fontFamily: "monospace" },
        style: {
          stroke: "#8A8070",
          strokeWidth: e.weight === "bold" ? 2.75 : e.weight === "medium" ? 1.75 : 1,
          strokeDasharray: e.dash === "dotted" ? "2 4" : e.dash === "dashed" ? "8 5" : undefined,
          strokeLinecap: e.dash === "dotted" ? "round" : undefined,
        },
      })),
    [sketch, sel]
  );

  // Live drag state: nodes render FROM here so picks track the pointer;
  // the sketch commits once on drag stop. Replaced wholesale on sketch
  // commits while nobody is dragging. Edges mirror the same pattern so
  // link selection is controlled too.
  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  useEffect(() => {
    if (!draggingRef.current) setNodes(rfNodes);
  }, [rfNodes, setNodes]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);
  useEffect(() => {
    setEdges(rfEdges);
  }, [rfEdges, setEdges]);

  // Single selection writer: RF select events update the mirror, every
  // other change (drag, dimensions) passes through untouched.
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const picks = changes.filter((c) => c.type === "select");
      if (picks.length > 0) {
        setSel((prev) => {
          const ids = new Set(prev.nodes);
          for (const c of picks) {
            if (c.type !== "select") continue;
            if (c.selected) ids.add(c.id);
            else ids.delete(c.id);
          }
          const next = { nodes: [...ids], edges: prev.edges };
          return sameSel(prev, next) ? prev : next;
        });
      }
      onNodesChange(changes);
    },
    [onNodesChange]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const picks = changes.filter((c) => c.type === "select");
      if (picks.length > 0) {
        setSel((prev) => {
          const ids = new Set(prev.edges);
          for (const c of picks) {
            if (c.type !== "select") continue;
            if (c.selected) ids.add(c.id);
            else ids.delete(c.id);
          }
          const next = { nodes: prev.nodes, edges: [...ids] };
          return sameSel(prev, next) ? prev : next;
        });
      }
      onEdgesChange(changes);
    },
    [onEdgesChange]
  );

  const place = useCallback((kind: SketchNodeKind, systemType?: SystemType, label?: string) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const center = rect
      ? screenToFlowPosition({ x: rect.width / 2, y: rect.height / 2 })
      : { x: 400, y: 300 };
    const count = sketchRef.current.nodes.length;
    const at = { x: center.x + ((count % 6) - 2.5) * 140, y: center.y + (Math.floor(count / 6) % 4) * 110 - 110 };
    const node = {
      ...blankSketchNode(kind, at),
      label: label ?? (kind === "system" ? templateName(systemType ?? "custom") : blankSketchNode(kind, at).label),
      systemType: kind === "system" ? (systemType ?? "custom") : undefined,
    };
    commit({ ...sketchRef.current, nodes: [...sketchRef.current.nodes, node] });
  }, [commit, screenToFlowPosition]);

  const onConnectCommit = useCallback(
    (sourceId: string, targetId: string, sourceHandle?: string | null, targetHandle?: string | null) => {
      if (sourceId === targetId) return;
      commit({
        ...sketchRef.current,
        edges: [
          ...sketchRef.current.edges,
          {
            id: sketchId("ske"),
            sourceId,
            targetId,
            sourceHandle: sourceHandle ?? undefined,
            targetHandle: targetHandle ?? undefined,
            label: "",
          },
        ],
      });
    },
    [commit]
  );

  const removeSelection = useCallback(() => {
    const cur = sketchRef.current;
    setSel((prev) => {
      if (prev.nodes.length === 0 && prev.edges.length === 0) return prev;
      const dead = new Set(prev.nodes);
      commit({
        ...cur,
        nodes: cur.nodes.filter((n) => !dead.has(n.id)),
        edges: cur.edges.filter((e) => !dead.has(e.sourceId) && !dead.has(e.targetId) && !prev.edges.includes(e.id)),
      });
      return { nodes: [], edges: [] };
    });
  }, [commit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, removeSelection]);

  const selNode = sketch.nodes.find((n) => n.id === sel.nodes[0]) ?? null;
  const selEdge = sketch.edges.find((e) => e.id === sel.edges[0]) ?? null;

  const setNodeLabel = (id: string, label: string) => {
    const cur = sketchRef.current.nodes.find((n) => n.id === id);
    if (!cur || cur.label === label) return;
    commit({ ...sketchRef.current, nodes: sketchRef.current.nodes.map((n) => (n.id === id ? { ...n, label } : n)) });
  };

  const setNodeSystemType = (id: string, systemType: SystemType) => {
    commit({
      ...sketchRef.current,
      nodes: sketchRef.current.nodes.map((n) => (n.id === id ? { ...n, systemType } : n)),
    });
  };

  const setEdgeLabel = (id: string, label: string) => {
    const cur = sketchRef.current.edges.find((e) => e.id === id);
    if (!cur || cur.label === label) return;
    commit({ ...sketchRef.current, edges: sketchRef.current.edges.map((e) => (e.id === id ? { ...e, label } : e)) });
  };

  const setEdgeKind = (id: string, kind: SketchEdgeKind) => {
    commit({ ...sketchRef.current, edges: sketchRef.current.edges.map((e) => (e.id === id ? { ...e, kind } : e)) });
  };

  const addLink = (
    fromId: string,
    toId: string,
    opts: {
      label: string;
      kind: SketchEdgeKind;
      dash: EdgeDash;
      weight: EdgeWeight;
      sourceHandle?: string;
      targetHandle?: string;
    }
  ) => {
    if (fromId === toId) return;
    const cur = sketchRef.current;
    if (!cur.nodes.some((n) => n.id === fromId) || !cur.nodes.some((n) => n.id === toId)) return;
    commit({
      ...cur,
      edges: [
        ...cur.edges,
        {
          id: sketchId("ske"),
          sourceId: fromId,
          targetId: toId,
          sourceHandle: opts.sourceHandle,
          targetHandle: opts.targetHandle,
          label: opts.label,
          kind: opts.kind === "bezier" ? undefined : opts.kind,
          dash: opts.dash === "solid" ? undefined : opts.dash,
          weight: opts.weight === "thin" ? undefined : opts.weight,
        },
      ],
    });
  };

  const dropEdge = (id: string) => {
    commit({ ...sketchRef.current, edges: sketchRef.current.edges.filter((e) => e.id !== id) });
  };

  const setEdgeStyle = (id: string, dash: EdgeDash | undefined, weight: EdgeWeight | undefined) => {
    commit({
      ...sketchRef.current,
      edges: sketchRef.current.edges.map((e) =>
        e.id === id ? { ...e, ...(dash ? { dash } : null), ...(weight ? { weight } : null) } : e
      ),
    });
  };

  return (
    <div className="flex min-h-0 flex-1 items-stretch gap-[2px]">
      {palOpen ? (
        <div className="no-scrollbar studio-palette-lean flex w-16 shrink-0 flex-col items-center gap-1 overflow-y-auto rounded-xl border border-[#E8E2D8] bg-white p-1.5" role="toolbar" aria-label="Sketch palette">
          <button type="button" onClick={() => setPalOpen(false)} aria-label="Collapse palette" title="Collapse palette"
            className="rounded-md p-1 text-[#A39B8E] hover:text-[#27241F] cursor-pointer">
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          {showSystems && (
            <>
              <p className="font-mono text-[9px] font-medium uppercase tracking-wide text-[#B7AE9E]">Sys</p>
              {SYSTEM_TEMPLATES.map((t) => (
                <button
                  key={t.systemType}
                  type="button"
                  title={`Place ${t.name}`}
                  aria-label={`Place ${t.name}`}
                  onClick={() => place("system", t.systemType)}
                  className="rounded-lg border border-transparent p-1.5 text-[#777168] hover:border-[#E8E2D8] hover:text-[#27241F] transition-colors cursor-pointer"
                >
                  <SystemGlyph iconKey={t.iconKey} />
                </button>
              ))}
            </>
          )}
          {showFlows && (
            <>
              <p className="mt-1 font-mono text-[9px] font-medium uppercase tracking-wide text-[#B7AE9E]">Flow</p>
              {SHAPE_BUTTONS.map(({ kind, label, Icon }) => (
                <button
                  key={kind}
                  type="button"
                  title={`Place ${label}`}
                  aria-label={`Place ${label}`}
                  onClick={() => place(kind)}
                  className="rounded-lg border border-transparent p-1.5 text-[#777168] hover:border-[#E8E2D8] hover:text-[#27241F] transition-colors cursor-pointer"
                >
                  <Icon size={14} strokeWidth={1.5} aria-hidden="true" />
                </button>
              ))}
            </>
          )}
          <p className="mt-1 font-mono text-[9px] font-medium uppercase tracking-wide text-[#B7AE9E]">Edit</p>
          <button type="button" title="Undo (Ctrl+Z)" aria-label="Undo" onClick={undo} disabled={past.length === 0}
            className="rounded-lg border border-transparent p-1.5 text-[#777168] hover:border-[#E8E2D8] hover:text-[#27241F] transition-colors cursor-pointer disabled:opacity-40">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
          </button>
          <button type="button" title="Redo (Ctrl+Y)" aria-label="Redo" onClick={redo} disabled={future.length === 0}
            className="rounded-lg border border-transparent p-1.5 text-[#777168] hover:border-[#E8E2D8] hover:text-[#27241F] transition-colors cursor-pointer disabled:opacity-40">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setPalOpen(true)} aria-label="Expand palette" title="Expand palette"
          className="w-8 shrink-0 rounded-xl border border-[#E8E2D8] bg-white p-1 text-[#A39B8E] hover:text-[#27241F] cursor-pointer">
          <ChevronRight size={14} aria-hidden="true" className="mx-auto" />
        </button>
      )}

      <div
        ref={(el) => {
          containerRef.current = el;
          shotRef.current = el;
        }}
        className={`studio-canvas relative min-h-[420px] min-w-0 flex-1 overflow-hidden rounded-xl border border-[#E8E2D8] bg-[#FAF8F2]${preview ? " studio-preview" : ""}`}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={allNodeTypes}
          nodesConnectable={!preview}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={(c) => {
            if (c.source && c.target) onConnectCommit(c.source, c.target, c.sourceHandle, c.targetHandle);
          }}
          onNodeDragStart={() => {
            draggingRef.current = true;
          }}
          onNodeDragStop={(_, node) => {
            draggingRef.current = false;
            const live = new Map(getNodes().map((n) => [n.id, n.position]));
            const pos = live.get(node.id);
            if (!pos) return;
            const cur = sketchRef.current.nodes.find((n) => n.id === node.id);
            if (!cur || (cur.x === Math.round(pos.x) && cur.y === Math.round(pos.y))) return;
            commit({
              ...sketchRef.current,
              nodes: sketchRef.current.nodes.map((n) => (n.id === node.id ? { ...n, x: Math.round(pos.x), y: Math.round(pos.y) } : n)),
            });
          }}
          onInit={(inst) => setRfInstance(inst)}
          minZoom={0.2}
        >
          <Background gap={22} size={1.2} color="#DDD3BC" bgColor="#FAF8F2" />
          <Controls position="bottom-left" showInteractive={false} />
        </ReactFlow>
      </div>

      {inspOpen ? (
        <aside className="flex w-72 shrink-0 flex-col gap-[2px] overflow-y-auto rounded-xl border border-[#E8E2D8] bg-white p-2" aria-label="Sketch inspector">
          <button type="button" onClick={() => setInspOpen(false)} aria-label="Collapse inspector" title="Collapse inspector"
            className="self-end rounded-md p-1 text-[#A39B8E] hover:text-[#27241F] cursor-pointer">
            <ChevronRight size={14} aria-hidden="true" />
          </button>
          {selNode ? (
            <>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[1.4px] text-[#A39B8E]">
                {selNode.kind === "system" ? "System box" : selNode.kind === "note" ? "Note" : "Flow shape"}
              </p>
              <label className="block text-[12px] font-semibold text-[#27241F]">
                Label
                <input
                  key={selNode.id}
                  defaultValue={selNode.label}
                  onBlur={(e) => setNodeLabel(selNode.id, e.target.value.trim() || selNode.label)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="mt-1 w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] font-normal focus:border-[#A98450] focus:outline-none"
                />
              </label>
              {selNode.kind === "system" && (
                <label className="block text-[12px] font-semibold text-[#27241F]">
                  Type
                  <select
                    value={selNode.systemType ?? "custom"}
                    onChange={(e) => setNodeSystemType(selNode.id, e.target.value as SystemType)}
                    className="mt-1 w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] font-normal focus:border-[#A98450] focus:outline-none"
                  >
                    {SYSTEM_TEMPLATES.map((t) => (
                      <option key={t.systemType} value={t.systemType}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button size="sm" variant="ghost" onClick={removeSelection}>
                Delete selected
              </Button>
              <NodeLinks key={selNode.id} sketch={sketch} nodeId={selNode.id} addLink={addLink} dropEdge={dropEdge} />
            </>
          ) : selEdge ? (
            <>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[1.4px] text-[#A39B8E]">Link</p>
              <label className="block text-[12px] font-semibold text-[#27241F]">
                Label
                <input
                  key={selEdge.id}
                  defaultValue={selEdge.label}
                  placeholder="e.g. Create Order"
                  onBlur={(e) => setEdgeLabel(selEdge.id, e.target.value.trim())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="mt-1 w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] font-normal focus:border-[#A98450] focus:outline-none"
                />
              </label>
              <label className="block text-[12px] font-semibold text-[#27241F]">
                Routing
                <select
                  value={selEdge.kind ?? "bezier"}
                  onChange={(e) => setEdgeKind(selEdge.id, e.target.value as SketchEdgeKind)}
                  className="mt-1 w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] font-normal focus:border-[#A98450] focus:outline-none"
                >
                  {EDGE_KINDS.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[12px] font-semibold text-[#27241F]">
                  Line
                  <select
                    value={selEdge.dash ?? "solid"}
                    onChange={(e) => setEdgeStyle(selEdge.id, e.target.value as EdgeDash, undefined)}
                    className="mt-1 w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] font-normal focus:border-[#A98450] focus:outline-none"
                  >
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                  </select>
                </label>
                <label className="block text-[12px] font-semibold text-[#27241F]">
                  Weight
                  <select
                    value={selEdge.weight ?? "thin"}
                    onChange={(e) => setEdgeStyle(selEdge.id, undefined, e.target.value as EdgeWeight)}
                    className="mt-1 w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] font-normal focus:border-[#A98450] focus:outline-none"
                  >
                    <option value="thin">Thin</option>
                    <option value="medium">Medium</option>
                    <option value="bold">Bold</option>
                  </select>
                </label>
              </div>
              <Button size="sm" variant="ghost" onClick={removeSelection}>
                Delete selected
              </Button>
            </>
          ) : (
            <>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[1.4px] text-[#A39B8E]">Inspector</p>
              <p className="text-[12px] leading-relaxed text-[#777168]">
                {sel.nodes.length + sel.edges.length > 1
                  ? `${sel.nodes.length + sel.edges.length} selected - Delete removes them all.`
                  : "Pick a palette box to place it, drag between boxes to link, click anything to edit its label."}
              </p>
              {(sel.nodes.length + sel.edges.length > 1) && (
                <Button size="sm" variant="ghost" onClick={removeSelection}>
                  Delete selected
                </Button>
              )}
            </>
          )}
        </aside>
      ) : (
        <button type="button" onClick={() => setInspOpen(true)} aria-label="Expand inspector" title="Expand inspector"
          className="w-8 shrink-0 rounded-xl border border-[#E8E2D8] bg-white p-1 text-[#A39B8E] hover:text-[#27241F] cursor-pointer">
          <ChevronLeft size={14} aria-hidden="true" className="mx-auto" />
        </button>
      )}
    </div>
  );
}
