"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { StudioDocument, StudioIssue } from "@/lib/composite/studio";
import { computeRequestLayers } from "@/lib/composite/studio";

interface StudioBubbleData extends Record<string, unknown> {
  seq: number;
  method: string;
  label: string;
  referenceId: string;
  fieldCount: number;
  inCount: number;
  outCount: number;
  hasError: boolean;
  hasWarning: boolean;
}

interface StudioGraphProps {
  doc: StudioDocument;
  issues: StudioIssue[];
  onEditRequest: (id: string) => void;
  onPosition: (id: string, pos: { x: number; y: number }) => void;
  onResetLayout: () => void;
}

const NODE_W = 240;
const NODE_H = 210;
const X_GAP = 130;
const Y_GAP = 48;

/**
 * Graph is a READ-ONLY visualizer of the whole transaction: round nodes in
 * the schema-graph language, layered by dependency, independents in their
 * own lane. All editing happens in Requests - nodes arrange, that's it.
 */
function StudioGraphFlow(props: StudioGraphProps) {
  const { doc, issues } = props;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<StudioBubbleData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showIndependents, setShowIndependents] = useState(true);

  const issuesByReq = useMemo(() => {
    const m = new Map<string, { error: boolean; warning: boolean }>();
    for (const i of issues) {
      if (!i.requestId) continue;
      const cur = m.get(i.requestId) ?? { error: false, warning: false };
      if (i.level === "error") cur.error = true;
      else cur.warning = true;
      m.set(i.requestId, cur);
    }
    return m;
  }, [issues]);

  const inOut = useMemo(() => {
    const m = new Map<string, { in: number; out: number }>();
    for (const r of doc.requests) m.set(r.id, { in: 0, out: 0 });
    for (const mp of doc.mappings) {
      const s = m.get(mp.sourceRequestId);
      const t = m.get(mp.targetRequestId);
      if (s) s.out += 1;
      if (t) t.in += 1;
    }
    return m;
  }, [doc.requests, doc.mappings]);

  // Deterministic layered auto-layout; user drags persist in request.position.
  const autoPositions = useMemo(() => {
    const layers = computeRequestLayers(doc);
    const pos = new Map<string, { x: number; y: number }>();
    const byLayer = new Map<number, string[]>();
    for (const r of doc.requests) {
      const d = layers.get(r.id) ?? -1;
      if (d < 0) continue;
      if (!byLayer.has(d)) byLayer.set(d, []);
      byLayer.get(d)?.push(r.id);
    }
    let cursorY = 0;
    for (const d of [...byLayer.keys()].sort((a, b) => a - b)) {
      const ids = byLayer.get(d) ?? [];
      ids.forEach((id, k) => {
        pos.set(id, { x: 60 + d * (NODE_W + X_GAP), y: cursorY + k * (NODE_H + Y_GAP) });
      });
      cursorY += ids.length * (NODE_H + Y_GAP) + Y_GAP * 2;
    }
    // Independent lane: grid band below the layered graph.
    const independents = doc.requests.filter((r) => (layers.get(r.id) ?? -1) < 0);
    const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, independents.length))));
    independents.forEach((r, k) => {
      pos.set(r.id, {
        x: 60 + (k % cols) * (NODE_W + 48),
        y: cursorY + 90 + Math.floor(k / cols) * (NODE_H + Y_GAP),
      });
    });
    return { pos, laneY: cursorY + 40, laneCount: independents.length };
  }, [doc]);

  useEffect(() => {
    const layers = computeRequestLayers(doc);
    const built: Node<StudioBubbleData>[] = [];
    for (const r of doc.requests) {
      const independent = (layers.get(r.id) ?? -1) < 0;
      if (independent && !showIndependents) continue;
      const flags = issuesByReq.get(r.id) ?? { error: false, warning: false };
      const io = inOut.get(r.id) ?? { in: 0, out: 0 };
      built.push({
        id: r.id,
        type: "studioBubble",
        position: r.position ?? autoPositions.pos.get(r.id) ?? { x: 60, y: 60 },
        selected: r.id === selectedNodeId,
        data: {
          seq: doc.requests.findIndex((x) => x.id === r.id) + 1,
          method: r.method,
          label: r.displayName || r.objectLabel || "Untitled",
          referenceId: r.referenceId,
          fieldCount: r.fields.length,
          inCount: io.in,
          outCount: io.out,
          hasError: flags.error,
          hasWarning: !flags.error && flags.warning,
        },
      });
    }
    if (showIndependents && autoPositions.laneCount > 0) {
      built.push({
        id: "__lane__",
        type: "laneLabel",
        position: { x: 60, y: autoPositions.laneY },
        selectable: false,
        draggable: false,
        data: {} as StudioBubbleData,
      });
    }
    setNodes(built);

    // Bundle same-pair mappings into one labeled edge.
    const groups = new Map<string, { source: string; target: string; fields: string[] }>();
    for (const m of doc.mappings) {
      const key = `${m.sourceRequestId}→${m.targetRequestId}`;
      if (!groups.has(key)) groups.set(key, { source: m.sourceRequestId, target: m.targetRequestId, fields: [] });
      groups.get(key)?.fields.push(m.targetFieldApiName);
    }
    const builtEdges: Edge[] = [];
    for (const g of groups.values()) {
      if (!doc.requests.some((r) => r.id === g.source) || !doc.requests.some((r) => r.id === g.target)) continue;
      builtEdges.push({
        id: `e:${g.source}→${g.target}`,
        source: g.source,
        target: g.target,
        type: "default",
        animated: false,
        label: g.fields.length > 1 ? `${g.fields[0]} +${g.fields.length - 1}` : g.fields[0],
        labelStyle: { fontSize: 10, fontFamily: "monospace", fill: "#A98450" },
        labelBgStyle: { fill: "#FFFFFF", fillOpacity: 0.92 },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#A39B8E", width: 18, height: 18 },
        style: { stroke: "#A39B8E", strokeWidth: 1.6 },
      });
    }
    setEdges(builtEdges);
  }, [doc, autoPositions, issuesByReq, inOut, selectedNodeId, showIndependents, setNodes, setEdges]);

  const onNodeClick = useCallback((_: unknown, node: Node) => {
    if (node.id === "__lane__") return;
    setSelectedNodeId(node.id);
  }, []);

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      if (node.id === "__lane__") return;
      props.onPosition(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) });
    },
    [props]
  );

  const selectedReq = doc.requests.find((r) => r.id === selectedNodeId) ?? null;
  const errCount = issues.filter((i) => i.level === "error").length;
  const warnCount = issues.filter((i) => i.level === "warning").length;

  return (
    <div className="relative h-[560px] w-full overflow-hidden rounded-xl border border-[#E8E2D8] bg-[#F8F6F0]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={() => setSelectedNodeId(null)}
        onNodeDragStop={onNodeDragStop}
        nodesConnectable={false}
        minZoom={0.2}
        fitView
        fitViewOptions={{ padding: 0.15 }}
      >
        <Background gap={24} size={1.2} color="#E3DCCB" bgColor="#F8F6F0" />
        {nodes.length > 8 && (
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

      {/* Toolbar - arrange only, no editing here */}
      <div className="absolute left-3 top-3 z-30 flex flex-wrap items-center gap-1.5">
        <span className="rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#777168]">
          {doc.requests.length} nodes · {doc.mappings.length} links
        </span>
        <button
          onClick={() => props.onResetLayout()}
          title="Re-run layered auto-layout"
          className="rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#777168] hover:text-[#27241F] transition-colors cursor-pointer"
        >
          Auto-layout
        </button>
        <button
          onClick={() => setShowIndependents((v) => !v)}
          aria-pressed={showIndependents}
          title="Show or hide independent requests"
          className="rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#777168] hover:text-[#27241F] transition-colors cursor-pointer"
        >
          {showIndependents ? "Hide" : "Show"} independents
        </button>
        {(errCount > 0 || warnCount > 0) && (
          <span className="rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[11px] font-medium">
            {errCount > 0 && <span className="text-[#B84C42]">{errCount} error{errCount === 1 ? "" : "s"}</span>}
            {errCount > 0 && warnCount > 0 && <span className="text-[#A39B8E]"> · </span>}
            {warnCount > 0 && <span className="text-[#B98335]">{warnCount} warning{warnCount === 1 ? "" : "s"}</span>}
          </span>
        )}
      </div>

      {/* Read-only inspector - editing lives in Requests */}
      {selectedReq && (
        <div className="absolute right-3 top-3 z-30 w-60 rounded-xl border border-[#E8E2D8] bg-white p-3 shadow-sm">
          <p className="font-mono text-[11px] text-[#A39B8E]">#{doc.requests.findIndex((r) => r.id === selectedReq.id) + 1}</p>
          <p className="truncate text-[14px] font-semibold text-[#27241F]">
            {selectedReq.displayName || selectedReq.objectLabel || "Untitled"}
          </p>
          <p className="truncate font-mono text-[11px] text-[#A98450]">@{selectedReq.referenceId}</p>
          <p className="mt-1 text-[11px] text-[#777168]">
            {selectedReq.method} · {selectedReq.fields.length} fields · ⬦{inOut.get(selectedReq.id)?.in ?? 0} in / {inOut.get(selectedReq.id)?.out ?? 0} out
          </p>
          <button
            onClick={() => props.onEditRequest(selectedReq.id)}
            className="mt-2 w-full rounded-lg bg-[#211F1B] px-2.5 py-1.5 text-[11px] font-semibold text-white hover:opacity-90 transition-opacity cursor-pointer"
          >
            Edit in Requests →
          </button>
        </div>
      )}
    </div>
  );
}

/** Round bubble in the schema-graph language: neutral ring, seq monogram,
 *  label + @refId beneath. Bronze appears only for selection; red/amber
 *  only for validation. Method rides along as quiet caption text. */
function StudioBubbleNode({ data, selected }: { data: StudioBubbleData; selected?: boolean }) {
  const ring = data.hasError
    ? "border-[#B84C42]"
    : data.hasWarning
      ? "border-[#B98335]"
      : "border-[#E8E2D8]";
  return (
    <div className="flex flex-col items-center" style={{ width: 176 }}>
      <div className="relative" style={{ width: 84, height: 84 }}>
        <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 2, height: 2, pointerEvents: "none" }} />
        <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 2, height: 2, pointerEvents: "none" }} />
        <div
          className={`flex h-full w-full flex-col items-center justify-center rounded-full border-2 bg-white shadow-[0_10px_30px_-12px_rgba(24,20,12,0.4)] ${ring} ${
            selected ? "ring-4 ring-[#A98450]/40" : ""
          }`}
          title={`${data.label} (@${data.referenceId})`}
        >
          <span className="font-mono text-xl font-extrabold text-[#27241F]">
            {String(data.seq).padStart(2, "0")}
          </span>
          <span className="font-mono text-[10px] font-bold text-[#A39B8E]">{data.method}</span>
        </div>
      </div>
      <p className="mt-1.5 max-w-full truncate text-center text-[12px] font-semibold text-[#27241F]" title={data.label}>
        {data.label}
      </p>
      <p className="max-w-full truncate text-center font-mono text-[11px] text-[#777168]" title={`@${data.referenceId}`}>
        @{data.referenceId}
      </p>
      <p className="text-[10px] text-[#A39B8E]">
        {data.fieldCount}f · ⬦{data.inCount}/{data.outCount}
      </p>
    </div>
  );
}

function LaneLabel() {
  return (
    <div className="rounded-lg border border-dashed border-[#D8C7A9] bg-[#F5F1E8]/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[1.6px] text-[#A98450]">
      Independent requests - no links, always valid
    </div>
  );
}

const nodeTypes = {
  studioBubble: StudioBubbleNode,
  laneLabel: LaneLabel,
};

export default function StudioGraph(props: StudioGraphProps) {
  return (
    <ReactFlowProvider>
      <StudioGraphFlow {...props} />
    </ReactFlowProvider>
  );
}
