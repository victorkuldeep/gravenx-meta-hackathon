import type { DebugSession, ExecutionModel } from "./model";

/**
 * Bridge between the live Log Decomposer session and headless AI tools.
 * LogDecomposerRoute registers itself on mount (getter + apply function);
 * tools in lib/ai/logDecomposerTools.ts call through this module, never
 * React. Outside /log-decomposer (or in tests) the bridge is simply
 * absent and tools report that instead of crashing.
 */

export interface DebugBridge {
  /** The currently open session, or null when none is selected. */
  getSession: () => DebugSession | null;
  /** A specific execution model by execution id. */
  getExecution: (executionId: string) => ExecutionModel | null;
  /**
   * Applies a session transform through the route persist path (IDB +
   * refresh intact). Used by approval-gated mutations only.
   */
  apply: (fn: (s: DebugSession) => DebugSession, label: string) => Promise<{ ok: boolean; error?: string }>;
}

let bridge: DebugBridge | null = null;

export function registerDebugBridge(b: DebugBridge | null): void {
  bridge = b;
}

export function getDebugBridge(): DebugBridge | null {
  return bridge;
}
