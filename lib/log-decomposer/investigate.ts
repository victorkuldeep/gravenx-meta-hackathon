import type { ExecutionModel, Finding } from "./model";

export interface InvestigationVerdict {
  status: "failed" | "warning" | "clean";
  headline: string;
  bullets: string[];
  narrative: string[];
}

/**
 * Deterministic investigation result: the decomposition already proves
 * what happened, so the tab concludes first and asks questions later.
 * Null when nothing is decomposed yet - the panel shows the empty state.
 */
export function summarizeInvestigation(executions: ExecutionModel[], findings: Finding[]): InvestigationVerdict | null {
  const exec = executions[executions.length - 1] ?? null;
  if (!exec) return null;
  const op = exec.metadata.operation ?? "Transaction";
  const ms = exec.metadata.durationMs;
  const timed = typeof ms === "number" ? ` in ${ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`}` : "";
  const m = exec.metrics;
  const shape = `${exec.nodes.length} nodes, ${m.eventCount} events, ${m.soqlCount} SOQL, ${m.dmlCount} DML, ${m.calloutCount} callouts`;

  const narrative = exec.nodes.slice(0, 8).map((n) => {
    const d = typeof n.durationMs === "number" ? ` · ${n.durationMs}ms` : "";
    const bad = n.status === "FAILED" || n.status === "WARNING" ? ` · ${n.status}` : "";
    return `${n.label}${d}${bad}`;
  });

  const sorted = [...findings].sort((a, b) => rank(b.severity) - rank(a.severity));
  const top = sorted[0];
  if (top && (top.severity === "CRITICAL" || top.type === "EXCEPTION")) {
    return {
      status: "failed",
      headline: `${op} failed - ${top.title}`,
      bullets: [top.summary, ...sorted.slice(1, 3).map((f) => f.summary), `Shape: ${shape}${timed}.`],
      narrative,
    };
  }
  if (top && (top.severity === "HIGH" || top.severity === "MEDIUM")) {
    return {
      status: "warning",
      headline: `${op} succeeded with warnings - ${top.title}`,
      bullets: [top.summary, ...sorted.slice(1, 3).map((f) => f.summary), `Shape: ${shape}${timed}.`],
      narrative,
    };
  }
  return {
    status: "clean",
    headline: `${op} ran clean${timed} - no rule fired`,
    bullets: [`Shape: ${shape}.`, "No exceptions, no governor pressure, no slow nodes, no failed callouts."],
    narrative,
  };
}

function rank(sev: Finding["severity"]): number {
  return sev === "CRITICAL" ? 4 : sev === "HIGH" ? 3 : sev === "MEDIUM" ? 2 : sev === "LOW" ? 1 : 0;
}

/**
 * Deterministic hypothesis drafting: turn the top rule finding of each
 * kind into a one-click hypothesis draft. No LLM, no guessing - the
 * engineer accepts, edits or discards. Empty when the log is clean.
 */
export function suggestHypotheses(findings: Finding[]): string[] {
  const pick = (type: Finding["type"]): Finding | undefined => findings.find((f) => f.type === type);
  const out: string[] = [];
  const ex = pick("EXCEPTION");
  if (ex) out.push(`${ex.title} aborts the transaction - verify the failing input and the nearest catch.`);
  const gov = pick("GOVERNOR_LIMIT");
  if (gov) out.push(`${gov.title} - cut consumption or move work async before the org rejects the transaction.`);
  const perf = pick("PERFORMANCE");
  if (perf) out.push(`${perf.title} - profile the dominant node before optimizing.`);
  const call = pick("CALLOUT");
  if (call) out.push(`${call.title} - confirm endpoint behavior and timeout handling.`);
  const anom = pick("ANOMALY");
  if (!ex && anom) out.push(`${anom.title} - rule it out before closing the investigation.`);
  return out.slice(0, 3);
}
