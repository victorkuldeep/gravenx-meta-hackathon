import type { ExecutionModel, ExecutionNode, ExecutionNodeType, LogEvent } from "./model";

/**
 * Deterministic Salesforce debug-log parser. Structured pipeline:
 * raw lines -> lexed rows -> registry-categorized events -> stack-built
 * execution tree -> metrics. Unknown events are preserved (never dropped),
 * malformed lines degrade to UNKNOWN rows - one bad line can never kill
 * the investigation.
 */

export type EventCategory =
  | "EXECUTION"
  | "METHOD"
  | "DATABASE"
  | "DML"
  | "CALLOUT"
  | "FLOW"
  | "EXCEPTION"
  | "LIMIT"
  | "DEBUG"
  | "SYSTEM"
  | "UNKNOWN";

interface EventDef {
  category: EventCategory;
  opens: ExecutionNodeType | null;
  closes: boolean;
}

const OPENS_TRIGGER = /trigger$/i;

function nodeTypeForOpen(event: string, label: string): ExecutionNodeType {
  if (event === "EXECUTION_STARTED") return "TRANSACTION";
  if (event === "METHOD_ENTRY") return "METHOD";
  if (event === "SOQL_EXECUTE_BEGIN") return "SOQL";
  if (event === "DML_BEGIN") return "DML";
  if (event === "CALLOUT_REQUEST") return "CALLOUT";
  if (event === "FLOW_ELEMENT_BEGIN") return "FLOW";
  if (event === "CODE_UNIT_STARTED") return OPENS_TRIGGER.test(label) ? "TRIGGER" : "CODE_UNIT";
  return "SYSTEM";
}

/**
 * Duplicate-rule evaluation (DUPLICATE_DETECTION_BEGIN/END, RULE_INVOCATION,
 * MATCH_INVOCATION_*) fires inside Aura/Lightning saves. Attach-only: real
 * context, but noise in the execution tree.
 */
function familyDef(event: string): { category: EventCategory; opens: boolean; closes: boolean } | undefined {
  if (event.startsWith("DUPLICATE_DETECTION")) return { category: "SYSTEM", opens: false, closes: false };
  return undefined;
}

const REGISTRY: Record<string, { category: EventCategory; opens: boolean; closes: boolean }> = {
  EXECUTION_STARTED: { category: "EXECUTION", opens: true, closes: false },
  EXECUTION_FINISHED: { category: "EXECUTION", opens: false, closes: true },
  CODE_UNIT_STARTED: { category: "EXECUTION", opens: true, closes: false },
  CODE_UNIT_FINISHED: { category: "EXECUTION", opens: false, closes: true },
  METHOD_ENTRY: { category: "METHOD", opens: true, closes: false },
  METHOD_EXIT: { category: "METHOD", opens: false, closes: true },
  SOQL_EXECUTE_BEGIN: { category: "DATABASE", opens: true, closes: false },
  SOQL_EXECUTE_END: { category: "DATABASE", opens: false, closes: true },
  DML_BEGIN: { category: "DML", opens: true, closes: false },
  DML_END: { category: "DML", opens: false, closes: true },
  CALLOUT_REQUEST: { category: "CALLOUT", opens: true, closes: false },
  CALLOUT_RESPONSE: { category: "CALLOUT", opens: false, closes: true },
  EXCEPTION_THROWN: { category: "EXCEPTION", opens: false, closes: false },
  USER_DEBUG: { category: "DEBUG", opens: false, closes: false },
  LIMIT_USAGE_FOR_NS: { category: "LIMIT", opens: false, closes: false },
  CUMULATIVE_LIMIT_USAGE: { category: "LIMIT", opens: false, closes: false },
  CUMULATIVE_LIMIT_USAGE_END: { category: "LIMIT", opens: false, closes: false },
  USER_INFO: { category: "SYSTEM", opens: false, closes: false },
  FLOW_ELEMENT_BEGIN: { category: "FLOW", opens: true, closes: false },
  FLOW_ELEMENT_END: { category: "FLOW", opens: false, closes: true },
};

export interface LexedRow {
  line: number;
  raw: string;
  timestampMs: number | undefined;
  event: string;
  details: string[];
}

const TS_RE = /^\d{2}:\d{2}:\d{2}\.\d{1,3}\s*\((\d+)\)$/;

