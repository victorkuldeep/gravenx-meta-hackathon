"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  GRAPH_EDGE_COLOR,
  buildMappingGraph,
  statusLabel,
  type GraphConstantRow,
  type GraphEdge,
  type GraphObjectBox,
} from "@/lib/mapping/graph";
import type { MappingProject } from "@/lib/mapping/types";

const SRC_X = 24;
const SRC_D = 120;
/** Caption block under the circle (name + paths + origin): keep clear. */
const SRC_CAPTION_H = 64;
const COL_X = 400;
const GAP = 28;
const OBJ_HEAD_H = 44;
const FIELD_ROW_H = 32;
const CONST_HEAD_H = 38;
const CONST_ROW_H = 30;

function SourceCircleNode({ data, selected }: NodeProps<Node<{ name: string; origin: string | null; leaves: number; unmapped: number; onOpen: () => void }>>) {
  return (
    <div className="flex w-[150px] flex-col items-center">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          data.onOpen();
        }}
        title="Open the source JSON"
        aria-label={`Open source JSON ${data.name}`}
        className={`relative flex h-[120px] w-[120px] cursor-pointer items-center justify-center rounded-full border-2 bg-white font-mono text-[26px] font-bold text-bronze-700 shadow-[0_8px_28px_-10px_rgba(24,20,12,0.35)] transition-all hover:border-bronze-500 ${
          selected ? "border-bronze-500 shadow-[0_0_0_4px_rgba(154,118,83,0.35)]" : "border-[var(--color-line)]"
        }`}
      >
        {"{}"}
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          style={{ width: 10, height: 10, background: "#9A7653", border: "2px solid #FAF8F2", right: -5 }}
        />
      </button>
      <p className="mt-1.5 max-w-[150px] truncate text-center text-[11px] font-bold text-ivory-950" title={data.name}>
        {data.name}
      </p>
      <p className="font-mono text-[10px] text-ivory-500">
        {data.leaves} paths{data.unmapped > 0 ? ` · ${data.unmapped} unmapped` : " · all mapped"}
      </p>
      {data.origin && (
        <p className="max-w-[150px] truncate font-mono text-[10px] text-bronze-600" title={data.origin}>
          {data.origin}
        </p>
      )}
    </div>
  );
}

function ConstBoxNode({ data, selected }: NodeProps<Node<{ rows: GraphConstantRow[] }>>) {
  return (
    <div
      className={`w-[300px] overflow-hidden rounded-xl border-2 bg-[var(--color-surface)] shadow-[0_8px_28px_-10px_rgba(24,20,12,0.35)] ${
        selected ? "border-bronze-500" : "border-dashed border-bronze-300"
      }`}
    >
      <div className="flex items-center gap-1.5 border-b border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-3" style={{ height: CONST_HEAD_H }}>
        <span className="font-mono text-[12px] font-bold text-bronze-700">“ ”</span>
        <p className="text-[12px] font-bold text-ivory-950">Constants</p>
        <span className="font-mono text-[10px] text-ivory-500">{data.rows.length}</span>
      </div>
      {data.rows.map((r) => (
        <div key={r.id} className="relative flex items-center justify-between gap-2 px-3 hover:bg-bronze-100/50" style={{ height: CONST_ROW_H }} title={`${r.label} = ${r.value}`}>
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ivory-950">{r.label}</span>
          <span className="max-w-[130px] truncate font-mono text-[10px] text-ivory-500">{r.value}</span>
          <Handle
            type="source"
            position={Position.Right}
            id={`c:${r.id}`}
            style={{ width: 8, height: 8, background: "#9A7653", border: "2px solid #FAF8F2", right: -4, top: "50%" }}
          />
        </div>
      ))}
      {data.rows.length === 0 && (
        <p className="px-3 py-2 text-[11px] italic text-ivory-500">No constants - quote a value in Grid to pin one.</p>
      )}
    </div>
  );
}

