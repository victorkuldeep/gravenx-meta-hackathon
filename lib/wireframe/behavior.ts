import type { Experience } from "./model";

/**
 * EPIC 07 - interaction model overview. The Inspector authors single
 * intents; this aggregates them per screen so the architect sees behavior
 * at a glance and dead navigations get flagged before review.
 */

export interface BehaviorItem {
  componentId: string;
  label: string;
  kind: string;
  trigger: string;
  action: string;
  target?: string;
  /** navigate action pointing at no known screen. */
  dangling: boolean;
}

export interface ScreenBehavior {
  screenId: string;
  screenName: string;
  items: BehaviorItem[];
}

/** All components carrying an interaction intent, grouped in screen order. */
export function screenBehaviors(exp: Experience): ScreenBehavior[] {
  const byId = new Map(exp.screens.map((s) => [s.id, s]));
  const byName = new Map(exp.screens.map((s) => [s.name.toLowerCase(), s]));
  const groups = new Map<string, BehaviorItem[]>();
  for (const c of exp.components) {
    if (!c.interaction) continue;
    const screen = c.parentId ? byId.get(c.parentId) : undefined;
    const key = screen?.id ?? "";
    const target = c.interaction.target?.trim() || undefined;
    const dangling =
      c.interaction.action.toLowerCase() === "navigate" &&
      !!target &&
      !byId.has(target) &&
      !byName.has(target.toLowerCase());
    const list = groups.get(key) ?? [];
    list.push({
      componentId: c.id,
      label: c.label || c.kind,
      kind: c.kind,
      trigger: c.interaction.trigger,
      action: c.interaction.action,
      target,
      dangling,
    });
    groups.set(key, list);
  }
  const out: ScreenBehavior[] = exp.screens
    .filter((s) => groups.has(s.id))
    .map((s) => ({ screenId: s.id, screenName: s.name, items: groups.get(s.id)! }));
  const orphans = groups.get("");
  if (orphans && orphans.length > 0) {
    out.push({ screenId: "", screenName: "No screen", items: orphans });
  }
  return out;
}

/** Count of components with an interaction intent. */
export function behaviorCount(exp: Experience): number {
  return exp.components.filter((c) => c.interaction).length;
}
