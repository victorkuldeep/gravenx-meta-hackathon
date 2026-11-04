import {
  SYSTEM_TEMPLATES,
  newId,
  newProject,
  newSystemFromTemplate,
  type SystemProject,
  type SystemType,
} from "@/lib/system-design/model";

/**
 * Diagram Studio sketch model: freehand architecture drawing.
 * Boxes (systems), flowchart shapes and notes with labeled links - no
 * backends, no runs, no ceremony. Sketches promote into runnable System
 * projects through sketchToSystemProject (Send to System).
 */

export type SketchNodeKind = "system" | "process" | "decision" | "terminator" | "note";

export interface SketchNode {
  id: string;
  kind: SketchNodeKind;
  label: string;
  /** Only for kind "system". */
  systemType?: SystemType;
  x: number;
  y: number;
}

export type SketchEdgeKind = "bezier" | "straight" | "step" | "smoothstep";

export type SketchSide = "top" | "right" | "bottom" | "left";

export interface SketchEdge {
  id: string;
  sourceId: string;
  targetId: string;
  /** Exact connector dots used. Absent = auto. */
  sourceHandle?: string;
  targetHandle?: string;
  label: string;
  /** Link routing. Defaults to bezier. */
  kind?: SketchEdgeKind;
  /** Link line: solid by default. */
  dash?: "solid" | "dotted" | "dashed";
  /** Link weight: thin by default. */
  weight?: "thin" | "medium" | "bold";
}

/** Sketch flavor gates the palette: system boxes, flow shapes, or both. */
export type SketchFlavor = "system" | "flow" | "hybrid";

export const SKETCH_FLAVORS: { id: SketchFlavor; label: string; blurb: string }[] = [
  { id: "system", label: "System", blurb: "Topology boxes that promote to System" },
  { id: "flow", label: "Flow", blurb: "Flowchart shapes, export and deliver" },
  { id: "hybrid", label: "Hybrid", blurb: "Both inventories on one canvas" },
];

export interface StudioSketch {
  id: string;
  name: string;
  /** Absent on vintage sketches - read as hybrid. */
  flavor?: SketchFlavor;
  nodes: SketchNode[];
  edges: SketchEdge[];
  updatedAt: number;
}

export function sketchId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function blankSketch(name: string, flavor: SketchFlavor = "hybrid"): StudioSketch {
  return { id: sketchId("sketch"), name: name.trim() || "Untitled sketch", flavor, nodes: [], edges: [], updatedAt: Date.now() };
}

export function blankSketchNode(kind: SketchNodeKind, at: { x: number; y: number }): SketchNode {
  const labels: Record<SketchNodeKind, string> = {
    system: "New system",
    process: "Do something",
    decision: "Which path?",
    terminator: "Done",
    note: "Note",
  };
  return {
    id: sketchId("skn"),
    kind,
    label: labels[kind],
    systemType: kind === "system" ? "custom" : undefined,
    x: Math.round(at.x),
    y: Math.round(at.y),
  };
}

/** Connector-dot prefix per box kind (mirrors the studio node views). */
export function handlePrefix(kind: SketchNodeKind): string {
  if (kind === "system") return "sys";
  if (kind === "note") return "note";
  if (kind === "process") return "proc";
  if (kind === "decision") return "dec";
  return "term";
}

export function handleId(kind: SketchNodeKind, side: SketchSide, end: "source" | "target"): string {
  return `${handlePrefix(kind)}-${side}-${end}`;
}

/** Best connector sides from box positions (inspector Auto links). */
export function bestSides(
  from: { x: number; y: number },
  to: { x: number; y: number }
): { from: SketchSide; to: SketchSide } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? { from: "right", to: "left" } : { from: "left", to: "right" };
  return dy >= 0 ? { from: "bottom", to: "top" } : { from: "top", to: "bottom" };
}

/** Flow-shape prefix carried into promoted notes so logic survives. */
function flowNoteText(node: SketchNode): string {
  if (node.kind === "decision") return `[Decision] ${node.label}`;
  if (node.kind === "process") return `[Step] ${node.label}`;
  if (node.kind === "terminator") return `[End] ${node.label}`;
  return node.label;
}

export interface SketchPromotion {
  project: SystemProject;
  systems: number;
  links: number;
  /** Edges touching a flow shape or note: logic lives in the note instead. */
  notedEdges: number;
}

/**
 * Sketch -> runnable System project. System boxes become real systems
 * (interfaces backfill on open via validateStoredProject); flow shapes and
 * notes become canvas notes; system-to-system links become draft
 * connections. Nothing is invented beyond names, positions and labels.
 */
export function sketchToSystemProject(sketch: StudioSketch): SketchPromotion {
  const project = newProject(sketch.name);
  const now = Date.now();
  const sysIds = new Map<string, string>();
  let notedEdges = 0;
  let seq = 0;

  for (const n of sketch.nodes) {
    if (n.kind !== "system") {
      project.canvasNotes.push({ id: newId("note"), position: { x: n.x, y: n.y }, text: flowNoteText(n), createdAt: now, updatedAt: now });
      continue;
    }
    const template = SYSTEM_TEMPLATES.find((t) => t.systemType === n.systemType) ?? SYSTEM_TEMPLATES.find((t) => t.systemType === "custom")!;
    seq += 1;
    const sys = { ...newSystemFromTemplate(template, { x: n.x, y: n.y }, seq), name: n.label.trim() || template.name };
    project.systems.push(sys);
    sysIds.set(n.id, sys.id);
  }

  let links = 0;
  for (const e of sketch.edges) {
    const s = sysIds.get(e.sourceId);
    const t = sysIds.get(e.targetId);
    if (!s || !t || s === t) {
      notedEdges += 1;
      continue;
    }
    project.connections.push({ id: newId("conn"), sourceId: s, targetId: t, label: e.label, status: "draft" });
    links += 1;
  }

  project.notes = [
    `## Promoted from Diagram Studio sketch "${sketch.name}"`,
    "",
    `${project.systems.length} systems, ${links} draft links.${notedEdges > 0 ? ` ${notedEdges} sketch link(s) touched a flow shape or note and live on as notes - re-link them by hand.` : ""}`,
    "Bind operations on each link to run end-to-end.",
  ].join("\n");
  return { project, systems: project.systems.length, links, notedEdges };
}
