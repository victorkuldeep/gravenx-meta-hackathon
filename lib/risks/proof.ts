import type { RiskFinding } from "./rules";
import type { ScenarioDef } from "@/lib/system-design/model";
import type { SystemRunRecord } from "@/lib/system-design/runStore";

/**
 * Proof states for risk findings (validation epic) - derived from
 * scenarios + pinned run evidence, never hand-marked.
 *
 * - unproven: no scenario validates this finding.
 * - covered: a scenario names it, but no fresh proving run exists.
 * - proven-live: a fresh passing run with no mocks in play.
 * - proven-mock: a fresh passing run executed under mock overrides.
 * - failed: a fresh failing run reproduced the feared condition -
 *   the risk is confirmed real, not theoretical. Loudest state wins.
 *
 * Runs older than the project retention window never count as proof;
 * the finding decays back to covered. Runs whose scenario was deleted
 * are orphaned evidence - without the test definition they prove
 * nothing and are ignored.
 */

export type ProofState = "unproven" | "covered" | "proven-live" | "proven-mock" | "failed";

export interface FindingProof {
  key: string;
  state: ProofState;
  scenarioIds: string[];
  provingRunIds: string[];
  failedRunIds: string[];
}

/** Stable identity for a finding, shared by the dialog, AI tools and pack. */
export function findingKey(f: Pick<RiskFinding, "rule" | "refs">): string {
  return `${f.rule}:${f.refs.map((r) => r.id).join(",")}`;
}

/** A scenario covers a finding when it names the rule and one cited record. */
export function coveringScenarios(f: RiskFinding, scenarios: ScenarioDef[]): ScenarioDef[] {
  const refIds = new Set(f.refs.map((r) => r.id));
  return scenarios.filter((s) => (s.validates ?? []).some((v) => v.rule === f.rule && refIds.has(v.refId)));
}

/** A run executed under mocks: its own step labels say so, or the scenario
 * that launched it carried mock overrides. Label wins when they disagree -
 * the run is the evidence, the scenario is the intent. */
function runWasMocked(run: SystemRunRecord, scenario: ScenarioDef | undefined): boolean {
  const labeled = (run.steps ?? []).some((s) => s.label.includes("(mock)")) || run.operationName.includes("(mock)");
  if (labeled) return true;
  return scenario !== undefined && Object.keys(scenario.mockOverrides).length > 0;
}

export function proveFindings(
  findings: RiskFinding[],
  scenarios: ScenarioDef[],
  runs: SystemRunRecord[],
  retentionDays: number,
  now: number = Date.now(),
): FindingProof[] {
  const days = Number.isFinite(retentionDays) ? Math.min(365, Math.max(1, Math.trunc(retentionDays))) : 30;
  const retentionMs = days * 24 * 3600 * 1000;
  const refIdsOf = (f: RiskFinding) => new Set(f.refs.map((r) => r.id));
  return findings.map((f) => {
    const refIds = refIdsOf(f);
    const covering = coveringScenarios(f, scenarios);
    // Interpret each linked run through its own scenario's test intent:
    // reproduce + met expectation = risk confirmed; withstand + met
    // expectation = design held. A miss always confirms exposure - a
    // withstand run that failed met the feared outcome, and a reproduce
    // run that unexpectedly succeeded showed the design holding.
    const confirmed: string[] = [];
    const proved: { id: string; live: boolean }[] = [];
    for (const s of covering) {
      const mode = (s.validates ?? []).find((v) => v.rule === f.rule && refIds.has(v.refId))?.mode ?? "withstand";
      for (const r of runs) {
        if (r.scenarioId !== s.id || now - r.createdAt > retentionMs) continue;
        if (r.verdict !== "pass" && r.verdict !== "fail" && r.verdict !== "override-pass") continue;
        const met = r.verdict === "pass" || r.verdict === "override-pass";
        const holds = mode === "withstand" ? met : !met;
        if (holds) proved.push({ id: r.id, live: !runWasMocked(r, s) });
        else confirmed.push(r.id);
      }
    }
    const state: ProofState =
      confirmed.length > 0
        ? "failed"
        : proved.some((p) => p.live)
          ? "proven-live"
          : proved.length > 0
            ? "proven-mock"
            : covering.length > 0
              ? "covered"
              : "unproven";
    return {
      key: findingKey(f),
      state,
      scenarioIds: covering.map((s) => s.id),
      provingRunIds: proved.map((p) => p.id),
      failedRunIds: confirmed,
    };
  });
}
