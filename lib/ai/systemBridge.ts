import type { SystemProject } from "@/lib/system-design/model";

/**
 * Bridge between the live System Design canvas and headless AI tools.
 *
 * SystemDesigner registers itself on mount (getter + apply function);
 * tools in lib/ai/toolsSystem.ts call through this module, never React.
 * Outside /system (or in tests) the bridge is simply absent and tools
 * report that instead of crashing.
 */

export interface SystemSnapshot {
  name: string;
  systems: { id: string; name: string; type: string; x: number; y: number }[];
  connections: { id: string; from: string; to: string; label: string }[];
  interfaceCount: number;
  operationCount: number;
  flowCount: number;
  scenarioCount: number;
  dirty: boolean;
}

export interface SystemBridge {
  getSnapshot: () => SystemSnapshot | null;
  /** Full project for headless analysis (risk lens). Null when none open. */
  getProject: () => SystemProject | null;
  /** Applies a project transform through the canvas mutate path (undo + autosave intact). */
  apply: (fn: (p: SystemProject) => SystemProject, label: string) => { ok: boolean; error?: string };
}

let bridge: SystemBridge | null = null;

export function registerSystemBridge(b: SystemBridge | null): void {
  bridge = b;
}

export function getSystemBridge(): SystemBridge | null {
  return bridge;
}

export function snapshotOf(project: SystemProject | null, dirty: boolean): SystemSnapshot | null {
  if (!project) return null;
  const names = new Map(project.systems.map((s) => [s.id, s.name]));
  return {
    name: project.name,
    systems: project.systems.map((s) => ({ id: s.id, name: s.name, type: s.systemType, x: Math.round(s.position.x), y: Math.round(s.position.y) })),
    connections: project.connections.map((c) => ({
      id: c.id,
      from: names.get(c.sourceId) ?? c.sourceId,
      to: names.get(c.targetId) ?? c.targetId,
      label: c.label,
    })),
    interfaceCount: project.interfaces.length,
    operationCount: project.operations.length,
    flowCount: project.flows.length,
    scenarioCount: project.scenarios.length,
    dirty,
  };
}
