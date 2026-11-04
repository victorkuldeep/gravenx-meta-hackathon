import { z } from "zod";

/**
 * Log Decomposer data foundation. The Debug Session is the source of
 * truth - not a chat transcript. Deterministic artifacts (execution
 * model, findings, RCA) are structured records; the raw log is preserved
 * as evidence beside them, never silently discarded.
 */

export const DEBUG_STATUSES = ["open", "capturing", "parsed", "diagnosed", "handed-off"] as const;
export type DebugStatus = (typeof DEBUG_STATUSES)[number];

/** Sort key for logs: org StartTime wins, capture time is the fallback. */
export function logTimestamp(l: { startTime?: string; capturedAt: number }): number {
  if (l.startTime) {
    const t = Date.parse(l.startTime);
    if (!Number.isNaN(t) && t > 0) return t;
  }
  return l.capturedAt;
}

/** Linear lifecycle with re-capture allowed until handoff. */
const ALLOWED_TRANSITIONS: Record<DebugStatus, DebugStatus[]> = {
  open: ["capturing"],
  capturing: ["parsed", "open"],
  parsed: ["diagnosed", "capturing"],
  diagnosed: ["handed-off", "capturing"],
  "handed-off": [],
};

export function canTransition(from: DebugStatus, to: DebugStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export const traceTargetSchema = z.object({
  kind: z.enum(["user", "class", "trigger"]),
  id: z.string().min(1),
  name: z.string().min(1),
});

export type TraceTarget = z.infer<typeof traceTargetSchema>;

export const traceConfigSchema = z.object({
  target: traceTargetSchema,
  preset: z.enum(["smart", "apex-deep", "integration", "performance", "custom"]).default("smart"),
  debugLevelId: z.string().optional(),
  flagId: z.string().optional(),
  expiresAt: z.number().optional(),
});

export type TraceConfig = z.infer<typeof traceConfigSchema>;

/** Tab list for the capture UI: new `traces` win, legacy single `trace` migrates in. */
export function sessionTraces(session: { traces?: TraceConfig[]; trace?: TraceConfig }): TraceConfig[] {
  if (session.traces && session.traces.length > 0) return session.traces;
  return session.trace ? [session.trace] : [];
}

export const capturedLogSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  salesforceLogId: z.string().min(1),
  operation: z.string().optional(),
  status: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  sizeBytes: z.number().nonnegative().optional(),
  request: z.string().optional(),
  /** Same-request chain key from the org (one user action -> N logs). */
  requestIdentifier: z.string().optional(),
  application: z.string().optional(),
  startTime: z.string().optional(),
  userId: z.string().optional(),
  capturedAt: z.number(),
  /** Raw log body, capped at MAX_RAW_BYTES; truncated flags a cut body. */
  body: z.string().optional(),
  truncated: z.boolean().default(false),
});

export type CapturedLog = z.infer<typeof capturedLogSchema>;

/** Raw bodies above this are cut at capture time and flagged. */
export const MAX_RAW_BYTES = 1_000_000;
/** Sessions keep the newest N logs - each carries up to 1MB, so this bounds IDB + memory. */
export const MAX_SESSION_LOGS = 50;

export function capRawBody(body: string): { body: string; truncated: boolean } {
  if (body.length <= MAX_RAW_BYTES) return { body, truncated: false };
  return { body: body.slice(0, MAX_RAW_BYTES), truncated: true };
}

export const executionNodeTypes = [
  "TRANSACTION",
  "CODE_UNIT",
  "METHOD",
  "TRIGGER",
  "FLOW",
  "SOQL",
  "DML",
  "CALLOUT",
  "ASYNC",
  "SYSTEM",
  "EXCEPTION",
] as const;

export type ExecutionNodeType = (typeof executionNodeTypes)[number];

export const executionNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(executionNodeTypes),
  label: z.string().min(1),
  parentId: z.string().optional(),
  startMs: z.number().optional(),
  endMs: z.number().optional(),
  durationMs: z.number().nonnegative().optional(),
  children: z.array(z.string()).default([]),
  status: z.enum(["SUCCESS", "FAILED", "WARNING", "RUNNING", "UNKNOWN"]).default("UNKNOWN"),
  source: z.object({ className: z.string().optional(), methodName: z.string().optional(), lineNumber: z.number().optional() }).optional(),
  eventIds: z.array(z.string()).default([]),
});

export type ExecutionNode = z.infer<typeof executionNodeSchema>;

export const logEventSchema = z.object({
  id: z.string().min(1),
  /** Zero-based line number in the raw body. */
  line: z.number().nonnegative(),
  /** Raw line, preserved verbatim. */
  raw: z.string(),
  type: z.string().min(1),
  category: z.enum(["EXECUTION", "METHOD", "DATABASE", "DML", "CALLOUT", "FLOW", "EXCEPTION", "LIMIT", "DEBUG", "SYSTEM", "UNKNOWN"]),
  timestampMs: z.number().optional(),
});

