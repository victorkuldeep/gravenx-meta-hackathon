"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { bubbleInitials, type GraphBubbleData } from "@/lib/erd/graph";
/**
 * Radial-graph bubble node (case-studies language): a circle with the object
 * label beneath. Root is large + dark; lite (not-yet-loaded) neighbors render
 * dashed to invite a click-to-load.
 */
function GraphBubbleNodeInner({ data, selected }: NodeProps<Node<GraphBubbleData>>) {
  const isRoot = data.role === "root";
  const size = isRoot ? 104 : 80;

  return (
    <div
      className="flex flex-col items-center transition-opacity"
      style={{ width: size + 72, opacity: data.dimmed ? 0.35 : 1 }}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <Handle
          type="target"
          position={Position.Left}
          style={{ opacity: 0, width: 2, height: 2, pointerEvents: "none" }}
        />
        <Handle
          type="source"
          position={Position.Right}
          style={{ opacity: 0, width: 2, height: 2, pointerEvents: "none" }}
        />
        <div
          className={`flex h-full w-full items-center justify-center rounded-full border-2 font-display font-extrabold shadow-[0_10px_30px_-10px_rgba(24,20,12,0.4)] ${
            isRoot
              ? "bg-ivory-950 text-ivory-100 border-ivory-950 text-xl"
              : data.loaded
                ? data.custom
                  ? "bg-bronze-100 text-bronze-700 border-bronze-400 text-sm"
                  : "bg-[var(--color-surface)] text-ivory-800 border-[var(--color-line)] text-sm"
                : "bg-transparent text-ivory-500 border-dashed border-ivory-500 text-sm"
          } ${
            selected || data.spotlight
              ? "ring-4 ring-bronze-500/40"
              : ""
          }`}
          title={data.loaded ? data.apiName : `${data.apiName} - click to load onto canvas`}
        >
          {data.bubbleTag ?? bubbleInitials(data.apiName)}
        </div>
        {isRoot && (
          <span
            className="absolute -inset-2 rounded-full border-2 border-dashed border-bronze-500/60 pointer-events-none"
            aria-hidden="true"
          />
        )}
        {data.hasNote && (
          <span
            title={data.hasTodo ? "Open TODO for this object" : "Design note attached"}
            className={`absolute right-1 top-1 h-2.5 w-2.5 rounded-full border border-white ${data.hasTodo ? "bg-red-500" : "bg-bronze-500"}`}
            aria-hidden="true"
          />
        )}
      </div>
      <p
        className={`mt-1.5 max-w-full text-center font-mono text-[11px] font-semibold leading-tight break-all ${
          isRoot ? "text-ivory-950" : "text-ivory-700"
        }`}
        title={data.loaded ? `${data.label} (${data.apiName})` : `${data.apiName} (preview - click for details)`}
      >
        {data.apiName}
      </p>
      {!data.loaded && (
        <p className="text-[9px] uppercase tracking-wider text-ivory-500">preview</p>
      )}
    </div>
  );
}

export const GraphBubbleNode = memo(GraphBubbleNodeInner);
