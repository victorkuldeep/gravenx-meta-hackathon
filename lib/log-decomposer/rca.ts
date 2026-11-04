import type { DebugSession, Finding, RootCauseAnalysis } from "./model";

/**
 * RCA drafting + handoff brief. The draft is composed deterministically
 * from findings (headlines first, evidence attached) - the engineer and
 * the investigator then refine it. The brief is address-by-reference:
 * execution ids and line numbers, never pasted raw log.
 */

function topFinding(findings: Finding[]): Finding | null {
  const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  return [...findings].sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))[0] ?? null;
}

/** Deterministic first draft from the session's rolled-up findings. */
export function draftRcaFromSession(session: DebugSession): RootCauseAnalysis {
  const findings = session.executions.flatMap((e) => e.findings);
  const head = topFinding(findings);
  const exceptions = findings.filter((f) => f.type === "EXCEPTION");
  const limits = findings.filter((f) => f.type === "GOVERNOR_LIMIT");
  const contributing: string[] = [];
  for (const f of findings) {
    if (f === head) continue;
    if (contributing.length >= 5) break;
    contributing.push(`${f.title} (${f.severity.toLowerCase()})`);
  }
  const recommendations: string[] = [];
  if (exceptions.length > 0) recommendations.push("Add failure handling around the failing call path - retry with backoff or move it async.");
  if (limits.length > 0) recommendations.push("Bulkify the hot path - the limit findings name the exact budget under pressure.");
  if (findings.some((f) => f.type === "PERFORMANCE")) recommendations.push("Break the slowest operation out of the synchronous transaction.");
  return {
    summary: head ? `${head.title} in "${session.title}".` : `No findings yet in "${session.title}" - pull and decompose a log first.`,
    rootCause: head ? head.summary : undefined,
    contributingFactors: contributing,
    evidence: head ? head.evidence : [],
    impact: undefined,
    recommendations,
    confidence: head && head.severity === "CRITICAL" ? "HIGH" : head ? "MEDIUM" : "LOW",
    createdAt: Date.now(),
  };
}

/** Markdown handoff: problem + cause + evidence + fix - paste into Jira or hand to a coding agent. */
export function composeHandoffBrief(session: DebugSession, rca: RootCauseAnalysis): string {
  const lines: string[] = [
    `# ${session.title} - RCA brief`,
    ``,
    `Problem: ${session.problem || "(not stated)"}`,
    ``,
    `## Root cause`,
    rca.rootCause ?? "(not established)",
    ``,
  ];
  if (rca.contributingFactors.length > 0) {
    lines.push(`## Contributing factors`, ...rca.contributingFactors.map((f) => `- ${f}`), ``);
  }
  if (rca.evidence.length > 0) {
    lines.push(
      `## Evidence`,
      ...rca.evidence.map((e) => `- ${e.kind} ${e.ref}${e.label ? ` - ${e.label}` : ""}${e.lineStart !== undefined ? ` (lines ${e.lineStart + 1}-${(e.lineEnd ?? e.lineStart) + 1})` : ""}`),
      ``
    );
  }
  if (rca.impact) lines.push(`## Impact`, rca.impact, ``);
  if (rca.recommendations.length > 0) {
    lines.push(`## Recommended fix`, ...rca.recommendations.map((r, i) => `${i + 1}. ${r}`), ``);
  }
  lines.push(`Confidence: ${rca.confidence}`, ``, `Session: ${session.id} · ${session.executions.length} execution(s) · ${session.logs.length} log(s)`);
  return lines.join("\n");
}
