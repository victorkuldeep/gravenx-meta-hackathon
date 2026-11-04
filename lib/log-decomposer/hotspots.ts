import type { ExecutionModel, ExecutionNode } from "./model";

/**
 * Hotspots: bottom-up aggregation over one execution. Profiler-style -
 * SOQL differing only in literals folds into one signature, methods fold
 * by class + name, and self-time (own duration minus children) surfaces
 * where time is actually spent instead of where it merely passes through.
 * Self-time is an approximation: overlapping child spans double-subtract.
 */

export interface Hotspot {
  key: string;
  kind: "SOQL" | "METHOD" | "DML" | "CALLOUT" | "TRIGGER" | "FLOW" | "OTHER";
  label: string;
  calls: number;
  totalMs: number;
  selfMs: number;
  maxMs: number;
  nodeIds: string[];
}

/** SELECT .. WHERE Id = '001xx' AND N = 3  ->  SELECT .. WHERE Id = ? AND N = ? */
export function fingerprintSoql(label: string): string {
  return label
    .replace(/'[^']*'/g, "'?'")
    .replace(/\b\d+(\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** "InvoiceService.postLines(String, Integer)" -> "InvoiceService.postLines" */
export function fingerprintMethod(label: string): string {
  return label.split("(")[0].trim().slice(0, 120);
}

function kindOf(type: ExecutionNode["type"]): Hotspot["kind"] {
  switch (type) {
    case "SOQL": return "SOQL";
    case "METHOD": case "CODE_UNIT": return "METHOD";
    case "DML": return "DML";
    case "CALLOUT": return "CALLOUT";
    case "TRIGGER": return "TRIGGER";
    case "FLOW": return "FLOW";
    default: return "OTHER";
  }
}

function signatureOf(node: ExecutionNode, kind: Hotspot["kind"]): string {
  if (kind === "SOQL") return fingerprintSoql(node.label);
  if (kind === "METHOD") return fingerprintMethod(node.label);
  return node.label.slice(0, 120);
}

export function aggregateHotspots(model: ExecutionModel, top = 12): Hotspot[] {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const groups = new Map<string, Hotspot>();
  for (const n of model.nodes) {
    if (n.durationMs === undefined || n.type === "TRANSACTION") continue;
    const kind = kindOf(n.type);
    if (kind === "OTHER") continue;
    const sig = signatureOf(n, kind);
    const key = `${kind}::${sig}`;
    let childMs = 0;
    for (const c of n.children) childMs += byId.get(c)?.durationMs ?? 0;
    const self = Math.max(0, (n.durationMs ?? 0) - childMs);
    const g = groups.get(key);
    if (g) {
      g.calls += 1;
      g.totalMs += n.durationMs ?? 0;
      g.selfMs += self;
      g.maxMs = Math.max(g.maxMs, n.durationMs ?? 0);
      if (g.nodeIds.length < 5) g.nodeIds.push(n.id);
    } else {
      groups.set(key, { key, kind, label: sig, calls: 1, totalMs: n.durationMs ?? 0, selfMs: self, maxMs: n.durationMs ?? 0, nodeIds: [n.id] });
    }
  }
  return [...groups.values()].sort((a, b) => b.totalMs - a.totalMs).slice(0, top);
}
