import type { RunVerdict } from "./runStore";

/**
 * Deterministic run verdict (validation epic). Compares the terminal run
 * status against the scenario expectation at save time and pins the
 * outcome with the evidence - the Runs tab never re-judges history.
 *
 * Same status class passes (201 satisfies "expect 200"; 502 reproduces
 * "expect 500" - the feared condition materialized either way).
 * No expectation means no verdict - unstated reads as unstated, and the
 * finding stays covered rather than pretending proof.
 */
export function computeVerdict(expectStatus: number | null, actualStatus: number): RunVerdict | null {
  if (expectStatus == null) return null;
  if (Math.floor(actualStatus / 100) === Math.floor(expectStatus / 100)) return "pass";
  return "fail";
}
