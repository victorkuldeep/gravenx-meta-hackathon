import { resolveChain } from "@/lib/system-design/chain";
import type { FlowDef, SystemProject } from "@/lib/system-design/model";
import { guessSystemType, type TopologyDraft } from "@/lib/draw/toSystemDraft";
import { newId, type SequenceDocument, type SeqNode } from "./model";

/**
 * Sequence <-> System bridge (EPIC 05): honest-lossy in both directions.
 *
 * System -> Sequence: a flow's lanes become statements (lane separators
 * when a flow fans out; operation bindings and mocks stay behind - the
 * dialog says so). Whole-project import flattens every connection.
 * Sequence -> System: participants become draft systems, messages become
 * labeled edges, control blocks collapse into warnings + edge labels.
 */

export interface BridgeImport {
  statements: string;
  warnings: string[];
}

function sysName(project: SystemProject, id: string): string {
  return project.systems.find((s) => s.id === id)?.name ?? id;
}

function laneStatements(project: SystemProject, edgeIds: string[]): string[] {
  return edgeIds.map((id) => {
    const e = project.connections.find((c) => c.id === id);
    if (!e) return null;
    return `${sysName(project, e.sourceId)} -> ${sysName(project, e.targetId)}: ${e.label || "call"}`;
  }).filter((s): s is string => s !== null);
}

/** One flow's run path as statements. Lanes beyond the first get separators. */
export function flowToStatements(project: SystemProject, flow: FlowDef): BridgeImport {
  const warnings: string[] = [];
  const lanes = resolveChain(project, flow.startEdgeId);
  if (lanes.length === 0) {
    return { statements: "", warnings: [`Flow "${flow.name}" resolves to no lanes from its start edge.`] };
  }
  const picked = flow.lanes.length > 0 ? flow.lanes.filter((i) => i >= 0 && i < lanes.length) : lanes.map((_, i) => i);
  if (picked.length === 0) {
    return { statements: "", warnings: [`Flow "${flow.name}" picks lanes that no longer exist.`] };
  }
  const names = new Set<string>();
  for (const i of picked) {
    for (const e of lanes[i].edges) {
      names.add(sysName(project, e.sourceId));
      names.add(sysName(project, e.targetId));
    }
    if (lanes[i].stopped) warnings.push(`Lane ${i + 1}: ${lanes[i].stopped}`);
  }
  const L = [...names].map((n) => `participant ${n}`);
  picked.forEach((laneIdx) => {
    if (picked.length > 1) L.push(`note Lane ${laneIdx + 1} of flow "${flow.name}"`);
    L.push(...laneStatements(project, lanes[laneIdx].edges.map((e) => e.id)));
  });
  if (Object.keys(flow.opByEdge).length > 0) {
    warnings.push("Per-edge operation overrides stay in System - statements carry labels only.");
  }
  return { statements: L.join("\n"), warnings };
}

/** Whole project topology as statements (no lanes, no conditions). */
export function projectToStatements(project: SystemProject): BridgeImport {
  const names = project.systems.map((s) => `participant ${s.name}`);
  const msgs = project.connections.map((c) => `${sysName(project, c.sourceId)} -> ${sysName(project, c.targetId)}: ${c.label || "call"}`);
  const warnings =
    project.flows.length > 0
      ? [`${project.flows.length} saved flow(s) ignored - pick one for lane-accurate statements.`]
      : [];
  return { statements: [...names, ...msgs].join("\n"), warnings };
}

/** Flatten messages with their block context for edge labels. */
function flatten(nodes: SeqNode[], ctx: string[]): { from: string; to: string; label: string }[] {
  const out: { from: string; to: string; label: string }[] = [];
  for (const n of nodes) {
    if (n.nodeType === "message") {
      out.push({ from: n.from, to: n.to, label: ctx.length > 0 ? `[${ctx.join(" / ")}] ${n.label}` : n.label });
    } else if (n.type !== "note") {
      const tag = n.type.toUpperCase() + (n.iterator ? ` ${n.iterator}` : n.condition ? ` ${n.condition}` : n.attempts ? ` ${n.attempts}x` : "");
      out.push(...flatten(n.children, [...ctx, tag]));
      if (n.elseChildren) out.push(...flatten(n.elseChildren, [...ctx, "ELSE"]));
    }
  }
  return out;
}

/** Experience -> topology draft through the shared whiteboard contract. */
export function sequenceToDraft(doc: SequenceDocument): TopologyDraft {
  const systems: TopologyDraft["systems"] = doc.participants.map((p, i) => ({
    key: p.id,
    name: p.name,
    systemType: guessSystemType(p.name),
    x: 120 + i * 280,
    y: 140,
  }));
  const flat = flatten(doc.nodes, []).slice(0, 200);
  const connections: TopologyDraft["connections"] = flat.map((m, i) => {
    const from = doc.participants.find((p) => p.id === m.from || p.name === m.from);
    const to = doc.participants.find((p) => p.id === m.to || p.name === m.to);
    return {
      key: `conn-${newId("c")}-${i}`,
      fromKey: from?.id ?? m.from,
      toKey: to?.id ?? m.to,
      label: (m.label || "call").slice(0, 160),
    };
  });
  const warnings: string[] = [];
  const blocks = countBlocks(doc.nodes);
  if (blocks > 0) warnings.push(`${blocks} control block(s) flattened - loops, conditions and retries travel as labeled edges, not semantics.`);
  const nonSync = countNonSync(doc.nodes);
  if (nonSync > 0) warnings.push(`${nonSync} response/async arrow(s) travel as plain edges - direction kept, kind noted in labels.`);
  return { systems, connections, warnings: warnings.filter(Boolean) };
}

function countBlocks(nodes: SeqNode[]): number {
  let n = 0;
  for (const x of nodes) {
    if (x.nodeType === "block" && x.type !== "note") {
      n++;
      n += countBlocks(x.children) + countBlocks(x.elseChildren ?? []);
    }
  }
  return n;
}

function countNonSync(nodes: SeqNode[]): number {
  let n = 0;
  for (const x of nodes) {
    if (x.nodeType === "message") {
      if (x.kind !== "sync") n++;
    } else {
      n += countNonSync(x.children) + countNonSync(x.elseChildren ?? []);
    }
  }
  return n;
}