export type LogEvent = z.infer<typeof logEventSchema>;

export const evidenceRefSchema = z.object({
  kind: z.enum(["event", "node", "raw-range", "log"]),
  ref: z.string().min(1),
  label: z.string().optional(),
  lineStart: z.number().nonnegative().optional(),
  lineEnd: z.number().nonnegative().optional(),
});

export type EvidenceReference = z.infer<typeof evidenceRefSchema>;

export const findingSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["EXCEPTION", "GOVERNOR_LIMIT", "PERFORMANCE", "CALLOUT", "ANOMALY"]),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  title: z.string().min(1),
  summary: z.string().min(1),
  evidence: z.array(evidenceRefSchema).default([]),
  relatedNodeIds: z.array(z.string()).default([]),
});

export type Finding = z.infer<typeof findingSchema>;

export const executionModelSchema = z.object({
  executionId: z.string().min(1),
  logId: z.string().min(1),
  metadata: z.object({
    startMs: z.number().optional(),
    endMs: z.number().optional(),
    durationMs: z.number().nonnegative().optional(),
    operation: z.string().optional(),
    requestId: z.string().optional(),
  }).default({}),
  rootIds: z.array(z.string()).default([]),
  nodes: z.array(executionNodeSchema).default([]),
  events: z.array(logEventSchema).default([]),
  unknownEventCount: z.number().nonnegative().default(0),
  findings: z.array(findingSchema).default([]),
  metrics: z.object({
    eventCount: z.number().nonnegative().default(0),
    soqlCount: z.number().nonnegative().default(0),
    dmlCount: z.number().nonnegative().default(0),
    calloutCount: z.number().nonnegative().default(0),
    exceptionCount: z.number().nonnegative().default(0),
  }).default({ eventCount: 0, soqlCount: 0, dmlCount: 0, calloutCount: 0, exceptionCount: 0 }),
});

export type ExecutionModel = z.infer<typeof executionModelSchema>;

export const hypothesisSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  status: z.enum(["open", "supported", "refuted"]).default("open"),
  createdAt: z.number(),
});

export const questionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  resolved: z.boolean().default(false),
  createdAt: z.number(),
});

export const investigationSchema = z.object({
  hypotheses: z.array(hypothesisSchema).default([]),
  questions: z.array(questionSchema).default([]),
});

export type Hypothesis = z.infer<typeof hypothesisSchema>;
export type InvestigationQuestion = z.infer<typeof questionSchema>;
export type Investigation = z.infer<typeof investigationSchema>;

export const rcaSchema = z.object({
  summary: z.string().min(1),
  rootCause: z.string().optional(),
  contributingFactors: z.array(z.string()).default([]),
  evidence: z.array(evidenceRefSchema).default([]),
  impact: z.string().optional(),
  recommendations: z.array(z.string()).default([]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).default("LOW"),
  createdAt: z.number(),
});

export type RootCauseAnalysis = z.infer<typeof rcaSchema>;

export const debugSessionSchema = z.object({
  id: z.string().min(1),
  orgKey: z.string().min(1),
  title: z.string().min(1),
  problem: z.string().default(""),
  status: z.enum(DEBUG_STATUSES).default("open"),
  trace: traceConfigSchema.optional(),
  logs: z.array(capturedLogSchema).default([]),
  executions: z.array(executionModelSchema).default([]),
  /** Resolved LogUserId -> Name, filled at pull time so the table reads like Setup. */
  userNames: z.record(z.string(), z.string()).default({}),
  /** One tab per traced target - me plus whoever the architect adds. Legacy `trace` migrates in on read. */
  traces: z.array(traceConfigSchema).default([]),
  /** Structured investigation: hypotheses + open questions, the AI reads and writes these. */
  investigation: investigationSchema.default({ hypotheses: [], questions: [] }),
  rca: rcaSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type DebugSession = z.infer<typeof debugSessionSchema>;

function newId(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    /* fall through */
  }
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newDebugSessionId(): string {
  return newId("dbg");
}

export function newDebugSession(orgKey: string, title: string, problem = ""): DebugSession {
  const now = Date.now();
  return {
    id: newDebugSessionId(),
    orgKey,
    title: title.trim() || "Untitled debug session",
    problem,
    status: "open",
    logs: [],
    executions: [],
    userNames: {},
    traces: [],
    investigation: { hypotheses: [], questions: [] },
    createdAt: now,
    updatedAt: now,
  };
}

/** Findings roll up from executions for session-level views. */
export function sessionFindings(session: DebugSession): Finding[] {
  return session.executions.flatMap((e) => e.findings);
}
