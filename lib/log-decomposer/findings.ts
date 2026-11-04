import type { ExecutionModel, Finding, Finding as FindingType } from "./model";

/**
 * Deterministic analysis over a parsed execution model. Rules produce
 * facts with evidence - severity is a property of the measurement, not a
 * guess. The LLM later interprets; it never has to rediscover what the
 * rules already proved.
 */

const SLOW_MS = 2000;
const VERY_SLOW_MS = 10000;
const MAX_PERF_FINDINGS = 10;
const MAX_CALLOUT_FINDINGS = 20;

const LIMIT_RE = /(?:Number of|Maximum)\s+([^:\n]+):\s*([\d,]+)\s+out of\s+([\d,]+)/gi;

function num(s: string): number {
  return Number(s.replace(/,/g, ""));
}

function finding(
  id: string,
  type: FindingType["type"],
  severity: FindingType["severity"],
  title: string,
  summary: string,
  evidence: FindingType["evidence"] = [],
  relatedNodeIds: string[] = []
): Finding {
  return { id, type, severity, title, summary, evidence, relatedNodeIds };
}

function rawRange(eventId: string, line: number, label: string) {
  return [
    { kind: "event" as const, ref: eventId, label },
    { kind: "raw-range" as const, ref: eventId, label, lineStart: Math.max(0, line - 3), lineEnd: line + 3 },
  ];
}

export function detectFindings(model: ExecutionModel): Finding[] {
  const out: Finding[] = [];
  let seq = 0;
  const fid = () => `f${++seq}`;
  const eventsById = new Map(model.events.map((e) => [e.id, e]));

  // 1. Exceptions - the first is the headline, the rest are context.
  const exceptions = model.nodes.filter((n) => n.type === "EXCEPTION");
  exceptions.forEach((n, i) => {
    const evId = n.eventIds[0];
    const ev = evId ? eventsById.get(evId) : undefined;
    out.push(
      finding(
        fid(),
        "EXCEPTION",
        i === 0 ? "CRITICAL" : "HIGH",
        n.label.length > 90 ? `${n.label.slice(0, 87)}…` : n.label,
        `${n.label} in ${parentChain(model, n.id)}.`,
        ev ? rawRange(ev.id, ev.line, n.label) : [{ kind: "node", ref: n.id, label: n.label }],
        [n.id]
      )
    );
  });

  // 2. Governor limits - every LIMIT-category event raw may hold a whole
  // multi-line block, so keep the peak use per metric.
  const peaks = new Map<string, { used: number; total: number }>();
  for (const e of model.events) {
    if (e.category !== "LIMIT") continue;
    for (const m of e.raw.matchAll(LIMIT_RE)) {
      const name = m[1].trim();
      const used = num(m[2]);
      const total = num(m[3]);
      const prev = peaks.get(name);
      if (!prev || used > prev.used) peaks.set(name, { used, total });
    }
  }
  for (const [name, { used, total }] of peaks) {
    const pct = total > 0 ? (used / total) * 100 : 0;
    if (pct < 50) continue;
    const severity = pct >= 95 ? "CRITICAL" : pct >= 80 ? "HIGH" : "MEDIUM";
    const bar = usageBar(pct);
    const lastLine = model.events.filter((e) => e.type === "LIMIT_USAGE_FOR_NS").at(-1);
    out.push(
      finding(
        fid(),
        "GOVERNOR_LIMIT",
        severity,
        `${name}: ${used}/${total}`,
        `${bar} ${pct.toFixed(0)}% of the ${name} budget consumed.`,
        lastLine
          ? [{ kind: "event", ref: lastLine.id, label: `${name} peak`, lineStart: lastLine.line, lineEnd: lastLine.line }]
          : []
      )
    );
  }

  // 3. Performance - slow structural nodes, slowest first, capped.
  const slow = model.nodes
    .filter((n) => ["SOQL", "DML", "CALLOUT", "METHOD"].includes(n.type) && (n.durationMs ?? 0) >= SLOW_MS)
    .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
    .slice(0, MAX_PERF_FINDINGS);
  for (const n of slow) {
    const ms = n.durationMs ?? 0;
    out.push(
      finding(
        fid(),
        "PERFORMANCE",
        ms >= VERY_SLOW_MS ? "HIGH" : "MEDIUM",
        `Slow ${n.type.toLowerCase()}: ${ms.toLocaleString()}ms`,
        `${n.label} held the transaction for ${ms.toLocaleString()}ms.`,
        [{ kind: "node", ref: n.id, label: n.label }],
        [n.id]
      )
    );
  }

  // 4. Callouts - one INFO each, endpoint + outcome preserved.
  const callouts = model.nodes.filter((n) => n.type === "CALLOUT").slice(0, MAX_CALLOUT_FINDINGS);
  for (const n of callouts) {
    const failedChild = n.children.some((c) => model.nodes.find((x) => x.id === c)?.type === "EXCEPTION");
    out.push(
      finding(
        fid(),
        "CALLOUT",
        failedChild ? "HIGH" : "INFO",
        n.label,
        `${n.label}${n.durationMs !== undefined ? ` completed in ${n.durationMs.toLocaleString()}ms` : ""}.`,
        [{ kind: "node", ref: n.id, label: n.label }],
        [n.id]
      )
    );
  }

  // 5. Anomalies - structural smells, never root-cause claims.
  if (exceptions.length > 1) {
    out.push(
      finding(
        fid(),
        "ANOMALY",
        "HIGH",
        `${exceptions.length} exceptions in one transaction`,
        "More than one exception was thrown - later failures may be fallout from the first, not independent causes.",
        [],
        exceptions.map((n) => n.id)
      )
    );
  }
  const dupes = duplicateSoql(model);
  if (dupes.length > 0) {
    const [query, count] = dupes[0];
    out.push(
      finding(
        fid(),
        "ANOMALY",
        count >= 10 ? "MEDIUM" : "LOW",
        `Repeated SOQL ×${count}`,
        `"${query.length > 100 ? `${query.slice(0, 97)}…` : query}" executed ${count} times - a bulkification candidate.`,
        []
      )
    );
  }

  return out;
}

function parentChain(model: ExecutionModel, nodeId: string): string {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const chain: string[] = [];
  let cur = byId.get(nodeId)?.parentId ? byId.get(byId.get(nodeId)!.parentId!) : undefined;
  let guard = 0;
  while (cur && guard++ < 8) {
    chain.unshift(cur.label.length > 48 ? `${cur.label.slice(0, 45)}…` : cur.label);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain.length > 0 ? chain.join(" → ") : "transaction root";
}

function usageBar(pct: number): string {
  const filled = Math.round(Math.min(100, pct) / 10);
  return `█${"█".repeat(filled)}${"░".repeat(Math.max(0, 10 - filled))}`;
}

function normalizeQuery(q: string): string {
  return q.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Identical SOQL text executed more than 3 times, most-repeated first. */
export function duplicateSoql(model: ExecutionModel): Array<[string, number]> {
  const counts = new Map<string, { query: string; count: number }>();
  for (const n of model.nodes) {
    if (n.type !== "SOQL") continue;
    const key = normalizeQuery(n.label);
    if (!key) continue;
    const prev = counts.get(key);
    if (prev) prev.count++;
    else counts.set(key, { query: n.label, count: 1 });
  }
  return [...counts.values()]
    .filter((c) => c.count > 3)
    .sort((a, b) => b.count - a.count)
    .map((c) => [c.query, c.count] as [string, number]);
}