function ObjectBoxNode({ data, selected }: NodeProps<Node<{ box: GraphObjectBox }>>) {
  const { box } = data;
  const border = selected
    ? "border-bronze-500 shadow-[0_0_0_4px_rgba(154,118,83,0.35)]"
    : box.pending
      ? "border-dashed border-amber-400"
      : "border-[var(--color-line)]";
  return (
    <div
      className={`w-[300px] overflow-hidden rounded-xl border-2 bg-[var(--color-surface)] shadow-[0_8px_28px_-10px_rgba(24,20,12,0.35)] ${border}`}
    >
      <div className="border-b border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-3 py-2" style={{ minHeight: OBJ_HEAD_H }}>
        <p className="truncate text-[13px] font-bold text-ivory-950" title={box.label}>
          {box.label}
          {box.custom && (
            <span className="ml-1.5 rounded border border-bronze-300 bg-bronze-100 px-1 py-px align-middle font-mono text-[9px] font-bold text-bronze-700">
              CUSTOM
            </span>
          )}
          {box.pending && (
            <span className="ml-1.5 rounded border border-amber-300 bg-amber-100 px-1 py-px align-middle font-mono text-[9px] font-bold text-amber-800" title="Not in the captured snapshot - authored, renamed, or recapture needed">
              PENDING
            </span>
          )}
        </p>
        <p className="truncate font-mono text-[10px] text-ivory-500" title={box.objectName}>
          {box.objectName} · {box.fields.length} mapped{box.blind ? " · blind (no snapshot)" : ""}
        </p>
        {box.plans.length > 0 && (
          <p className="mt-0.5 truncate text-[10px] text-bronze-700" title={box.plans.map((p) => p.name).join(", ")}>
            {box.plans.map((p) => p.name).join(" · ")}
          </p>
        )}
      </div>
      {box.fields.map((f) => (
        <div
          key={f.apiName}
          className="relative flex items-center justify-between gap-2 px-3 hover:bg-bronze-100/50"
          style={{ height: FIELD_ROW_H }}
          title={`${f.label} (${f.apiName})${f.plans.length > 0 ? ` - ${f.plans.join(", ")}` : ""}`}
        >
          <Handle
            type="target"
            position={Position.Left}
            id={`f:${f.apiName}`}
            style={{ width: 8, height: 8, background: "#9A7653", border: "2px solid #FAF8F2", left: -4, top: "50%" }}
          />
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ivory-950">{f.label}</span>
          {f.pending && (
            <span className="shrink-0 rounded border border-amber-300 bg-amber-100 px-1 py-px font-mono text-[9px] font-bold text-amber-800" title="Not in the captured snapshot - authored, renamed, or recapture needed">
              new
            </span>
          )}
          <span className="shrink-0 font-mono text-[10px] text-ivory-500">{f.apiName}</span>
        </div>
      ))}
    </div>
  );
}

const nodeTypes = { srcCircle: SourceCircleNode, constBox: ConstBoxNode, objBox: ObjectBoxNode } as const;

function edgeTip(e: GraphEdge): string {
  const from = e.kind === "constant" ? `constant` : (e.sourceLeaf ?? "?");
  return `${from} → ${e.objectName}.${e.fieldName} · ${statusLabel(e.status)}${e.rationale ? ` — ${e.rationale}` : ""}`;
}

