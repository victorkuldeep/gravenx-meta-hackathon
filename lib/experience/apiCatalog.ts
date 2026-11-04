/**
 * Experience Mapping - API catalog services (pure).
 * Operations are shared project artifacts; bindings reference them by id.
 * Duplicates warn, never auto-merge.
 */

import type { APIBinding, APIOperation, ExperienceModule } from "./types";

/** Normalized identity for duplicate detection. Original text preserved. */
export function normalizeOperationKey(method: string, path: string): string {
  return `${method.trim().toUpperCase()} ${path.trim().replace(/\/+$/, "") || "/"}`;
}

/** Existing operations with the same normalized key (excluding an id). */
export function findDuplicateOperations(ops: APIOperation[], method: string, path: string, excludeId?: string): APIOperation[] {
  const key = normalizeOperationKey(method, path);
  return ops.filter((o) => o.id !== excludeId && normalizeOperationKey(o.method, o.path) === key);
}

export function operationUsage(bindings: APIBinding[], operationId: string): { screens: number; components: number; actions: number } {
  const rel = bindings.filter((b) => b.operationId === operationId);
  return {
    screens: new Set(rel.map((b) => b.screenId)).size,
    components: new Set(rel.filter((b) => b.componentId).map((b) => b.componentId as string)).size,
    actions: new Set(rel.filter((b) => b.actionId).map((b) => b.actionId as string)).size,
  };
}

/** Operations with zero bindings. */
export function orphanOperations(ops: APIOperation[], bindings: APIBinding[]): APIOperation[] {
  const used = new Set(bindings.map((b) => b.operationId));
  return ops.filter((o) => !used.has(o.id));
}

export interface BindingProblem {
  bindingId: string;
  message: string;
}

/** Bindings whose operation/component/action/screen no longer resolves. */
export function validateBindings(exp: ExperienceModule, operations: APIOperation[]): BindingProblem[] {
  const out: BindingProblem[] = [];
  const ops = new Set(operations.map((o) => o.id));
  const screens = new Set(exp.screens.map((s) => s.id));
  const comps = new Set(exp.components.map((c) => c.id));
  const acts = new Set(exp.actions.map((a) => a.id));
  for (const b of exp.bindings) {
    if (!ops.has(b.operationId)) out.push({ bindingId: b.id, message: `Binding references missing operation ${b.operationId}.` });
    if (!screens.has(b.screenId)) out.push({ bindingId: b.id, message: `Binding references missing screen ${b.screenId}.` });
    if (b.componentId && !comps.has(b.componentId)) out.push({ bindingId: b.id, message: `Binding references missing component ${b.componentId}.` });
    if (b.actionId && !acts.has(b.actionId)) out.push({ bindingId: b.id, message: `Binding references missing action ${b.actionId}.` });
  }
  return out;
}