export function lexLine(raw: string, line: number): LexedRow {
  const pipe = raw.indexOf("|");
  // No pipe: version/levels header or the echoed code line at the top.
  if (pipe < 0) return { line, raw, timestampMs: undefined, event: raw.trim() ? "LOG_HEADER" : "MALFORMED", details: [] };
  const head = raw.slice(0, pipe).trim();
  const rest = raw.slice(pipe + 1);
  const m = TS_RE.exec(head);
  const timestampMs = m ? Math.floor(Number(m[1]) / 1e6) : undefined;
  const segs = rest.split("|");
  const event = (segs[0] ?? "").trim() || "MALFORMED";
  return { line, raw, timestampMs, event, details: segs.slice(1) };
}

function lastDetail(details: string[], max = 160): string {
  for (let i = details.length - 1; i >= 0; i--) {
    const d = details[i].trim();
    if (d) return d.length > max ? `${d.slice(0, max)}…` : d;
  }
  return "";
}

function dmlLabel(details: string[]): string {
  const kv: Record<string, string> = {};
  for (const d of details) {
    const m = /^([^:]+):(.*)$/.exec(d.trim());
    if (m) kv[m[1].trim()] = m[2].trim();
  }
  const op = kv.Op ?? "";
  const type = kv.Type ?? "";
  const rows = kv.Rows ?? "";
  const core = `DML ${op} ${type}`.trim();
  return rows ? `${core} (${rows} rows)` : core;
}

function calloutLabel(event: string, details: string[]): string {
  const blob = details.join("|");
  if (event === "CALLOUT_REQUEST") {
    const m = /Endpoint=([^,\]]+)/.exec(blob);
    const meth = /Method=([^,\]]+)/.exec(blob);
    return `CALL ${meth?.[1] ?? ""} ${m?.[1] ?? lastDetail(details)}`.trim();
  }
  const m = /Status=([^,\]]+)/.exec(blob);
  const code = /StatusCode=(\d+)/.exec(blob);
  return `RESPONSE ${code?.[1] ?? ""} ${m?.[1] ?? ""}`.trim() || "CALLOUT_RESPONSE";
}

function nodeLabel(event: string, details: string[]): string {
  if (event === "EXECUTION_STARTED") return `TRANSACTION ${lastDetail(details, 80)}`;
  if (event === "SOQL_EXECUTE_BEGIN") return lastDetail(details, 300);
  if (event === "DML_BEGIN") return dmlLabel(details);
  if (event === "CALLOUT_REQUEST" || event === "CALLOUT_RESPONSE") return calloutLabel(event, details);
  if (event === "EXCEPTION_THROWN") return lastDetail(details, 300);
  if (event === "USER_DEBUG") return `DEBUG ${lastDetail(details, 200)}`;
  return lastDetail(details);
}

const MAX_DEPTH = 100;

/** A timestamped log row starts with HH:MM:SS.mmm - anything else continues the previous event. */
const TS_LINE_RE = /^\d{2}:\d{2}:\d{2}\.\d/;

export interface ParseResult {
  model: ExecutionModel;
  maxDepth: number;
}

