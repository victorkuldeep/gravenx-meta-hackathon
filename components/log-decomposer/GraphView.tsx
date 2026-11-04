"use client";

import { useMemo, useState } from "react";
import {
  Background,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ExecutionModel } from "@/lib/log-decomposer/model";
import { projectExecutionGraph } from "@/lib/log-decomposer/graph";

const TYPE_SHORT: Record<string, string> = {
  TRANSACTION: "TXN",
  CODE_UNIT: "UNIT",
  METHOD: "FN",
  TRIGGER: "TRG",
  FLOW: "FLOW",
  SOQL: "SOQL",
  DML: "DML",
  CALLOUT: "CALL",
  ASYNC: "ASYNC",
  SYSTEM: "SYS",
  EXCEPTION: "ERR",
};

const TYPE_BG: Record<string, string> = {
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

const STATUS_RING: Record<string, string> = {
  SUCCESS: "border-[var(--color-line)]",
  FAILED: "border-red-500",
  WARNING: "border-amber-500",
  RUNNING: "border-sky-500",
  UNKNOWN: "border-[var(--color-line)]",
};

interface ExecNodeData extends Record<string, unknown> {
  label: string;
  type: string;
  status: string;
  duration?: number;
  slow: boolean;
  dimmed: boolean;
  selected: boolean;
}

type ExecNode = Node<ExecNodeData>;

function ExecNodeView({ data }: NodeProps<ExecNode>) {
  return (
    <div
      className={`flex w-60 items-center gap-1.5 rounded-lg border-2 bg-white px-2 py-1.5 shadow-sm ${
        STATUS_RING[data.status] ?? STATUS_RING.SUCCESS
      } ${data.selected ? "ring-2 ring-inset ring-[#722F37]" : ""} ${data.dimmed ? "opacity-40" : ""}`}
      title={`${data.label}${data.duration !== undefined ? ` · ${data.duration}ms` : ""} · ${data.status}`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-ivory-400" />
      <span className={`shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white ${TYPE_BG[data.type] ?? TYPE_BG.SYSTEM}`}>
        {TYPE_SHORT[data.type] ?? data.type}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ivory-950">{data.label}</span>
      {data.slow && (
        <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Slow operation" />
      )}
      {typeof data.duration === "number" && (
        <span className="shrink-0 font-mono text-[10px] text-ivory-500">{data.duration}ms</span>
      )}
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-ivory-400" />
    </div>
  );
}

const nodeTypes = { exec: ExecNodeView };

function GraphCanvas({
  execution,
  selectedNodeId,
  onSelectNode,
}: {
  execution: ExecutionModel;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}) {
  const [mode, setMode] = useState<"all" | "error" | "slow">("all");
  const [showAll, setShowAll] = useState(false);
  const { fitView } = useReactFlow();

  const graph = useMemo(() => projectExecutionGraph(execution, { showAll }), [execution, showAll]);
  const errSet = useMemo(() => new Set(graph.errorPathIds), [graph]);
  const slowSet = useMemo(() => new Set(graph.slowIds), [graph]);

  const nodes: ExecNode[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: "exec",
        position: { x: n.x, y: n.y },
        selected: n.id === selectedNodeId,
        data: {
          label: n.label,
          type: n.type,
          status: n.status,
          duration: n.durationMs,
          slow: n.slow,
          dimmed: mode === "error" ? !errSet.has(n.id) : mode === "slow" ? !slowSet.has(n.id) : false,
          selected: n.id === selectedNodeId,
        },
      })),
    [graph, selectedNodeId, mode, errSet, slowSet]
  );

  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const onErr = errSet.has(e.source) && errSet.has(e.target);
        const onSlow = slowSet.has(e.target);
        const hot = mode === "error" ? onErr : mode === "slow" ? onSlow : onErr || onSlow;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          animated: hot,
          style: {
            stroke: mode === "error" && onErr ? "#B91C1C" : mode === "slow" && onSlow ? "#D97706" : "#C9BFAE",
            strokeWidth: hot ? 2 : 1.2,
            opacity: mode === "all" ? 1 : hot ? 1 : 0.3,
          },
        };
      }),
    [graph, mode, errSet, slowSet]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => onSelectNode(n.id)}
      onPaneClick={() => onSelectNode(null)}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1.25 }}
      minZoom={0.2}
      colorMode="light"
      proOptions={{ hideAttribution: false }}
    >
      <Background gap={20} size={1} color="#E3D9C6" bgColor="#FAF8F2" />
      <MiniMap pannable zoomable className="!bg-white" />
      <Panel position="top-left" className="flex items-center gap-1">
        {(["all", "error", "slow"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`cursor-pointer rounded-md border px-2 py-1 text-[10px] font-bold capitalize ${
              mode === m ? "border-[#722F37] bg-[#722F37] text-white" : "border-[var(--color-line)] bg-white text-ivory-600 hover:border-bronze-600"
            }`}
          >
            {m === "all" ? "Full flow" : m === "error" ? "Error path" : "Slow path"}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void fitView({ padding: 0.15, maxZoom: 1.25 })}
          className="cursor-pointer rounded-md border border-[var(--color-line)] bg-white px-2 py-1 text-[10px] font-bold text-ivory-600 hover:border-bronze-600"
        >
          Fit
        </button>
      </Panel>
      {graph.truncated && (
        <Panel position="bottom-center">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="cursor-pointer rounded-full border border-[var(--color-line)] bg-white px-3 py-1 font-mono text-[10px] text-ivory-600 shadow hover:border-bronze-600"
          >
            {showAll ? "Back to what matters" : `Showing signal only - ${graph.hiddenCount} quiet nodes hidden - show all`}
          </button>
        </Panel>
      )}
    </ReactFlow>
  );
}

export function GraphView(props: { execution: ExecutionModel; selectedNodeId: string | null; onSelectNode: (id: string | null) => void }) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
