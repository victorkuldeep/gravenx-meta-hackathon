import { z } from "zod";
import type { AgentTool } from "./tools";
import { getSystemBridge } from "./systemBridge";
import { analyzeProject, sequencesForProject } from "@/lib/risks/rules";
import { linkDecision, newDecision, nextDecisionNumber, type Decision } from "@/lib/decisions/model";
import { listDecisions, saveDecision } from "@/lib/decisions/store";
import { listSequences } from "@/lib/sequence/store";
import type { SequenceDocument } from "@/lib/sequence/model";

/**
 * Risk lens tool pack - deterministic findings behind tools.
 * risk_describe reads the open canvas freely; risk_propose_adr turns a
 * finding into a linked ADR proposal through human Apply. The AI explains;
 * the rules decide.
 */

export interface RisksBackend {
  sequences: () => Promise<SequenceDocument[]>;
  decisions: () => Promise<Decision[]>;
  saveDecision: (d: Decision) => Promise<unknown>;
}

let backend: RisksBackend = { sequences: listSequences, decisions: listDecisions, saveDecision };

/** Tests inject an in-memory backend; the app uses IndexedDB. */
export function setRisksBackend(b: RisksBackend | null): void {
  backend = b ?? { sequences: listSequences, decisions: listDecisions, saveDecision };
}

const noArgs = z.object({});

const describeRisks: AgentTool = {
  name: "risk_describe",
  description: "List deterministic architecture risks for the open System canvas: sync chains, missing timeouts/retries, fan-in hubs, unversioned ops, naked sync calls. Every finding cites records.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "Read risk lens",
  schema: noArgs,
  execute: async () => {
    const project = getSystemBridge()?.getProject() ?? null;
    if (!project) return { ok: false, error: "No System canvas is open - ask the user to open the System tab first." };
    const seqs = await backend.sequences().catch(() => []);
    const findings = analyzeProject(project, sequencesForProject(project, seqs));
    return {
      ok: true,
      result: {
        project: project.name,
        findingCount: findings.length,
        findings: findings.map((f) => ({ rule: f.rule, severity: f.severity, message: f.message })),
      },
    };
  },
};

const proposeArgs = z.object({
  title: z.string().min(1).max(160).describe("Decision title, e.g. Bound the hub fan-in with timeouts"),
  context: z.string().max(4000).optional().describe("The risk finding being answered, quoted or paraphrased"),
});

const proposeRiskAdr: AgentTool = {
  name: "risk_propose_adr",
  description: "Turn a risk finding into a proposed ADR, pre-linked to the open System project. Only new proposals - never edits.",
  parameters: {
    type: "object",
    properties: { title: { type: "string" }, context: { type: "string" } },
    required: ["title"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => `Propose ADR "${((a as { title?: string }).title ?? "").slice(0, 60)}"`,
  schema: proposeArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof proposeArgs>;
    const project = getSystemBridge()?.getProject() ?? null;
    if (!project) return { ok: false, error: "No System canvas is open - ask the user to open the System tab first." };
    const existing = await backend.decisions().catch(() => []);
    let d = newDecision(args.title, nextDecisionNumber(existing));
    d = {
      ...d,
      ...(args.context ? { context: args.context.slice(0, 8000) } : {}),
      history: [...d.history, { at: Date.now(), what: "Raised from the risk lens." }],
    };
    d = linkDecision(d, { surface: "system", recordId: project.id, label: project.name });
    await backend.saveDecision(d);
    return { ok: true, result: `Proposed ${d.number} "${d.title}", linked to ${project.name}. Open: /decisions?id=${d.id}` };
  },
};

export const RISK_TOOLS: AgentTool[] = [describeRisks, proposeRiskAdr];
