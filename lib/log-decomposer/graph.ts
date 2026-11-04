import Dagre from "@dagrejs/dagre";
import type { ExecutionModel, ExecutionNode } from "./model";

/**
 * Graph projection: ExecutionModel -> laid-out node/edge data for the
 * visualizer. Pure data, no ReactFlow types - the component maps these
 * onto RF nodes. One function owns layout so tree and graph never drift.
 *
 * - Multiple roots stay separate; nothing is merged without a parent link.
 * - Statuses pass through untouched (green = no detected issue, never
 *   proven business success).
 * - Over MAX_GRAPH_NODES the projection drops quiet SUCCESS leaves but
 *   keeps every failure, warning, slow node and their ancestors.
 */

export interface GraphNodeDatum {
  id: string;
  label: string;
  type: ExecutionNode["type"];
  status: ExecutionNode["status"];
  durationMs?: number;
  eventCount: number;
  depth: number;
  slow: boolean;
  onErrorPath: boolean;
  x: number;
  y: number;
}

export interface GraphEdgeDatum {
  id: string;
  source: string;
  target: string;
  order: number;
}

export interface ProjectedGraph {
  nodes: GraphNodeDatum[];
  edges: GraphEdgeDatum[];
  truncated: boolean;
  hiddenCount: number;
  errorPathIds: string[];
  slowIds: string[];
}

export const MAX_GRAPH_NODES = 600;
const NODE_W = 240;
const NODE_H = 44;

/** Slow = objectively slow (>= 2s, same bar as findings) or dominant (>=50% of total and >= 50ms). Roots never qualify. */
export function isSlowNode(node: ExecutionNode, totalMs: number | undefined): boolean {
  if (node.type === "TRANSACTION") return false;
  const d = node.durationMs;
  if (d === undefined || d < 50) return false;
  if (d >= 2000) return true;
  return !!totalMs && totalMs > 0 && d / totalMs >= 0.5;
}

/** Failed/exception nodes plus every ancestor up to their root. */
export function errorPathIds(model: ExecutionModel): string[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const out = new Set<string>();
  for (const n of model.nodes) {
    if (n.status !== "FAILED" && n.type !== "EXCEPTION") continue;
    let cur: ExecutionNode | undefined = n;
    let guard = 0;
    while (cur && guard++ < 1000) {
      out.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return [...out];
}

export function projectExecutionGraph(model: ExecutionModel, opts?: { showAll?: boolean }): ProjectedGraph {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const totalMs = model.metadata.durationMs;
  const errorSet = new Set(errorPathIds(model));

  // Depth from roots (BFS); unreachable nodes sit at depth 0, never dropped silently.
  const depth = new Map<string, number>();
  const queue: Array<{ id: string; d: number }> = model.rootIds.map((id) => ({ id, d: 0 }));
  let guard = 0;
  while (queue.length > 0 && guard++ < model.nodes.length + 10) {
    const { id, d } = queue.shift()!;
    if (depth.has(id)) continue;
    depth.set(id, d);
    for (const c of byId.get(id)?.children ?? []) queue.push({ id: c, d: d + 1 });
  }

  let kept = model.nodes;
  let hiddenCount = 0;
  if (!opts?.showAll && model.nodes.length > MAX_GRAPH_NODES) {
    const keep = new Set<string>();
    for (const n of model.nodes) {
      if (n.status !== "SUCCESS" || isSlowNode(n, totalMs) || errorSet.has(n.id)) {
        let cur: ExecutionNode | undefined = n;
        let g = 0;
        while (cur && g++ < 1000) {
          keep.add(cur.id);
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
      }
    }
    for (const r of model.rootIds) keep.add(r);
    kept = model.nodes.filter((n) => keep.has(n.id));
    hiddenCount = model.nodes.length - kept.length;
  }

  const g = new Dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", ranksep: 60, nodesep: 28, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  const keptIds = new Set(kept.map((n) => n.id));
  for (const n of kept) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const n of kept) {
    for (const c of n.children) {
      if (keptIds.has(c)) g.setEdge(n.id, c);
    }
  }
  Dagre.layout(g);

  const slowIds: string[] = [];
  const nodes: GraphNodeDatum[] = kept.map((n) => {
    const p = g.node(n.id) as { x: number; y: number };
    const slow = isSlowNode(n, totalMs);
    if (slow) slowIds.push(n.id);
    return {
      id: n.id,
      label: n.label,
      type: n.type,
      status: n.status,
      durationMs: n.durationMs,
      eventCount: n.eventIds.length,
      depth: depth.get(n.id) ?? 0,
      slow,
      onErrorPath: errorSet.has(n.id),
      x: p.x - NODE_W / 2,
      y: p.y - NODE_H / 2,
    };
  });

  const orderOf = new Map<string, number>();
  for (const n of kept) n.children.forEach((c, i) => orderOf.set(`${n.id}->${c}`, i));
  const edges: GraphEdgeDatum[] = [];
  for (const n of kept) {
    for (const c of n.children) {
      if (!keptIds.has(c)) continue;
      edges.push({ id: `${n.id}->${c}`, source: n.id, target: c, order: orderOf.get(`${n.id}->${c}`) ?? 0 });
    }
  }

  return { nodes, edges, truncated: hiddenCount > 0, hiddenCount, errorPathIds: [...errorSet].filter((id) => keptIds.has(id)), slowIds };
}
