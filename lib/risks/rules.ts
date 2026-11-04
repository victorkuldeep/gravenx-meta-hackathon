import type { SystemProject } from "@/lib/system-design/model";
import type { SequenceDocument } from "@/lib/sequence/model";

/**
 * Architecture risk lens (Epic 4) - deterministic rules over the model.
 * Every finding cites concrete records (ids + names); nothing is inferred,
 * guessed, or AI-opined. Absent policy means unstated - rules report the
 * gap, never assume a default.
 */

export type RiskSeverity = "high" | "medium" | "low";

export interface RiskRef {
  surface: "system" | "sequence";
  id: string;
  name: string;
}

export interface RiskFinding {
  rule: string;
  severity: RiskSeverity;
  message: string;
  refs: RiskRef[];
}

function opName(p: SystemProject, opId: string): string {
  const op = p.operations.find((o) => o.id === opId);
  return op ? `${op.method} ${op.path}`.trim() || op.name : opId;
}

function sysName(p: SystemProject, id: string): string {
  return p.systems.find((s) => s.id === id)?.name ?? id;
}

/** Longest simple path (node count) over connections. Small canvases only. */
function longestChain(p: SystemProject): string[] {
  const adj = new Map<string, string[]>();
  for (const c of p.connections) {
    const list = adj.get(c.sourceId) ?? [];
    list.push(c.targetId);
    adj.set(c.sourceId, list);
  }
  let best: string[] = [];
  const visit = (id: string, path: string[]) => {
    if (path.includes(id)) return;
    const next = [...path, id];
    if (next.length > best.length) best = next;
    for (const t of adj.get(id) ?? []) visit(t, next);
  };
  for (const s of p.systems) visit(s.id, []);
  return best;
}

function eachMessage(nodes: SequenceDocument["nodes"], fn: (m: { label: string; kind: string; retry?: unknown; timeoutSecs?: number }) => void): void {
  for (const n of nodes ?? []) {
    if (n.nodeType === "block") {
      eachMessage(n.children, fn);
      if (n.elseChildren) eachMessage(n.elseChildren, fn);
      continue;
    }
    fn(n);
  }
}

/**
 * Sequences touching this project: a participant maps to one of its
 * systems (by id or name), or a message invokes one of its operations
 * (by id, "METHOD path", or operation name).
 */
export function sequencesForProject(p: SystemProject, seqs: SequenceDocument[]): SequenceDocument[] {
  const sysIds = new Set(p.systems.map((s) => s.id));
  const sysNames = new Set(p.systems.map((s) => s.name.toLowerCase()));
  const opIds = new Set(p.operations.map((o) => o.id));
  const opNames = new Set(
    p.operations.flatMap((o) => [`${o.method} ${o.path}`.trim().toLowerCase(), o.name.toLowerCase()]),
  );
  const touches = (doc: SequenceDocument): boolean => {
    for (const pt of doc.participants ?? []) {
      if (pt.systemRef && (sysIds.has(pt.systemRef) || sysNames.has(pt.systemRef.toLowerCase()))) return true;
    }
    let hit = false;
    eachMessage(doc.nodes, (m) => {
      const r = (m as { operationRef?: string }).operationRef;
      if (r && (opIds.has(r) || opNames.has(r.toLowerCase()))) hit = true;
    });
    return hit;
  };
  return seqs.filter(touches);
}

export function analyzeProject(p: SystemProject, sequences: SequenceDocument[] = []): RiskFinding[] {
  const findings: RiskFinding[] = [];

  // R1 - unbounded synchronous chain: one slow hop stalls every downstream system.
  const chain = longestChain(p);
  if (chain.length >= 4) {
    findings.push({
      rule: "sync-chain",
      severity: "medium",
      message: `Synchronous chain of ${chain.length} systems (${chain.map((id) => sysName(p, id)).join(" → ")}): one slow hop stalls everything downstream.`,
      refs: chain.map((id) => ({ surface: "system" as const, id, name: sysName(p, id) })),
    });
  }

  // R2/R3 - bound operations with no timeout / no retry stated.
  const seenTimeout = new Set<string>();
  const seenRetry = new Set<string>();
  for (const c of p.connections) {
    for (const opId of [c.sourceOperationId, c.targetOperationId]) {
      if (!opId) continue;
      const op = p.operations.find((o) => o.id === opId);
      if (!op || op.method === "EVENT") continue;
      if (op.policy?.timeoutSecs === undefined && !seenTimeout.has(opId)) {
        seenTimeout.add(opId);
        findings.push({
          rule: "no-timeout",
          severity: "medium",
          message: `No timeout on ${opName(p, opId)} (${c.label || "unlabeled link"}): a hung downstream holds the hop open.`,
          refs: [{ surface: "system", id: opId, name: opName(p, opId) }],
        });
      }
      if (op.policy?.retryAttempts === undefined && op.policy?.idempotency !== true && !seenRetry.has(opId)) {
        seenRetry.add(opId);
        findings.push({
          rule: "no-retry",
          severity: "low",
          message: `No retry stated on ${opName(p, opId)}: transient failures become permanent.`,
          refs: [{ surface: "system", id: opId, name: opName(p, opId) }],
        });
      }
    }
  }

  // R4 - fan-in hub: many systems route through one with no alternative stated.
  const inbound = new Map<string, Set<string>>();
  for (const c of p.connections) {
    if (c.sourceId === c.targetId) continue;
    let s = inbound.get(c.targetId);
    if (!s) inbound.set(c.targetId, (s = new Set()));
    s.add(c.sourceId);
  }
  for (const [targetId, sources] of inbound) {
    if (sources.size >= 3) {
      findings.push({
        rule: "fan-in-hub",
        severity: "medium",
        message: `${sources.size} systems route through ${sysName(p, targetId)} with no alternative path stated: single point of failure.`,
        refs: [{ surface: "system", id: targetId, name: sysName(p, targetId) }],
      });
    }
  }

  // R5 - unversioned operations: consumers cannot pin a contract.
  for (const op of p.operations) {
    if (op.version.trim() === "") {
      findings.push({
        rule: "unversioned-api",
        severity: "low",
        message: `${opName(p, op.id)} carries no version: consumers cannot pin the contract.`,
        refs: [{ surface: "system", id: op.id, name: opName(p, op.id) }],
      });
    }
  }

  // R6 - naked sync calls in sequences: neither timeout nor retry.
  for (const doc of sequences) {
    const naked: string[] = [];
    eachMessage(doc.nodes, (m) => {
      if (m.kind === "sync" && m.timeoutSecs === undefined && m.retry === undefined) {
        naked.push(m.label || "unlabeled message");
      }
    });
    if (naked.length > 0) {
      findings.push({
        rule: "naked-sync",
        severity: "medium",
        message: `${doc.name}: ${naked.length} sync call${naked.length === 1 ? "" : "s"} state neither timeout nor retry (${naked.slice(0, 3).join(" · ")}${naked.length > 3 ? " …" : ""}).`,
        refs: [{ surface: "sequence", id: doc.id, name: doc.name }],
      });
    }
  }

  return findings;
}
