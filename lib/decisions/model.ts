import { z } from "zod";

/**
 * Decisions domain model - Architecture Decision Records for GRAVENX.
 *
 * A Decision is a text-and-relationship artifact, not a canvas: status,
 * context, the decision itself, alternatives considered, consequences, and
 * links addressing the architecture it governs (never duplicating it).
 * Link resolution (id-first, name-fallback, visible unresolved) lives in
 * the graph index (Epic 2); the model only carries the addresses.
 */

export const DECISION_STATUSES = ["proposed", "in-review", "accepted", "deprecated", "superseded"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** Architecture surface a decision link points at. Mirrors ConsoleLink. */
export const DECISION_LINK_SURFACES = ["system", "wireframe", "sequence", "draw", "schema"] as const;
export type DecisionLinkSurface = (typeof DECISION_LINK_SURFACES)[number];

export interface DecisionLink {
  /** Owning surface of the governed record. */
  surface: DecisionLinkSurface;
  /** Owning record id (e.g. System project id). */
  recordId: string;
  /** Display label captured at link time. */
  label: string;
}

export interface DecisionAlternative {
  title: string;
  note?: string;
}

export interface DecisionHistoryEntry {
  at: number;
  what: string;
}

export interface Decision {
  id: string;
  /** Human number, e.g. "ADR-042". Assigned at creation, never reused. */
  number: string;
  title: string;
  status: DecisionStatus;
  context: string;
  decision: string;
  alternatives: DecisionAlternative[];
  consequences: string;
  links: DecisionLink[];
  /** Id of the decision that supersedes this one (set on supersede). */
  supersededBy?: string;
  history: DecisionHistoryEntry[];
  createdAt: number;
  updatedAt: number;
}

export const decisionLinkSchema = z.object({
  surface: z.enum(DECISION_LINK_SURFACES),
  recordId: z.string().min(1).max(160),
  label: z.string().min(1).max(200),
});

const alternativeSchema = z.object({
  title: z.string().min(1).max(200),
  note: z.string().max(2000).optional(),
});

export const decisionSchema = z.object({
  id: z.string().min(1).max(80),
  number: z.string().regex(/^ADR-\d{3,}$/),
  title: z.string().min(1).max(160),
  status: z.enum(DECISION_STATUSES),
  context: z.string().max(8000),
  decision: z.string().max(20000),
  alternatives: z.array(alternativeSchema).max(12),
  consequences: z.string().max(8000),
  links: z.array(decisionLinkSchema).max(40),
  supersededBy: z.string().min(1).max(80).optional(),
  history: z.array(z.object({ at: z.number(), what: z.string().min(1).max(300) })),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const TRANSITIONS: Record<DecisionStatus, DecisionStatus[]> = {
  proposed: ["in-review"],
  "in-review": ["proposed", "accepted"],
  accepted: ["deprecated", "superseded"],
  deprecated: ["proposed"],
  superseded: [],
};

export function canTransition(from: DecisionStatus, to: DecisionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function newDecision(title: string, number: string, now = Date.now()): Decision {
  const t = now;
  return {
    id: `adr_${t.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    number,
    title: title.trim().slice(0, 160),
    status: "proposed",
    context: "",
    decision: "",
    alternatives: [],
    consequences: "",
    links: [],
    history: [{ at: t, what: "Proposed." }],
    createdAt: t,
    updatedAt: t,
  };
}

/** Move status; illegal jumps keep the decision untouched. */
export function transitionDecision(d: Decision, to: DecisionStatus, now = Date.now()): Decision {
  if (!canTransition(d.status, to)) return d;
  return {
    ...d,
    status: to,
    updatedAt: now,
    history: [...d.history, { at: now, what: `Moved to ${to}.` }],
  };
}

/** Attach a record link; duplicates (same surface + record) are ignored. */
export function linkDecision(d: Decision, link: DecisionLink, now = Date.now()): Decision {
  if (d.links.some((l) => l.surface === link.surface && l.recordId === link.recordId)) return d;
  return {
    ...d,
    links: [...d.links, link],
    updatedAt: now,
    history: [...d.history, { at: now, what: `Linked ${link.surface}: ${link.label}.` }],
  };
}

export function unlinkDecision(d: Decision, surface: DecisionLinkSurface, recordId: string, now = Date.now()): Decision {
  if (!d.links.some((l) => l.surface === surface && l.recordId === recordId)) return d;
  return {
    ...d,
    links: d.links.filter((l) => !(l.surface === surface && l.recordId === recordId)),
    updatedAt: now,
    history: [...d.history, { at: now, what: "Removed a link." }],
  };
}

/** Next ADR number after the given decisions (ADR-001 when empty). */
export function nextDecisionNumber(decisions: Pick<Decision, "number">[]): string {
  let max = 0;
  for (const d of decisions) {
    const m = /^ADR-(\d+)$/.exec(d.number);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `ADR-${String(max + 1).padStart(3, "0")}`;
}
