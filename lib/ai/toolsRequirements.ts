import { z } from "zod";
import type { AgentTool } from "./tools";
import {
  REQUIREMENT_LINK_SURFACES,
  REQUIREMENT_STATUSES,
  linkRequirement,
  newRequirement,
  nextRequirementNumber,
  transitionRequirement,
  type Requirement,
} from "@/lib/requirements/model";
import { listRequirements, saveRequirement } from "@/lib/requirements/store";

/**
 * Requirements tool pack - REQ records behind tools.
 *
 * Reads run free; log/link/move pause for human Apply. Links address
 * canvas records by id or name fragment and never duplicate them; illegal
 * lifecycle jumps refuse instead of forcing. Coverage stays derived -
 * tools never mark anything covered.
 */

export interface RequirementsBackend {
  list: () => Promise<Requirement[]>;
  save: (r: Requirement) => Promise<unknown>;
}

let backend: RequirementsBackend = { list: listRequirements, save: saveRequirement };

/** Tests inject an in-memory backend; the app uses IndexedDB. */
export function setRequirementsBackend(b: RequirementsBackend | null): void {
  backend = b ?? { list: listRequirements, save: saveRequirement };
}

function summarize(r: Requirement) {
  return {
    id: r.id,
    number: r.number,
    title: r.title,
    status: r.status,
    links: r.links.map((l) => `[${l.surface}] ${l.label}`),
    updatedAt: r.updatedAt,
  };
}

async function findRequirement(ref: string): Promise<{ requirement: Requirement } | { candidates: string[] } | null> {
  const all = await backend.list();
  const exact = all.find((r) => r.id === ref || r.number.toLowerCase() === ref.trim().toLowerCase());
  if (exact) return { requirement: exact };
  const q = ref.trim().toLowerCase();
  const hits = all.filter((r) => r.title.toLowerCase().includes(q));
  if (hits.length === 1) return { requirement: hits[0] };
  if (hits.length > 1) return { candidates: hits.slice(0, 8).map((r) => `${r.number} ${r.title}`) };
  return null;
}

const describeRequirements: AgentTool = {
  name: "req_describe",
  description: "List requirements: number, title, status, satisfying links.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "Describe requirements",
  schema: z.object({}),
  execute: async () => {
    const all = await backend.list();
    return { ok: true, result: { requirementCount: all.length, requirements: all.slice(0, 60).map(summarize) } };
  },
};

const logArgs = z.object({
  title: z.string().min(1).max(160).describe("Requirement title, e.g. Customer receives order confirmation"),
  body: z.string().max(4000).optional().describe("Intent, acceptance criteria, constraints"),
});

const logRequirement: AgentTool = {
  name: "req_log",
  description: "Log a new requirement (starts open). Only new records - never edit or delete.",
  parameters: {
    type: "object",
    properties: { title: { type: "string" }, body: { type: "string" } },
    required: ["title"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => `Log requirement "${((a as { title?: string }).title ?? "").slice(0, 60)}"`,
  schema: logArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof logArgs>;
    const all = await backend.list();
    const r: Requirement = {
      ...newRequirement(args.title, nextRequirementNumber(all)),
      ...(args.body ? { body: args.body.slice(0, 8000) } : {}),
    };
    await backend.save(r);
    return { ok: true, result: `Logged ${r.number} "${r.title}". Open: /requirements?id=${r.id}` };
  },
};

const linkArgs = z.object({
  requirement: z.string().min(1).describe("Requirement id, number (REQ-102), or title fragment"),
  surface: z.enum(REQUIREMENT_LINK_SURFACES).describe("Owning surface of the satisfying record"),
  recordId: z.string().min(1).max(160).describe("Owning record id"),
  label: z.string().min(1).max(200).describe("Display label for the link"),
});

const linkRequirementTool: AgentTool = {
  name: "req_link",
  description: "Link a satisfying record (system, experience, sequence, draw board, schema, decision) to a requirement. Address-only - never copies the record.",
  parameters: {
    type: "object",
    properties: {
      requirement: { type: "string" },
      surface: { type: "string" },
      recordId: { type: "string" },
      label: { type: "string" },
    },
    required: ["requirement", "surface", "recordId", "label"],
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
    const found = await findRequirement(args.requirement);
    if (!found) return { ok: false, error: `No requirement matches "${args.requirement}". See req_describe.` };
    if ("candidates" in found) return { ok: false, error: `Ambiguous - did you mean: ${found.candidates.join(" | ")}?` };
    const next = linkRequirement(found.requirement, { surface: args.surface, recordId: args.recordId, label: args.label });
    if (next === found.requirement) return { ok: false, error: "Already linked." };
    await backend.save(next);
    return { ok: true, result: `Linked [${args.surface}] ${args.label} to ${next.number}.` };
  },
};

const moveArgs = z.object({
  requirement: z.string().min(1).describe("Requirement id, number (REQ-102), or title fragment"),
  to: z.enum(REQUIREMENT_STATUSES).describe("Target lifecycle state"),
});

const moveRequirement: AgentTool = {
  name: "req_move",
  description: "Move a requirement through open → covered → verified (reopen returns to open). Illegal jumps refuse. Status is declared; coverage stays derived.",
  parameters: {
    type: "object",
    properties: { requirement: { type: "string" }, to: { type: "string" } },
    required: ["requirement", "to"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => {
    const v = a as { requirement?: string; to?: string };
    return `Move "${(v.requirement ?? "").slice(0, 40)}" to ${v.to ?? ""}`;
  },
  schema: moveArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof moveArgs>;
    const found = await findRequirement(args.requirement);
    if (!found) return { ok: false, error: `No requirement matches "${args.requirement}". See req_describe.` };
    if ("candidates" in found) return { ok: false, error: `Ambiguous - did you mean: ${found.candidates.join(" | ")}?` };
    const next = transitionRequirement(found.requirement, args.to);
    if (next === found.requirement) return { ok: false, error: `Cannot move ${found.requirement.status} → ${args.to}.` };
    await backend.save(next);
    return { ok: true, result: `Moved ${next.number} to ${args.to}.` };
  },
};

export const REQUIREMENT_TOOLS: AgentTool[] = [describeRequirements, logRequirement, linkRequirementTool, moveRequirement];
