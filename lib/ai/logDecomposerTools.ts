import { z } from "zod";
import { getDebugBridge } from "@/lib/log-decomposer/debugBridge";
import { maskRawLines } from "@/lib/log-decomposer/mask";
import { composeHandoffBrief, draftRcaFromSession } from "@/lib/log-decomposer/rca";
import type { AgentTool } from "./tools";

/**
 * Log Decomposer investigator pack: reads run free, the RCA draft pauses
 * for human Apply. Tools only ever see the deterministic model (nodes,
 * findings, evidence refs) - raw bodies stay in the browser; the model
 * requests line ranges explicitly and the ranges come back quoted with
 * secrets masked (mask.ts - browser evidence is never altered).
 */

const noArgs = z.object({});
const executionArgs = z.object({
  executionId: z.string().optional().describe("Execution id - defaults to the latest in the open session"),
});
const nodeArgs = z.object({
  nodeId: z.string().min(1).describe("Execution node id, e.g. n12"),
});
const rawRangeArgs = z.object({
  executionId: z.string().optional().describe("Execution id - defaults to the latest"),
  lineStart: z.number().int().nonnegative().describe("Zero-based first raw line"),
  lineEnd: z.number().int().nonnegative().describe("Zero-based last raw line, max 60 lines per call"),
});

function needSession() {
  const bridge = getDebugBridge();
  const session = bridge?.getSession() ?? null;
  if (!bridge || !session) return { bridge: null, session: null };
  return { bridge, session };
}

const debugDescribe: AgentTool = {
  name: "debug_describe",
  description: "Summarize the open debug session: problem, status, logs with operations and sizes, executions with event/node/exception counts.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "Read debug session",
  schema: noArgs,
  execute: async () => {
    const { session } = needSession();
    if (!session) return { ok: false, error: "No debug session is open - ask the user to open the Debug tab and pick a session first." };
    return {
      ok: true,
      result: {
        title: session.title,
        problem: session.problem,
        status: session.status,
        investigation: session.investigation ?? { hypotheses: [], questions: [] },
        logs: session.logs.map((l) => ({ id: l.salesforceLogId, operation: l.operation, status: l.status, durationMs: l.durationMs, sizeBytes: l.sizeBytes })),
        executions: session.executions.map((e) => ({
          executionId: e.executionId,
          logId: e.logId,
          durationMs: e.metadata.durationMs,
          nodes: e.nodes.length,
          events: e.events.length,
          unknownEvents: e.unknownEventCount,
          findings: e.findings.length,
        })),
      },
    };
  },
};

const debugFindings: AgentTool = {
  name: "debug_findings",
  description: "List deterministic findings (exceptions, governor limits, performance, callouts, anomalies) with severity, summary and evidence refs.",
  parameters: { type: "object", properties: { executionId: { type: "string" } }, additionalProperties: false },
  needsApproval: false,
  label: () => "Read findings",
  schema: executionArgs,
  execute: async (args) => {
    const { executionId } = executionArgs.parse(args);
    const { bridge, session } = needSession();
    if (!bridge || !session) return { ok: false, error: "No debug session is open." };
    const exec = executionId ? bridge.getExecution(executionId) : session.executions[session.executions.length - 1] ?? null;
    if (!exec) return { ok: false, error: "No executions yet - pull a log from Capture first." };
    return { ok: true, result: exec.findings };
  },
};

const debugNode: AgentTool = {
  name: "debug_node",
  description: "Inspect one execution node: label, type, status, duration, source class/method, children and its event ids.",
  parameters: { type: "object", properties: { nodeId: { type: "string" } }, required: ["nodeId"], additionalProperties: false },
  needsApproval: false,
  label: (args) => `Inspect node ${(args as { nodeId?: string }).nodeId ?? ""}`,
  schema: nodeArgs,
  execute: async (args) => {
    const { nodeId } = nodeArgs.parse(args);
    const { session } = needSession();
    if (!session) return { ok: false, error: "No debug session is open." };
    for (const exec of session.executions) {
      const node = exec.nodes.find((n) => n.id === nodeId);
      if (node) return { ok: true, result: { executionId: exec.executionId, node } };
    }
    return { ok: false, error: `Node ${nodeId} is not in any execution of this session.` };
  },
};

