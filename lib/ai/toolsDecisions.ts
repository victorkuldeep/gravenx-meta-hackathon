import { z } from "zod";
import type { AgentTool } from "./tools";
import {
  DECISION_LINK_SURFACES,
  DECISION_STATUSES,
  linkDecision,
  newDecision,
  nextDecisionNumber,
  transitionDecision,
  type Decision,
} from "@/lib/decisions/model";
import { listDecisions, saveDecision } from "@/lib/decisions/store";

/**
 * Decisions tool pack - Architecture Decision Records behind tools.
 *
 * Reads run free; propose/link/move pause for human Apply. Links address
 * canvas records by id or name fragment and never duplicate them; illegal
 * lifecycle jumps refuse instead of forcing.
 */

export interface DecisionsBackend {
  list: () => Promise<Decision[]>;
  save: (d: Decision) => Promise<unknown>;
}

let backend: DecisionsBackend = { list: listDecisions, save: saveDecision };

/** Tests inject an in-memory backend; the app uses IndexedDB. */
export function setDecisionsBackend(b: DecisionsBackend | null): void {
  backend = b ?? { list: listDecisions, save: saveDecision };
}

function summarize(d: Decision) {
  return {
    id: d.id,
    number: d.number,
    title: d.title,
    status: d.status,
    links: d.links.map((l) => `[${l.surface}] ${l.label}`),
    updatedAt: d.updatedAt,
  };
}

async function findDecision(ref: string): Promise<{ decision: Decision } | { candidates: string[] } | null> {
  const all = await backend.list();
  const exact = all.find((d) => d.id === ref || d.number.toLowerCase() === ref.trim().toLowerCase());
  if (exact) return { decision: exact };
  const q = ref.trim().toLowerCase();
  const hits = all.filter((d) => d.title.toLowerCase().includes(q));
  if (hits.length === 1) return { decision: hits[0] };
  if (hits.length > 1) return { candidates: hits.slice(0, 8).map((d) => `${d.number} ${d.title}`) };
  return null;
}

const describeDecisions: AgentTool = {
  name: "decision_describe",
  description: "List Architecture Decision Records: number, title, status, governed links.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "Describe decisions",
  schema: z.object({}),
  execute: async () => {
    const all = await backend.list();
    return { ok: true, result: { decisionCount: all.length, decisions: all.slice(0, 60).map(summarize) } };
  },
};

const proposeArgs = z.object({
  title: z.string().min(1).max(160).describe("Decision title, e.g. Middleware owns orchestration"),
  context: z.string().max(4000).optional().describe("What forced this decision"),
  decision: z.string().max(4000).optional().describe("What was decided, concretely"),
});

const proposeDecision: AgentTool = {
  name: "decision_propose",
  description: "Propose a new Architecture Decision Record (starts at proposed). Only new records - never edit or delete.",
  parameters: {
    type: "object",
    properties: { title: { type: "string" }, context: { type: "string" }, decision: { type: "string" } },
    required: ["title"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => `Propose decision "${((a as { title?: string }).title ?? "").slice(0, 60)}"`,
  schema: proposeArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof proposeArgs>;
    const all = await backend.list();
    const d: Decision = {
      ...newDecision(args.title, nextDecisionNumber(all)),
      ...(args.context ? { context: args.context.slice(0, 8000) } : {}),
      ...(args.decision ? { decision: args.decision.slice(0, 8000) } : {}),
    };
    await backend.save(d);
    return { ok: true, result: `Proposed ${d.number} "${d.title}". Open: /decisions?id=${d.id}` };
  },
};

const linkArgs = z.object({
  decision: z.string().min(1).describe("Decision id, number (ADR-042), or title fragment"),
  surface: z.enum(DECISION_LINK_SURFACES).describe("Owning surface of the governed record"),
  recordId: z.string().min(1).max(160).describe("Owning record id"),
  label: z.string().min(1).max(200).describe("Display label for the link"),
});

const linkDecisionTool: AgentTool = {
  name: "decision_link",
  description: "Link a canvas record (system project, experience, sequence, draw board, schema) to a decision. Address-only - never copies the record.",
  parameters: {
    type: "object",
    properties: {
      decision: { type: "string" },
      surface: { type: "string" },
      recordId: { type: "string" },
      label: { type: "string" },
    },
    required: ["decision", "surface", "recordId", "label"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => {
    const v = a as { surface?: string; label?: string };
    return `Link [${v.surface ?? ""}] ${(v.label ?? "").slice(0, 40)}`;
  },
  schema: linkArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof linkArgs>;
    const found = await findDecision(args.decision);
    if (!found) return { ok: false, error: `No decision matches "${args.decision}". See decision_describe.` };
    if ("candidates" in found) return { ok: false, error: `Ambiguous - did you mean: ${found.candidates.join(" | ")}?` };
    const next = linkDecision(found.decision, { surface: args.surface, recordId: args.recordId, label: args.label });
    if (next === found.decision) return { ok: false, error: "Already linked." };
    await backend.save(next);
    return { ok: true, result: `Linked [${args.surface}] ${args.label} to ${next.number}.` };
  },
};

const moveArgs = z.object({
  decision: z.string().min(1).describe("Decision id, number (ADR-042), or title fragment"),
  to: z.enum(DECISION_STATUSES).describe("Target lifecycle state"),
});

const moveDecision: AgentTool = {
  name: "decision_move",
  description: "Move a decision through proposed → in-review → accepted (deprecated / superseded terminal). Illegal jumps refuse.",
  parameters: {
    type: "object",
    properties: { decision: { type: "string" }, to: { type: "string" } },
    required: ["decision", "to"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => {
    const v = a as { decision?: string; to?: string };
    return `Move "${(v.decision ?? "").slice(0, 40)}" to ${v.to ?? ""}`;
  },
  schema: moveArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof moveArgs>;
    const found = await findDecision(args.decision);
    if (!found) return { ok: false, error: `No decision matches "${args.decision}". See decision_describe.` };
    if ("candidates" in found) return { ok: false, error: `Ambiguous - did you mean: ${found.candidates.join(" | ")}?` };
    const next = transitionDecision(found.decision, args.to);
    if (next === found.decision) return { ok: false, error: `Cannot move ${found.decision.status} → ${args.to}.` };
    await backend.save(next);
    return { ok: true, result: `Moved ${next.number} to ${args.to}.` };
  },
};

export const DECISION_TOOLS: AgentTool[] = [describeDecisions, proposeDecision, linkDecisionTool, moveDecision];
