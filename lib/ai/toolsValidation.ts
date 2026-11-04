import { z } from "zod";
import type { AgentTool } from "./tools";
import { getSystemBridge } from "./systemBridge";
import { analyzeProject, sequencesForProject } from "@/lib/risks/rules";
import { findingKey, proveFindings } from "@/lib/risks/proof";
import { proposeScenario } from "@/lib/risks/scenarios";
import { listSystemRuns, type SystemRunRecord } from "@/lib/system-design/runStore";
import { newId } from "@/lib/system-design/model";
import { listSequences } from "@/lib/sequence/store";
import type { SequenceDocument } from "@/lib/sequence/model";

/**
 * Validation tool pack - execution evidence behind tools.
 * validation_status and verdict_explain read freely; only
 * scenario_propose_for_risk writes, through human Apply. The AI
 * proposes the test; the deterministic verdict judges the run.
 */

export interface ValidationBackend {
  sequences: () => Promise<SequenceDocument[]>;
  runs: () => Promise<SystemRunRecord[]>;
}

let backend: ValidationBackend = { sequences: listSequences, runs: () => listSystemRuns(100) };

/** Tests inject an in-memory backend; the app uses IndexedDB. */
export function setValidationBackend(b: ValidationBackend | null): void {
  backend = b ?? { sequences: listSequences, runs: () => listSystemRuns(100) };
}

const noArgs = z.object({});

const validationStatus: AgentTool = {
  name: "validation_status",
  description:
    "Show every deterministic risk finding with its proof state (unproven, covered, proven-live, proven-mock, reproduced), the validating scenarios, and the proving or confirming runs. Proof is derived from run evidence, never declared.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "Read validation status",
  schema: noArgs,
  execute: async () => {
    const project = getSystemBridge()?.getProject() ?? null;
    if (!project) return { ok: false, error: "No System canvas is open - ask the user to open the System tab first." };
    const seqs = await backend.sequences().catch(() => []);
    const runs = await backend.runs().catch(() => []);
    const findings = analyzeProject(project, sequencesForProject(project, seqs));
    const proofs = proveFindings(findings, project.scenarios, runs, project.settings.retentionDays);
    return {
      ok: true,
      result: {
        project: project.name,
        findingCount: findings.length,
        rows: findings.map((f, i) => {
          const p = proofs[i];
          const scenarios = (p?.scenarioIds ?? []).map(
            (id) => project.scenarios.find((s) => s.id === id)?.name ?? "deleted scenario",
          );
          return {
            key: findingKey(f),
            rule: f.rule,
            severity: f.severity,
            message: f.message,
            state: p?.state ?? "unproven",
            scenarios,
            provingRuns: p?.provingRunIds ?? [],
            confirmingRuns: p?.failedRunIds ?? [],
          };
        }),
      },
    };
  },
};

const proposeArgs = z.object({
  rule: z.string().min(1).max(80).describe("Risk rule id, e.g. no-retry, fan-in-hub, no-timeout"),
  refId: z.string().min(1).max(200).describe("Cited record id from validation_status, e.g. an operation id"),
});

const proposeScenarioForRisk: AgentTool = {
  name: "scenario_propose_for_risk",
  description:
    "Draft the failure scenario that tests one risk finding (mock injects the feared condition, expectation declares the intent) and add it to the Scenarios panel. The architect runs it from the canvas; the deterministic verdict judges the evidence.",
  parameters: {
    type: "object",
    properties: { rule: { type: "string" }, refId: { type: "string" } },
    required: ["rule", "refId"],
    additionalProperties: false,
  },
  needsApproval: true,
  undoable: true,
  label: (a) => {
    const v = a as { rule?: string };
    return `Propose validation scenario for ${v.rule ?? "risk"}`;
  },
  schema: proposeArgs,
  execute: async (raw) => {
    const bridge = getSystemBridge();
    const project = bridge?.getProject() ?? null;
    if (!bridge || !project) return { ok: false, error: "No System canvas is open - ask the user to open the System tab first." };
    const args = raw as z.infer<typeof proposeArgs>;
    const seqs = await backend.sequences().catch(() => []);
    const seqDocs = sequencesForProject(project, seqs);
    const target = analyzeProject(project, seqDocs).find(
      (f) => f.rule === args.rule && f.refs.some((r) => r.id === args.refId),
    );
    if (!target) return { ok: false, error: `No live ${args.rule} finding cites ${args.refId} - run validation_status for citable findings.` };
    const draft = proposeScenario(project, target, seqs);
    if (!draft) return { ok: false, error: `Nothing on the canvas answers that finding - no targetable operation or flow.` };
    let name = "";
    const r = bridge.apply(
      (p) => {
        name = draft.name;
        return {
          ...p,
          scenarios: [
            ...p.scenarios,
            {
              id: newId("scn"),
              name: draft.name,
              flowId: draft.flowId && p.flows.some((f) => f.id === draft.flowId) ? draft.flowId : null,
              environmentId: null,
              inputPayload: draft.inputPayload,
              mockOverrides: draft.mockOverrides,
              expectStatus: draft.expectStatus,
              validates: draft.validates,
            },
          ],
        };
      },
      `AI: propose validation scenario for ${args.rule}`,
    );
    if (!r.ok) return { ok: false, error: r.error ?? "Apply failed." };
    return { ok: true, result: `Added scenario "${name}". ${draft.rationale} Run it from the Scenarios panel.` };
  },
};

const explainArgs = z.object({
  scenarioId: z.string().min(1).max(200).describe("Scenario id from validation_status"),
});

const verdictExplain: AgentTool = {
  name: "verdict_explain",
  description:
    "Explain the latest run verdict for one scenario: expectation vs terminal status, per-hop evidence, and what the verdict means for the validated findings. Read-only - history is never re-judged.",
  parameters: {
    type: "object",
    properties: { scenarioId: { type: "string" } },
    required: ["scenarioId"],
    additionalProperties: false,
  },
  needsApproval: false,
  label: () => "Explain scenario verdict",
  schema: explainArgs,
  execute: async (raw) => {
    const project = getSystemBridge()?.getProject() ?? null;
    if (!project) return { ok: false, error: "No System canvas is open - ask the user to open the System tab first." };
    const args = raw as z.infer<typeof explainArgs>;
    const scenario = project.scenarios.find((s) => s.id === args.scenarioId);
    if (!scenario) return { ok: false, error: `No scenario ${args.scenarioId} on the open project.` };
    const runs = (await backend.runs().catch(() => [])).filter((r) => r.scenarioId === scenario.id);
    if (runs.length === 0) return { ok: true, result: `Scenario "${scenario.name}" has no runs yet - run it from the Scenarios panel first.` };
    const latest = [...runs].sort((a, b) => b.createdAt - a.createdAt)[0];
    const intent = (scenario.validates ?? []).map((v) => `${v.rule} (${v.mode === "reproduce" ? "reproduce" : "withstand"})`).join(", ");
    return {
      ok: true,
      result: {
        scenario: scenario.name,
        expectation: scenario.expectStatus,
        terminalStatus: latest.status,
        verdict: latest.verdict ?? "none - scenario states no expectation",
        verdictNote: latest.verdictNote ?? null,
        intent: intent || "no linked findings",
        runCount: runs.length,
        hops: (latest.steps ?? []).map((s) => ({ label: s.label, status: s.status, durationMs: s.durationMs })),
      },
    };
  },
};

export const VALIDATION_TOOLS: AgentTool[] = [validationStatus, proposeScenarioForRisk, verdictExplain];