const debugExceptions: AgentTool = {
  name: "debug_exceptions",
  description: "Full exception context: every EXCEPTION node with its message, parent chain and surrounding raw line numbers.",
  parameters: { type: "object", properties: { executionId: { type: "string" } }, additionalProperties: false },
  needsApproval: false,
  label: () => "Read exception context",
  schema: executionArgs,
  execute: async (args) => {
    const { executionId } = executionArgs.parse(args);
    const { bridge, session } = needSession();
    if (!bridge || !session) return { ok: false, error: "No debug session is open." };
    const exec = executionId ? bridge.getExecution(executionId) : session.executions[session.executions.length - 1] ?? null;
    if (!exec) return { ok: false, error: "No executions yet - pull a log from Capture first." };
    const byId = new Map(exec.nodes.map((n) => [n.id, n]));
    const out = exec.nodes
      .filter((n) => n.type === "EXCEPTION")
      .map((n) => {
        const chain: string[] = [];
        let cur = n.parentId ? byId.get(n.parentId) : undefined;
        let guard = 0;
        while (cur && guard++ < 8) {
          chain.unshift(cur.label);
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        return { nodeId: n.id, message: n.label, chain, lines: n.eventIds.map((id) => exec.events.find((e) => e.id === id)?.line).filter((l): l is number => l !== undefined) };
      });
    return { ok: true, result: out };
  },
};

const debugRawRange: AgentTool = {
  name: "debug_raw_range",
  description: "Quote raw log lines around evidence (max 60 lines, secrets masked). Use after findings point at an event, never to dump whole logs.",
  parameters: {
    type: "object",
    properties: { executionId: { type: "string" }, lineStart: { type: "number" }, lineEnd: { type: "number" } },
    required: ["lineStart", "lineEnd"],
    additionalProperties: false,
  },
  needsApproval: false,
  label: (args) => {
    const a = args as { lineStart?: number; lineEnd?: number };
    return `Quote raw L${(a.lineStart ?? 0) + 1}-${(a.lineEnd ?? 0) + 1}`;
  },
  schema: rawRangeArgs,
  execute: async (args) => {
    const { executionId, lineStart, lineEnd } = rawRangeArgs.parse(args);
    if (lineEnd < lineStart) return { ok: false, error: "lineEnd must be >= lineStart." };
    if (lineEnd - lineStart > 59) return { ok: false, error: "Max 60 lines per call - narrow the range." };
    const { bridge, session } = needSession();
    if (!bridge || !session) return { ok: false, error: "No debug session is open." };
    const exec = executionId ? bridge.getExecution(executionId) : session.executions[session.executions.length - 1] ?? null;
    if (!exec) return { ok: false, error: "No executions yet - pull a log from Capture first." };
    const log = session.logs.find((l) => l.salesforceLogId === exec.logId);
    if (!log?.body) return { ok: false, error: "Raw body is not in this session." };
    const all = log.body.split(/\r?\n/);
    const slice = all.slice(lineStart, lineEnd + 1);
    // Secrets never reach the model - evidence reads masked, browser stays verbatim.
    const lines = maskRawLines(slice.map((raw, i) => ({ line: lineStart + i, raw })));
    return { ok: true, result: { executionId: exec.executionId, lineStart, lineEnd, lines } };
  },
};

const debugRcaDraft: AgentTool = {
  name: "debug_rca_draft",
  description: "Draft a root-cause analysis from the session's deterministic findings (headlines first, evidence attached). Pauses for Apply - never lands silently.",
  approvalHint: "Drafts the RCA record on the open debug session",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: true,
  label: () => "Draft RCA from findings",
  schema: noArgs,
  execute: async () => {
    const { bridge, session } = needSession();
    if (!bridge || !session) return { ok: false, error: "No debug session is open." };
    const rca = draftRcaFromSession(session);
    const applied = await bridge.apply((s) => ({ ...s, rca, status: s.status === "parsed" ? "diagnosed" : s.status }), "Draft RCA");
    if (!applied.ok) return { ok: false, error: applied.error ?? "Apply failed." };
    return { ok: true, result: { summary: rca.summary, confidence: rca.confidence, evidence: rca.evidence.length, recommendations: rca.recommendations.length } };
  },
};

const debugBrief: AgentTool = {
  name: "debug_brief",
  description: "Compose the markdown handoff brief (problem, root cause, evidence by reference, fix) for Jira or a coding agent.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "Compose handoff brief",
  schema: noArgs,
  execute: async () => {
    const { session } = needSession();
    if (!session) return { ok: false, error: "No debug session is open." };
    if (!session.rca) return { ok: false, error: "No RCA yet - draft one first (debug_rca_draft) or write it in the RCA tab." };
    return { ok: true, result: composeHandoffBrief(session, session.rca) };
  },
};

export const DEBUG_TOOLS: AgentTool[] = [
  debugDescribe,
  debugFindings,
  debugNode,
  debugExceptions,
  debugRawRange,
  debugRcaDraft,
  debugBrief,
];
