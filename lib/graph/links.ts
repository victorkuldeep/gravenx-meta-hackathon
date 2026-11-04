import type { GraphNode } from "./index";

/**
 * Record-view jump links: every graph node resolves to the studio address
 * that owns it. Record nodes deep-link (project, experience, sequence,
 * decision, requirement, task); node-level rows land on the owning record
 * (the canvas has no row selection to land on); stubs and externals either
 * carry their own URL or land nowhere.
 */

export const GRAPH_SURFACE_LABELS: Record<string, string> = {
  system: "System",
  wireframe: "Wireframe",
  sequence: "Sequence",
  draw: "Draw",
  schema: "Schema",
  decision: "Decisions",
  console: "Console",
  requirement: "Requirements",
  mapping: "Mapping",
};

const RECORD_ROUTES: Record<string, (id: string) => string> = {
  system: (id) => `/system?project=${encodeURIComponent(id)}`,
  wireframe: (id) => `/wireframe?exp=${encodeURIComponent(id)}`,
  sequence: (id) => `/sequence?id=${encodeURIComponent(id)}`,
  decision: (id) => `/decisions?id=${encodeURIComponent(id)}`,
  requirement: (id) => `/requirements?id=${encodeURIComponent(id)}`,
  console: (id) => `/console?task=${encodeURIComponent(id)}`,
  mapping: (id) => `/mapping?project=${encodeURIComponent(id)}`,
};

const SURFACE_ROOTS: Record<string, string> = {
  system: "/system",
  wireframe: "/wireframe",
  sequence: "/sequence",
  decision: "/decisions",
  requirement: "/requirements",
  console: "/console",
  mapping: "/mapping",
  draw: "/draw",
  schema: "/?tab=schema",
};

const RECORD_KINDS: ReadonlySet<string> = new Set([
  "project",
  "experience",
  "sequence",
  "decision",
  "requirement",
  "console-task",
  "mapping-project",
  // Plans carry the owning project id - they land on it, not the root.
  "mapping-plan",
  "snapshot",
  "draw-board",
]);

/** Owning record route for a node, or the node's own remote URL, or null. */
export function graphNodeHref(node: Pick<GraphNode, "kind" | "surface" | "recordId" | "url" | "stub">): string | null {
  if (node.url) return node.url;
  // Record rows deep-link; node-level rows land on the surface root (the
  // canvas has no row selection to land on); stubs land nowhere.
  if (node.stub) return null;
  if (RECORD_KINDS.has(node.kind)) {
    const route = RECORD_ROUTES[node.surface];
    if (!route || !node.recordId) return SURFACE_ROOTS[node.surface] ?? null;
    return route(node.recordId);
  }
  return SURFACE_ROOTS[node.surface] ?? null;
}

/** Short human kind for badges: "operation", "screen", "ADR", … */
export function graphKindLabel(kind: GraphNode["kind"]): string {
  switch (kind) {
    case "project":
      return "project";
    case "experience":
      return "experience";
    case "sequence":
      return "sequence";
    case "decision":
      return "ADR";
    case "requirement":
      return "REQ";
    case "console-task":
      return "task";
    case "external-issue":
      return "ticket";
    case "snapshot":
      return "snapshot";
    case "schema-object":
      return "object";
    case "schema-field":
      return "field";
    default:
      return kind;
  }
}
