import { MarkerType, type Edge, type Node } from "@xyflow/react";
import { connectionReadiness, type SystemProject } from "./model";

/**
 * Shared React Flow projection of a SystemProject (pure lib - no JSX).
 * SystemDesigner renders it live; Diagram Studio renders it read-only
 * for themed PNG sets. One projection, two consumers.
 */
export function toFlowNodes(project: SystemProject): Node<Record<string, unknown>>[] {
  return project.systems.map((s) => ({
    id: s.id,
    type: "system",
    position: s.position,
    data: { name: s.name, systemType: s.systemType, iconKey: s.iconKey, draft: true },
  }));
}

export function toFlowEdges(project: SystemProject, viz?: Record<string, "running" | "ok" | "failed">): Edge[] {
  return project.connections.map((c) => {
    const ready = connectionReadiness(c, project) === "ready";
    const v = viz?.[c.id];
    const color = v === "failed" ? "#B84C42" : v === "running" ? "#A98450" : v === "ok" || ready ? "#32815B" : undefined;
    return {
      id: c.id,
      source: c.sourceId,
      target: c.targetId,
      label: c.label || undefined,
      animated: !!v || ready,
      // Fat invisible hit area: dashed links are one pixel wide visually.
      interactionWidth: 40,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: color ?? "#8A8070",
      },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
      labelBgStyle: { fill: "#FFFFFF", fillOpacity: 0.92 },
      labelStyle: { fontSize: 10, fontFamily: "monospace" },
      style: { stroke: color ?? "#8A8070", strokeWidth: color ? 2 : 1 },
    };
  });
}
