import type { Experience } from "@/lib/wireframe/model";

/**
 * Bridge between the live Wireframe canvas and headless AI tools.
 *
 * WireCanvas registers itself on mount (getter + apply function);
 * tools in lib/ai/toolsWireframe.ts call through this module, never
 * React. Outside /wireframe (or in tests) the bridge is simply absent
 * and tools report that instead of crashing.
 */

export interface WireSnapshot {
  id: string;
  name: string;
  status: string;
  version: number;
  screens: { id: string; name: string; components: number }[];
  componentCount: number;
  proposedCount: number;
  behaviorCount: number;
  journeyCount: number;
  dirty: boolean;
}

export interface WireBridge {
  getSnapshot: () => WireSnapshot | null;
  /** Live experience for read tools - no persistence side effects. */
  getExperience: () => Experience | null;
  /** Applies an experience transform through the canvas persist path (autosave intact). */
  apply: (fn: (e: Experience) => Experience, label: string) => { ok: boolean; error?: string };
}

let bridge: WireBridge | null = null;

export function registerWireBridge(b: WireBridge | null): void {
  bridge = b;
}

export function getWireBridge(): WireBridge | null {
  return bridge;
}

export function wireSnapshotOf(exp: Experience | null): WireSnapshot | null {
  if (!exp) return null;
  const perScreen = new Map<string, number>();
  for (const c of exp.components) {
    if (c.parentId) perScreen.set(c.parentId, (perScreen.get(c.parentId) ?? 0) + 1);
  }
  return {
    id: exp.id,
    name: exp.name,
    status: exp.status,
    version: exp.version,
    screens: exp.screens.map((s) => ({ id: s.id, name: s.name, components: perScreen.get(s.id) ?? 0 })),
    componentCount: exp.components.length,
    proposedCount: exp.proposedFields.length,
    behaviorCount: exp.components.filter((c) => c.interaction).length,
    journeyCount: exp.journeys.length,
    dirty: false,
  };
}
