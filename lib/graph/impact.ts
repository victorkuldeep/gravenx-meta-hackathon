import {
  buildIndex,
  whereUsed,
  type GraphEdge,
  type GraphIndex,
  type GraphNode,
  type GraphSurface,
  type UnresolvedRef,
  type WhereUsedRef,
} from "./index";

/**
 * Impact analysis (Epic 3) - "what breaks if I remove or change this?"
 * Read-only queries over the Epic 2 graph index. Every hit cites the
 * edge it came from (kind + resolution); guesses never appear.
 */

export interface ImpactHit {
  node: GraphNode;
  via: GraphEdge;
}

export interface ImpactGroup {
  surface: GraphSurface;
  label: string;
  href: string;
  hits: ImpactHit[];
}

export interface ImpactSummary {
  target: GraphNode | null;
  groups: ImpactGroup[];
  total: number;
  /** Unresolved refs naming this target - breakage hiding behind renames. */
  dangling: UnresolvedRef[];
}

const SURFACE_META: Record<GraphSurface, { label: string; href: string }> = {
  system: { label: "System", href: "/system" },
  wireframe: { label: "Wireframe", href: "/wireframe" },
  sequence: { label: "Sequence", href: "/sequence" },
  draw: { label: "Draw+", href: "/draw" },
  schema: { label: "Schema", href: "/" },
  decision: { label: "Decisions", href: "/decisions" },
  console: { label: "Console", href: "/console" },
  requirement: { label: "Requirements", href: "/requirements" },
  mapping: { label: "Mapping", href: "/mapping" },
  notes: { label: "Notes", href: "/notes" },
};

const GROUP_ORDER: GraphSurface[] = ["system", "wireframe", "sequence", "decision", "requirement", "console", "mapping", "schema", "draw"];

/** Impact for an already-resolved node: groups + dangling refs naming it. */
export function summarizeForNode(index: GraphIndex, node: GraphNode): ImpactSummary {
  const inbound = index.edges.filter((e) => e.to === node.key);
  const bySurface = new Map<GraphSurface, ImpactHit[]>();
  for (const edge of inbound) {
    const from = index.nodes.find((n) => n.key === edge.from);
    if (!from || from.key === node.key) continue;
    const list = bySurface.get(from.surface) ?? [];
    list.push({ node: from, via: edge });
    bySurface.set(from.surface, list);
  }
  const groups: ImpactGroup[] = [];
  for (const surface of GROUP_ORDER) {
    const hits = bySurface.get(surface);
    if (hits && hits.length > 0) {
      groups.push({ surface, ...SURFACE_META[surface], hits });
    }
  }
  const names = new Set([node.name.toLowerCase(), node.recordId?.toLowerCase()].filter(Boolean) as string[]);
  const dangling = index.unresolved.filter(
    (u) => names.has(u.raw.toLowerCase()) || (u.name && names.has(u.name.toLowerCase())),
  );
  return { target: node, groups, total: inbound.length, dangling };
}

/** Impact of removing or changing the referenced record: everything pointing at it. */
export function summarizeImpact(index: GraphIndex, ref: WhereUsedRef): ImpactSummary {
  const { node } = whereUsed(index, ref);
  if (!node) {
    // Target itself is gone - still report the refs still naming it, so
    // deleted records show who still points at them instead of silence.
    const wanted = new Set<string>();
    if ("object" in ref) {
      wanted.add((ref.field ? `${ref.object}.${ref.field}` : ref.object).toLowerCase());
    } else if ("id" in ref) {
      wanted.add(ref.id.toLowerCase());
    } else {
      wanted.add(ref.name.toLowerCase());
    }
    const dangling = index.unresolved.filter(
      (u) => wanted.has(u.raw.toLowerCase()) || (u.name !== undefined && wanted.has(u.name.toLowerCase())),
    );
    return { target: null, groups: [], total: 0, dangling };
  }
  return summarizeForNode(index, node);
}

/** Resolve free text as an id first, then a name - for refs like operationRef. */
export function whereUsedEither(index: GraphIndex, surface: GraphSurface, text: string): ReturnType<typeof whereUsed> {
  const byId = whereUsed(index, { surface, id: text });
  if (byId.node) return byId;
  return whereUsed(index, { surface, name: text });
}

export function emptyImpact(): ImpactSummary {
  return { target: null, groups: [], total: 0, dangling: [] };
}

export type { GraphIndex };
export { buildIndex };