export function parseLog(rawBody: string, logId: string, executionId?: string): ParseResult {
  const lines = rawBody.split(/\r?\n/);
  const events: LogEvent[] = [];
  const nodes: ExecutionNode[] = [];
  const rootIds: string[] = [];
  const stack: ExecutionNode[] = [];
  let unknownEventCount = 0;
  let maxDepth = 0;
  let seq = 0;
  const nid = () => `n${++seq}`;

  const attach = (target: ExecutionNode | undefined, eventId: string) => {
    if (target) target.eventIds.push(eventId);
    else if (rootIds.length > 0) nodes.find((n) => n.id === rootIds[rootIds.length - 1])?.eventIds.push(eventId);
  };

  lines.forEach((raw, idx) => {
    if (!raw.trim()) return;
    // Continuation line (stack traces, multi-line limit blocks): no
    // timestamp, belongs to the previous event - appended verbatim so the
    // evidence stays whole and limit metrics parse from one block.
    if (!TS_LINE_RE.test(raw) && events.length > 0) {
      events[events.length - 1].raw += `\n${raw}`;
      return;
    }
    const row = lexLine(raw, idx);
    const reg = REGISTRY[row.event] ?? familyDef(row.event);
    const def: EventDef | undefined = reg
      ? {
          category: reg.category,
          opens: reg.opens ? nodeTypeForOpen(row.event, lastDetail(row.details)) : null,
          closes: reg.closes,
        }
      : undefined;
    const category = def?.category ?? "UNKNOWN";
    if (!def && row.event !== "LOG_HEADER") unknownEventCount++;
    const eventId = `e${idx}`;
    events.push({ id: eventId, line: idx, raw, type: row.event, category, timestampMs: row.timestampMs });

    if (def?.opens) {
      const label = nodeLabel(row.event, row.details) || row.event;
      const node: ExecutionNode = {
        id: nid(),
        type: def.opens,
        label,
        parentId: stack.length > 0 ? stack[stack.length - 1].id : undefined,
        startMs: row.timestampMs,
        children: [],
        status: "UNKNOWN",
        eventIds: [eventId],
      };
      if (row.event === "CODE_UNIT_STARTED" || row.event === "METHOD_ENTRY") {
        const m = /([A-Za-z_][\w.]*)\.([A-Za-z_]\w*)\s*\(?/.exec(label);
        if (m) node.source = { className: m[1], methodName: m[2] };
      }
      const parent = stack[stack.length - 1];
      if (parent && stack.length < MAX_DEPTH) {
        parent.children.push(node.id);
        stack.push(node);
      } else if (!parent) {
        rootIds.push(node.id);
        stack.push(node);
      } else {
        // Depth guard: attach as a leaf on the current top instead of
        // growing the stack unboundedly.
        parent.children.push(node.id);
        nodes.push(node);
        maxDepth = Math.max(maxDepth, stack.length + 1);
        return;
      }
      nodes.push(node);
      maxDepth = Math.max(maxDepth, stack.length);
      return;
    }

    if (def?.closes) {
      const top = stack.pop();
      if (top) {
        top.eventIds.push(eventId);
        if (row.timestampMs !== undefined && top.startMs !== undefined) {
          top.durationMs = Math.max(0, row.timestampMs - top.startMs);
          top.endMs = row.timestampMs;
        }
        if (row.event === "CALLOUT_RESPONSE") {
          const blob = row.details.join("|");
          const code = /StatusCode=(\d+)/.exec(blob);
          if (code) top.label = `${top.label} → ${code[1]}`;
        }
      } else {
        attach(undefined, eventId);
      }
      return;
    }

    // Leaf or attach-only events.
    if (row.event === "EXCEPTION_THROWN" || row.event === "USER_DEBUG") {
      const node: ExecutionNode = {
        id: nid(),
        type: row.event === "EXCEPTION_THROWN" ? "EXCEPTION" : "SYSTEM",
        label: nodeLabel(row.event, row.details) || row.event,
        parentId: stack.length > 0 ? stack[stack.length - 1].id : undefined,
        startMs: row.timestampMs,
        endMs: row.timestampMs,
        durationMs: 0,
        children: [],
        status: row.event === "EXCEPTION_THROWN" ? "FAILED" : "UNKNOWN",
        eventIds: [eventId],
      };
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(node.id);
      else rootIds.push(node.id);
      nodes.push(node);
      return;
    }
    attach(stack[stack.length - 1], eventId);
  });

  // Close anything left open at the last timestamp.
  const lastTs = [...events].reverse().find((e) => e.timestampMs !== undefined)?.timestampMs;
  for (const node of stack) {
    if (node.startMs !== undefined && lastTs !== undefined && node.durationMs === undefined) {
      node.durationMs = Math.max(0, lastTs - node.startMs);
      node.endMs = lastTs;
    }
  }

  // Bottom-up status: an exception anywhere below fails the chain.
  const failed = new Set<string>();
  for (const n of nodes) if (n.type === "EXCEPTION") failed.add(n.id);
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of nodes) {
      if (!failed.has(n.id) && n.children.some((c) => failed.has(c))) {
        failed.add(n.id);
        changed = true;
      }
    }
  }
  for (const n of nodes) {
    if (n.status !== "UNKNOWN") continue;
    n.status = failed.has(n.id) ? "FAILED" : stack.includes(n) && n.durationMs === undefined ? "RUNNING" : "SUCCESS";
  }

  let soqlCount = 0;
  let dmlCount = 0;
  let calloutCount = 0;
  let exceptionCount = 0;
  for (const n of nodes) {
    if (n.type === "SOQL") soqlCount++;
    else if (n.type === "DML") dmlCount++;
    else if (n.type === "CALLOUT") calloutCount++;
    else if (n.type === "EXCEPTION") exceptionCount++;
  }

  const firstTs = events.find((e) => e.timestampMs !== undefined)?.timestampMs;
  const model: ExecutionModel = {
    executionId: executionId ?? `ex_${logId}`,
    logId,
    metadata: {
      startMs: firstTs,
      endMs: lastTs,
      durationMs: firstTs !== undefined && lastTs !== undefined ? Math.max(0, lastTs - firstTs) : undefined,
    },
    rootIds,
    nodes,
    events,
    unknownEventCount,
    findings: [],
    metrics: { eventCount: events.length, soqlCount, dmlCount, calloutCount, exceptionCount },
  };
  return { model, maxDepth };
}
