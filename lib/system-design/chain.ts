"use client";

import type { SystemConnection, SystemProject } from "./model";

/**
 * Chain resolution (pure topology): from a start edge, walk every downstream
 * edge regardless of readiness. Readiness gates EXECUTION, not traversal -
 * the executor stops lanes at unbound edges with a note, runs lanes whose
 * target op is bound (even when the far end is unbound - non-first hops only
 * need their target op), and honors per-edge operation overrides (which let
 * a run simulate an otherwise unbound edge). Fan-out runs every branch
 * (shared prefix executes once per lane trace); cycles stop with a note;
 * dead ends stop silently. Hop and breadth caps bound pathological canvases.
 * A lane is an ordered edge list - the executor walks it hop by hop.
 */

export const CHAIN_MAX_HOPS = 25;

/** Max lanes per resolution: breadth (fan-out product) is otherwise unbounded. */
export const CHAIN_MAX_LANES = 50;

export interface ChainLane {
  edges: SystemConnection[];
  stopped: string | null;
}

export function resolveChain(
  project: Pick<SystemProject, "connections">,
  startEdgeId: string,
  maxHops = CHAIN_MAX_HOPS
): ChainLane[] {
  const bySource = new Map<string, SystemConnection[]>();
  for (const c of project.connections) {
    const list = bySource.get(c.sourceId) ?? [];
    list.push(c);
    bySource.set(c.sourceId, list);
  }
  // Deterministic fan-out order: label, then id.
  for (const list of bySource.values()) {
    list.sort((a, b) => (a.label || "").localeCompare(b.label || "") || (a.id < b.id ? -1 : 1));
  }
  const start = project.connections.find((c) => c.id === startEdgeId);
  if (!start) return [];
  const lanes: ChainLane[] = [];
  // DFS carrying the lane; shared prefixes re-execute per lane (documented:
  // lanes are independent traces, not exactly-once delivery).
  const walk = (edge: SystemConnection, lane: SystemConnection[], visited: Set<string>) => {
    if (lane.length >= maxHops) {
      lanes.push({ edges: lane, stopped: `Hop cap (${maxHops}) reached - chain truncated.` });
      return;
    }
    if (visited.has(edge.id)) {
      lanes.push({ edges: lane, stopped: `Cycle detected at ${edge.id} - stopped, not looped.` });
      return;
    }
    const next = [...lane, edge];
    const visitedNext = new Set(visited);
    visitedNext.add(edge.id);
    const outgoing = (bySource.get(edge.targetId) ?? []).filter((c) => c.id !== edge.id);
    if (outgoing.length === 0) {
      lanes.push({ edges: next, stopped: null });
      return;
    }
    for (const o of outgoing) walk(o, next, visitedNext);
  };
  walk(start, [], new Set());
  if (lanes.length > CHAIN_MAX_LANES) {
    const kept = lanes.slice(0, CHAIN_MAX_LANES);
    const last = kept[kept.length - 1];
    last.stopped =
      last.stopped ??
      `Lane breadth cap (${CHAIN_MAX_LANES}) reached - ${lanes.length - CHAIN_MAX_LANES} further lane(s) truncated.`;
    return kept;
  }
  return lanes;
}

/** Edges in a lane missing a stored mapping (run as passthrough, stated). */
export function unmappedEdges(lane: ChainLane): string[] {
  return lane.edges.filter((e) => !e.mapping).map((e) => e.id);
}