function GraphFlow({ project, onOpenSource }: { project: MappingProject; onOpenSource: () => void }) {
  const model = useMemo(() => buildMappingGraph(project), [project]);
  const { fitView } = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);

  const freshNodes = useMemo(() => {
    const list: Node[] = [];
    // Left column: source circle, constants box beneath (clear of the
    // circle's name/paths/origin caption block).
    list.push({
      id: "src",
      type: "srcCircle",
      position: { x: SRC_X, y: 24 },
      data: {
        name: model.sourceName,
        origin: model.sourceOrigin,
        leaves: model.leafCount,
        unmapped: model.unmappedCount,
        onOpen: onOpenSource,
      },
    });
    list.push({
      id: "consts",
      type: "constBox",
      position: { x: SRC_X - 75, y: 24 + SRC_D + SRC_CAPTION_H + GAP },
      data: { rows: model.constants },
    });
    // Right column: one box per sObject.
    let y = 0;
    for (const box of model.objects) {
      list.push({ id: box.id, type: "objBox", position: { x: COL_X, y }, data: { box } });
      y += OBJ_HEAD_H + 26 + box.fields.length * FIELD_ROW_H + 8 + GAP;
    }
    return list;
  }, [model, onOpenSource]);

  // Adopt fresh content but keep dragged positions (ERD rule: zoom and
  // layout are sacred - mapping edits never yank the canvas).
  useEffect(() => {
    setNodes((prev) => {
      const kept = new Map(prev.map((p) => [p.id, p.position] as const));
      return freshNodes.map((n) => {
        const p = kept.get(n.id);
        return p ? { ...n, position: { ...p } } : n;
      });
    });
  }, [freshNodes, setNodes]);

  const edges = useMemo(() => {
    const list: Edge[] = [];
    for (const e of model.edges) {
      const dimmed = selectedId
        ? selectedId === "src"
          ? e.kind !== "field"
          : selectedId === "consts"
            ? e.kind !== "constant"
            : !(e.objectName === selectedId.replace(/^obj:/, "") || `obj:${e.objectName}` === selectedId)
        : false;
      list.push({
        id: `e:${e.id}`,
        source: e.kind === "constant" ? "consts" : "src",
        sourceHandle: e.kind === "constant" ? `c:${e.constantId}` : "out",
        target: `obj:${e.objectName}`,
        targetHandle: `f:${e.fieldName}`,
        animated: e.status === "needs-transformation" || e.status === "needs-decision",
        style: { stroke: GRAPH_EDGE_COLOR[e.status], strokeWidth: 2, opacity: dimmed ? 0.15 : 1 },
      });
    }
    return list;
  }, [model, selectedId]);

  // Fit once per project (and when the canvas gains its first boxes) -
  // mapping edits must never steal the zoom back.
  const fitKey = useRef("");
  useEffect(() => {
    const key = `${project.id}:${model.objects.length === 0 ? "empty" : "full"}`;
    if (fitKey.current === key) return;
    fitKey.current = key;
    const t = window.setTimeout(() => fitView({ padding: 0.15, maxZoom: 1 }), 60);
    return () => window.clearTimeout(t);
  }, [project.id, model.objects.length, fitView]);

  if (!model.hasSource) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] p-6 text-center">
        <div>
          <p className="text-sm font-semibold text-ivory-950">No source loaded</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-ivory-600">Paste a sample JSON or import an OpenAPI operation first - then the flow draws itself.</p>
        </div>
      </div>
    );
  }
  // Source present but nothing mapped yet: still render the left end
  // (source circle + constants) so authoring starts from something real.
  // The graph is read-only by design - rows are authored in Guide/Grid,
  // lines appear here as they land.
  const showHint = model.edges.length === 0;

  return (
    <div ref={wrapRef} className="relative h-[calc(100dvh-360px)] min-h-[420px] w-full overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodesConnectable={false}
        nodeTypes={nodeTypes}
        onNodeClick={(_, n) => setSelectedId((cur) => (cur === n.id ? null : n.id))}
        onPaneClick={() => {
          setSelectedId(null);
          setTip(null);
        }}
        onEdgeMouseEnter={(e, edge) => {
          const found = model.edges.find((m) => `e:${m.id}` === edge.id);
          if (!found) return;
          const rect = wrapRef.current?.getBoundingClientRect();
          const me = e as unknown as React.MouseEvent;
          setTip({
            x: me.clientX - (rect?.left ?? 0),
            y: me.clientY - (rect?.top ?? 0),
            text: edgeTip(found),
          });
        }}
        onEdgeMouseLeave={() => setTip(null)}
        fitView
        minZoom={0.2}
      >
        <Background gap={22} size={1.2} color="#DDD3BC" bgColor="#FAF8F2" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor="#D9CFB6"
          nodeStrokeColor="#9A7653"
          style={{ background: "#FFFFFF", border: "1px solid #DDD3BC", borderRadius: 8 }}
          maskColor="rgba(250, 248, 242, 0.75)"
        />
        <Controls position="bottom-left" />
      </ReactFlow>
      {tip && (
        <div
          className="pointer-events-none absolute z-30 max-w-[320px] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 font-mono text-[11px] text-ivory-950 shadow-[0_12px_36px_-16px_rgba(24,20,12,0.4)]"
          style={{ left: Math.min(tip.x + 12, 320), top: Math.max(tip.y - 12, 8) }}
        >
          {tip.text}
        </div>
      )}
      <div className="absolute left-3 top-3 z-20 flex items-center gap-1.5">
        <span className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[11px] font-medium text-ivory-700">
          {model.objects.length} objects · {model.edges.length} lines · {model.constants.length} constants
        </span>
        {selectedId && (
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[11px] font-semibold text-ivory-700 hover:border-bronze-400 hover:text-ivory-950 transition-colors cursor-pointer"
          >
            Clear selection
          </button>
        )}
      </div>
      {showHint && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg border border-dashed border-bronze-300 bg-[var(--color-surface)] px-3 py-1.5 text-[11px] text-ivory-600">
          Map a field in Guide or Grid - its line appears here.
        </div>
      )}
    </div>
  );
}

export const MappingGraph = memo(function MappingGraph({
  project,
  onOpenSource,
}: {
  project: MappingProject;
  onOpenSource: () => void;
}) {
  return (
    <ReactFlowProvider>
      <GraphFlow project={project} onOpenSource={onOpenSource} />
    </ReactFlowProvider>
  );
});
