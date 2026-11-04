import { z } from "zod";

/**
 * Requirements domain model - REQ records with architecture traceability.
 *
 * A Requirement states intent (title + body) and points at the artifacts
 * that satisfy it: systems, experiences, sequences, boards, schema, and
 * decisions. Links address records, never copy them. Coverage (covered vs
 * has-no-design) is DERIVED from the graph index, never hand-marked -
 * the status lifecycle stays human, the coverage math stays honest.
 */

export const REQUIREMENT_STATUSES = ["open", "covered", "verified"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const REQUIREMENT_LINK_SURFACES = ["system", "wireframe", "sequence", "draw", "schema", "decision"] as const;
export type RequirementLinkSurface = (typeof REQUIREMENT_LINK_SURFACES)[number];

export interface RequirementLink {
  surface: RequirementLinkSurface;
  recordId: string;
  label: string;
}

export interface RequirementHistoryEntry {
  at: number;
  what: string;
}

export interface Requirement {
  id: string;
  /** Human number, e.g. "REQ-102". Assigned at creation, never reused. */
  number: string;
  title: string;
  status: RequirementStatus;
  body: string;
  links: RequirementLink[];
  history: RequirementHistoryEntry[];
  createdAt: number;
  updatedAt: number;
}

export const requirementLinkSchema = z.object({
  surface: z.enum(REQUIREMENT_LINK_SURFACES),
  recordId: z.string().min(1).max(160),
  label: z.string().min(1).max(200),
});

export const requirementSchema = z.object({
  id: z.string().min(1).max(80),
  number: z.string().regex(/^REQ-\d{3,}$/),
  title: z.string().min(1).max(160),
  status: z.enum(REQUIREMENT_STATUSES),
  body: z.string().max(8000),
  links: z.array(requirementLinkSchema).max(40),
  history: z.array(z.object({ at: z.number(), what: z.string().min(1).max(300) })),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const TRANSITIONS: Record<RequirementStatus, RequirementStatus[]> = {
  open: ["covered"],
  covered: ["verified", "open"],
  verified: ["open"],
};

export function canTransition(from: RequirementStatus, to: RequirementStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function newRequirement(title: string, number: string, now = Date.now()): Requirement {
  return {
    id: `req_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    number,
    title: title.trim().slice(0, 160),
    status: "open",
    body: "",
    links: [],
    history: [{ at: now, what: "Logged." }],
    createdAt: now,
    updatedAt: now,
  };
}

/** Move status; illegal jumps keep the requirement untouched. */
export function transitionRequirement(r: Requirement, to: RequirementStatus, now = Date.now()): Requirement {
  if (!canTransition(r.status, to)) return r;
  return {
    ...r,
    status: to,
    updatedAt: now,
    history: [...r.history, { at: now, what: `Moved to ${to}.` }],
  };
}

/** Attach a record link; duplicates (same surface + record) are ignored. */
export function linkRequirement(r: Requirement, link: RequirementLink, now = Date.now()): Requirement {
  if (r.links.some((l) => l.surface === link.surface && l.recordId === link.recordId)) return r;
  return {
    ...r,
    links: [...r.links, link],
    updatedAt: now,
    history: [...r.history, { at: now, what: `Linked ${link.surface}: ${link.label}.` }],
  };
}

export function unlinkRequirement(r: Requirement, surface: RequirementLinkSurface, recordId: string, now = Date.now()): Requirement {
  if (!r.links.some((l) => l.surface === surface && l.recordId === recordId)) return r;
  return {
    ...r,
    links: r.links.filter((l) => !(l.surface === surface && l.recordId === recordId)),
    updatedAt: now,
    history: [...r.history, { at: now, what: "Removed a link." }],
  };
}

/** Next REQ number after the given requirements (REQ-001 when empty). */
export function nextRequirementNumber(reqs: Pick<Requirement, "number">[]): string {
  let max = 0;
  for (const r of reqs) {
    const m = /^REQ-(\d+)$/.exec(r.number);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `REQ-${String(max + 1).padStart(3, "0")}`;
}
