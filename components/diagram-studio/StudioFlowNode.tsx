"use client";

import { Handle, Position } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import { SystemNodeView, type SystemNodeData } from "@/components/system-design/SystemNode";
import { CanvasNoteView } from "@/components/system-design/CanvasMarks";

/**
 * Studio node views: every element connects on all four sides. System and
 * note views wrap the shared System canvases (untouched) and add the
 * missing handles around them; flowchart shapes are studio-owned.
 * Links stay static - no animation, no run state.
 */

const DOT = { width: 12, height: 12, background: "#fff", border: "2px solid #A98450" };

function FourSides({ prefix }: { prefix: string }) {
  return (
    <>
      {([Position.Top, Position.Right, Position.Bottom, Position.Left] as Position[]).map((position) => (
        <span key={position}>
          <Handle id={`${prefix}-${position}-source`} type="source" position={position} title="Drag from here to another box to link" style={DOT} />
          <Handle id={`${prefix}-${position}-target`} type="target" position={position} title="Drop a link here" style={DOT} />
        </span>
      ))}
    </>
  );
}

/**
 * System box: the shared view already owns Left-target + Right-source, so
 * the studio only adds the missing dots - no stacked duplicates fighting
 * over the same grab point.
 */
export function StudioSystemView(props: NodeProps) {
  return (
    <div className="relative">
      <Handle id="sys-top-source" type="source" position={Position.Top} title="Drag from here to another box to link" style={DOT} />
      <Handle id="sys-top-target" type="target" position={Position.Top} title="Drop a link here" style={DOT} />
      <Handle id="sys-bottom-source" type="source" position={Position.Bottom} title="Drag from here to another box to link" style={DOT} />
      <Handle id="sys-bottom-target" type="target" position={Position.Bottom} title="Drop a link here" style={DOT} />
      <Handle id="sys-left-source" type="source" position={Position.Left} title="Drag from here to another box to link" style={DOT} />
      <Handle id="sys-right-target" type="target" position={Position.Right} title="Drop a link here" style={DOT} />
      <SystemNodeView {...(props as NodeProps<Node<SystemNodeData>>)} />
    </div>
  );
}

/** Sticky note: shared view inside, studio connectors outside. */
export function StudioNoteView(props: NodeProps) {
  return (
    <div className="relative">
      <FourSides prefix="note" />
      <CanvasNoteView {...props} />
    </div>
  );
}

function shell(selected: boolean | undefined, extra: string): string {
  return `flex items-center justify-center px-3 py-2 text-center text-[11px] font-medium leading-snug text-ivory-950 ${extra} ${
    selected ? "ring-2 ring-bronze-500" : ""
  }`;
}

export interface FlowNodeData extends Record<string, unknown> {
  label: string;
}

export function FlowProcessView({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  return (
    <div className="relative">
      <FourSides prefix="proc" />
      <div className={shell(selected, "min-h-[56px] w-44 rounded-md border-[1.5px] border-[#9A7653] bg-white shadow-sm")}>
        <span className="whitespace-pre-wrap break-words">{d.label}</span>
      </div>
    </div>
  );
}

export function FlowDecisionView({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  return (
    <div className="relative flex items-center justify-center">
      <FourSides prefix="dec" />
      <div className={shell(selected, "min-h-[96px] w-44 border-[1.5px] border-[#722F37] bg-white shadow-sm [clip-path:polygon(50%_0,100%_50%,50%_100%,0_50%)]")}>
        <span className="max-w-[90px] whitespace-pre-wrap break-words text-[10px]">{d.label}</span>
      </div>
    </div>
  );
}

export function FlowTerminatorView({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  return (
    <div className="relative">
      <FourSides prefix="term" />
      <div className={shell(selected, "min-h-[44px] w-40 rounded-full border-[1.5px] border-[#4E342E] bg-[#F5F1E8] shadow-sm")}>
        <span className="whitespace-pre-wrap break-words">{d.label}</span>
      </div>
    </div>
  );
}

export const studioNodeTypes = {
  system: StudioSystemView,
  note: StudioNoteView,
  "flow-process": FlowProcessView,
  "flow-decision": FlowDecisionView,
  "flow-terminator": FlowTerminatorView,
} as const;
