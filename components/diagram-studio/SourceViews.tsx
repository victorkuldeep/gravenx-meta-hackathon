"use client";

import { useMemo } from "react";
import { Background, ReactFlow } from "@xyflow/react";
import { SequenceDiagram } from "@/components/sequence/SequenceDiagram";
import { systemNodeTypes } from "@/components/system-design/flowRender";
import { toFlowEdges, toFlowNodes } from "@/lib/system-design/flow";
import type { SequenceDocument } from "@/lib/sequence/model";
import type { SystemProject } from "@/lib/system-design/model";

/**
 * Diagram Studio source adapters (hexagonal ports): each resolves one
 * studio item to a renderable source and registers its DOM node for PNG
 * capture. No studio logic lives here - only faithful re-rendering of the
 * owning canvas through the shared projections.
 */

export function SequenceSourceView({
  doc,
  registerNode,
}: {
  doc: SequenceDocument;
  registerNode: (el: HTMLElement | null) => void;
}) {
  return (
    <div ref={registerNode} className="overflow-x-auto bg-white">
      <SequenceDiagram doc={doc} />
    </div>
  );
}

const noop = () => {};

export function SystemSourceView({
  project,
  registerNode,
}: {
  project: SystemProject;
  registerNode: (el: HTMLElement | null) => void;
}) {
  const nodes = useMemo(
    () => [
      ...toFlowNodes(project),
      ...project.canvasNotes.map((n) => ({
        id: n.id,
        type: "note",
        position: n.position,
        data: { text: n.text, editing: false, onBeginEdit: noop, onCommit: noop, onCancel: noop },
        selected: false,
      })),
      ...project.canvasImages.map((g) => ({
        id: g.id,
        type: "canvas-image",
        position: g.position,
        width: g.width,
        height: g.height,
        data: { blobId: g.blobId, name: g.name, onResize: noop },
        selected: false,
      })),
    ],
    [project]
  );
  const edges = useMemo(() => toFlowEdges(project), [project]);
  return (
    <div ref={registerNode} className="h-[340px] w-full bg-[#FAF8F2]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={systemNodeTypes}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        panOnScroll={false}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={22} size={1.2} color="#DDD3BC" bgColor="#FAF8F2" />
      </ReactFlow>
    </div>
  );
}
