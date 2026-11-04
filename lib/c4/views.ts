import type { SystemProject } from "@/lib/system-design/model";

/**
 * C4 projections (Epic 6) - one model, many views. Levels are assigned per
 * system node (context / container / component, optional parentId); each
 * view is a read-only filter over the same canvas. Nodes without an
 * explicit level default to container, and a project with no levels at
 * all shows everything in every view (no empty-canvas surprises).
 */

export type C4View = "all" | "context" | "container" | "component";

export const C4_VIEWS: { id: C4View; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Full canvas" },
  { id: "context", label: "Context", hint: "People + external systems" },
  { id: "container", label: "Container", hint: "Deployable units" },
  { id: "component", label: "Component", hint: "Inside one container" },
];

export type C4Level = "context" | "container" | "component";

export function levelOf(p: SystemProject, id: string): C4Level {
  return p.systems.find((s) => s.id === id)?.level ?? "container";
}

/** Ids to hide for the given view. Empty set = show everything. */
export function hiddenNodeIds(p: SystemProject, view: C4View): Set<string> {
  if (view === "all") return new Set();
  if (!p.systems.some((s) => s.level !== undefined)) return new Set();
  const keep = new Set<string>();
  const neighbors = new Map<string, Set<string>>();
  for (const c of p.connections) {
    if (!neighbors.get(c.sourceId)) neighbors.set(c.sourceId, new Set());
    if (!neighbors.get(c.targetId)) neighbors.set(c.targetId, new Set());
    neighbors.get(c.sourceId)!.add(c.targetId);
    neighbors.get(c.targetId)!.add(c.sourceId);
  }
  if (view === "context") {
    for (const s of p.systems) {
      if (levelOf(p, s.id) !== "context") continue;
      keep.add(s.id);
      for (const n of neighbors.get(s.id) ?? []) keep.add(n);
    }
  } else if (view === "container") {
    for (const s of p.systems) {
      const l = levelOf(p, s.id);
      if (l === "context" || l === "container") keep.add(s.id);
    }
  } else {
    for (const s of p.systems) {
      if (levelOf(p, s.id) !== "component") continue;
      keep.add(s.id);
      // Parent chain + context stays for orientation.
      let parent: string | undefined = s.parentId;
      while (parent && !keep.has(parent)) {
        keep.add(parent);
        parent = p.systems.find((x) => x.id === parent)?.parentId;
      }
    }
    for (const s of p.systems) {
      if (levelOf(p, s.id) === "context") keep.add(s.id);
    }
  }
  return new Set(p.systems.map((s) => s.id).filter((id) => !keep.has(id)));
}

/** Tree for review rendering: context → containers → components. */
export interface C4TreeNode {
  id: string;
  name: string;
  level: C4Level;
  children: C4TreeNode[];
}

export function c4Tree(p: SystemProject): C4TreeNode[] {
  const kids = (parentId: string | undefined, level: C4Level): C4TreeNode[] =>
    p.systems
      .filter((s) => levelOf(p, s.id) === level && (s.parentId ?? undefined) === parentId)
      .map((s) => ({
        id: s.id,
        name: s.name,
        level,
        children: level === "context" ? kids(s.id, "container") : level === "container" ? kids(s.id, "component") : [],
      }));
  const roots = kids(undefined, "context").concat(kids(undefined, "container"), kids(undefined, "component"));
  // Orphans: parentId points nowhere - still get a top-level seat, never dropped.
  const seated = new Set<string>();
  const collect = (nodes: C4TreeNode[]): void => {
    for (const n of nodes) {
      seated.add(n.id);
      collect(n.children);
    }
  };
  collect(roots);
  for (const s of p.systems) {
    if (!seated.has(s.id)) {
      roots.push({ id: s.id, name: s.name, level: levelOf(p, s.id), children: [] });
    }
  }
  return roots;
}
