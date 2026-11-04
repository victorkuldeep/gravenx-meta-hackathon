import type { StudioSketch } from "@/lib/diagram-studio/sketch";

/**
 * Bridge between the live Studio sketch canvas and headless AI tools.
 * StudioCanvas registers itself on mount; sketch tools call through this
 * module, never React. Outside /studio the bridge is absent and tools say so.
 */

export interface SketchSnapshot {
  id: string;
  name: string;
  systems: number;
  flows: number;
  notes: number;
  links: number;
}

export interface SketchBridge {
  getSnapshot: () => SketchSnapshot | null;
  /** Live sketch for read tools - no persistence side effects. */
  getSketch: () => StudioSketch | null;
  /** Applies a sketch transform through the canvas persist path (autosave + undo intact). */
  apply: (fn: (s: StudioSketch) => StudioSketch, label: string) => { ok: boolean; error?: string };
}

let bridge: SketchBridge | null = null;

export function registerSketchBridge(b: SketchBridge | null): void {
  bridge = b;
}

export function getSketchBridge(): SketchBridge | null {
  return bridge;
}

export function sketchSnapshotOf(sketch: StudioSketch | null): SketchSnapshot | null {
  if (!sketch) return null;
  return {
    id: sketch.id,
    name: sketch.name,
    systems: sketch.nodes.filter((n) => n.kind === "system").length,
    flows: sketch.nodes.filter((n) => n.kind === "process" || n.kind === "decision" || n.kind === "terminator").length,
    notes: sketch.nodes.filter((n) => n.kind === "note").length,
    links: sketch.edges.length,
  };
}
