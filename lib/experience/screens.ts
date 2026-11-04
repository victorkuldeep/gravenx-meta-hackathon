/**
 * Experience Mapping - screen inventory operations (pure).
 * Deletion never cascades silently: impact() lists dependents first.
 */

import type { ExperienceModule, Screen } from "./types";

export interface ScreenImpact {
  components: number;
  annotations: number;
  actions: number;
  bindings: number;
  requirements: number;
  states: number;
}

/** Count artifacts that belong to a screen. */
export function screenImpact(exp: ExperienceModule, screenId: string): ScreenImpact {
  return {
    components: exp.components.filter((c) => c.screenId === screenId).length,
    annotations: exp.annotations.filter((a) => a.screenId === screenId).length,
    actions: exp.actions.filter((a) => a.screenId === screenId).length,
    bindings: exp.bindings.filter((b) => b.screenId === screenId).length,
    requirements: exp.requirements.filter((r) => r.screenId === screenId).length,
    states: exp.states.filter((s) => s.screenId === screenId).length,
  };
}

/** Remove a screen and everything scoped to it. Shared catalog ops survive. */
export function deleteScreenCascade(exp: ExperienceModule, screenId: string): ExperienceModule {
  const compIds = new Set(exp.components.filter((c) => c.screenId === screenId).map((c) => c.id));
  return {
    ...exp,
    screens: exp.screens.filter((s) => s.id !== screenId),
    assets: exp.assets.filter((a) => a.screenId !== screenId),
    components: exp.components.filter((c) => c.screenId !== screenId),
    annotations: exp.annotations.filter((a) => a.screenId !== screenId),
    actions: exp.actions.filter((a) => a.screenId !== screenId),
    bindings: exp.bindings.filter((b) => b.screenId !== screenId),
    requirements: exp.requirements.filter((r) => r.screenId !== screenId && !(r.componentId && compIds.has(r.componentId))),
    states: exp.states.filter((s) => s.screenId !== screenId && !(s.componentId && compIds.has(s.componentId))),
    journeys: exp.journeys.map((j) => ({ ...j, screenIds: j.screenIds.filter((id) => id !== screenId) })),
  };
}

/** Move a screen within the inventory order. Out-of-range indexes clamp. */
export function reorderScreens(screens: Screen[], from: number, to: number): Screen[] {
  const next = [...screens];
  const clampedTo = Math.max(0, Math.min(next.length - 1, to));
  const [moved] = next.splice(from, 1);
  if (!moved) return next;
  next.splice(clampedTo, 0, moved);
  return next;
}
