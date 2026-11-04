import type { JsonDocument } from "./document";

/**
 * Visible graph projection: which nodes/edges render from the canonical
 * model given expansion state. Pure - views own React Flow state.
 * Never mutates the document. Child windows bound huge arrays.
 */

export type ChangeTone = "neutral" | "added" | "removed" | "modified" | "type";

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  depth: number;
  childCount: number;
  /** Children beyond the window (load-more affordance). */
  hiddenChildren: number;
  expandable: boolean;
  expanded: boolean;
  preview: string;
  tone: ChangeTone;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

export interface ProjectionOptions {
  /** Node ids treated as expanded (plus root always). */
  expanded: Set<string>;
  /** Max rendered children per node before windowing. */
  childLimit?: number;
  /** Max total rendered nodes (safety cap). */
  nodeLimit?: number;
  /** Per-node change tones (diff views). */
  tones?: Map<string, ChangeTone>;
  /** Focus: only this subtree (plus ancestors) renders. */
  focusId?: string | null;
  /**
   * Render only these nodes (plus their ancestors for structure).
   * Used by change-category filters - presentation only, never findings.
   */
  includeOnly?: Set<string> | null;
}

export interface GraphProjection {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** True when nodeLimit stopped traversal (not silent - UI must say so). */
  truncated: boolean;
  visible: number;
  total: number;
}

const DEFAULT_CHILD_LIMIT = 200;
const DEFAULT_NODE_LIMIT = 1500;

export function projectGraph(doc: JsonDocument, opts: ProjectionOptions): GraphProjection {
  const childLimit = opts.childLimit ?? DEFAULT_CHILD_LIMIT;
  const nodeLimit = opts.nodeLimit ?? DEFAULT_NODE_LIMIT;
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let truncated = false;

  // Focus scope: focus node + ancestors render; siblings outside collapse.
  let scope: Set<string> | null = null;
  if (opts.focusId && doc.nodes.has(opts.focusId)) {
    scope = new Set<string>();
    let cur: string | null = opts.focusId;
    const guard = new Set<string>();
    while (cur !== null && !guard.has(cur)) {
      guard.add(cur);
      scope.add(cur);
      cur = doc.nodes.get(cur)?.parent ?? null;
    }
  }

  // Include-only scope: kept nodes + every ancestor (structure preserved).
  let keep: Set<string> | null = null;
  if (opts.includeOnly) {
    keep = new Set<string>();
    for (const id of opts.includeOnly) {
      let cur: string | null = id;
      const guard = new Set<string>();
      while (cur !== null && !guard.has(cur) && doc.nodes.has(cur)) {
        guard.add(cur);
        keep.add(cur);
        cur = doc.nodes.get(cur)?.parent ?? null;
      }
    }
  }

  const queue: { id: string; belowFocus: boolean }[] = [{ id: doc.rootId, belowFocus: false }];
  const seen = new Set<string>([doc.rootId]);

  const labelFor = (id: string): string => {
    const n = doc.nodes.get(id);
    if (!n) return id;
    if (n.key === null) return "(root)";
    return typeof n.key === "number" ? `[${n.key}]` : n.key;
  };

  while (queue.length > 0) {
    if (nodes.length >= nodeLimit) {
      truncated = true;
      break;
    }
    const { id, belowFocus } = queue.shift() as { id: string; belowFocus: boolean };
    const node = doc.nodes.get(id);
    if (!node) continue;
    // Render scope members, the focus subtree, keep-list members, or
    // everything when no scope applies.
    const inRender =
      (scope === null || scope.has(id) || belowFocus) &&
      (keep === null || keep.has(id));
    if (!inRender) continue;

    const isContainer = node.type === "object" || node.type === "array";
    const expanded = id === doc.rootId || opts.expanded.has(id);

    const childIds = node.children;
    const shown = expanded ? Math.min(childIds.length, childLimit) : 0;

    nodes.push({
      id,
      label: labelFor(id),
      type: node.type,
      depth: node.depth,
      childCount: childIds.length,
      hiddenChildren: expanded ? Math.max(0, childIds.length - shown) : childIds.length,
      expandable: isContainer && childIds.length > 0,
      expanded,
      preview: previewOf(node.type, node.value),
      tone: opts.tones?.get(id) ?? "neutral",
    });

    if (!expanded) continue;
    const kidsBelowFocus = belowFocus || id === opts.focusId;
    for (let i = 0; i < shown; i++) {
      const childId = childIds[i];
      if (seen.has(childId)) continue;
      seen.add(childId);
      // Only link children that will actually render (no dangling edges).
      const childRenders =
        (scope === null || scope.has(childId) || kidsBelowFocus) &&
        (keep === null || keep.has(childId));
      if (!childRenders) continue;
      edges.push({ id: `${id}→${childId}`, source: id, target: childId, label: "" });
      queue.push({ id: childId, belowFocus: kidsBelowFocus });
    }
  }

  return { nodes, edges, truncated, visible: nodes.length, total: doc.size };
}

function previewOf(type: string, value: unknown): string {
  if (type === "string") {
    const s = value as string;
    return s.length > 32 ? `${s.slice(0, 32)}…` : s;
  }
  if (type === "object") return `${Object.keys(value as object).length} keys`;
  if (type === "array") return `${(value as unknown[]).length} items`;
  return String(value);
}

/** Full-model search (never limited to the visible projection). */
export interface GraphSearchHit {
  id: string;
  path: string;
  label: string;
  snippet: string;
}

export function searchGraphModel(
  doc: JsonDocument,
  query: string,
  stringifyPath: (path: (string | number)[]) => string
): GraphSearchHit[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  const out: GraphSearchHit[] = [];
  for (const node of doc.nodes.values()) {
    const hayLabel = node.label.toLowerCase();
    const hayValue =
      node.type === "string" || node.type === "number" || node.type === "boolean"
        ? String(node.value).toLowerCase()
        : "";
    const hayPath = stringifyPath(node.path).toLowerCase();
    if (hayLabel.includes(q) || hayValue.includes(q) || hayPath.includes(q)) {
      out.push({
        id: node.id,
        path: stringifyPath(node.path),
        label: node.label,
        snippet: previewOf(node.type, node.value),
      });
      if (out.length >= 500) break;
    }
  }
  return out;
}
