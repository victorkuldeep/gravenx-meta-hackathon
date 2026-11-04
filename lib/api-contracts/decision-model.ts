import type { ApiProject, Decision, DecisionStatus } from "./types";

/**
 * Decision register: explicit transitions only. Proposed assistant
 * output never compiles until accepted - enforced by the compiler
 * reading decisions, never suggestions-in-flight.
 */

let seq = 0;
export function newDecisionId(prefix = "dec"): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq}`;
}

const TRANSITIONS: Record<DecisionStatus, DecisionStatus[]> = {
  proposed: ["accepted", "rejected", "deferred", "needs-clarification"],
  "needs-clarification": ["accepted", "rejected", "deferred", "proposed"],
  deferred: ["proposed", "accepted", "rejected"],
  accepted: ["deferred"],
  rejected: ["proposed"],
};

export function canTransition(from: DecisionStatus, to: DecisionStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function setDecisionStatus(
  project: ApiProject,
  id: string,
  to: DecisionStatus
): { project: ApiProject; ok: boolean } {
  const d = project.decisions.find((x) => x.id === id);
  if (!d || !canTransition(d.status, to)) return { project, ok: false };
  return {
    project: {
      ...project,
      updatedAt: Date.now(),
      decisions: project.decisions.map((x) => (x.id === id ? { ...x, status: to } : x)),
    },
    ok: true,
  };
}

/**
 * Approved decisions feed the compiler. Convention: architect-authored
 * decisions are created accepted (authoring IS the decision); assistant
 * output is created proposed and only compiles after explicit accept.
 * Nothing proposed ever compiles - enforced by this single gate.
 */
export function approvedDecisions(project: ApiProject): Decision[] {
  return project.decisions.filter((d) => d.status === "accepted");
}
