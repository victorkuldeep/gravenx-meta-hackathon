import { describe, expect, it } from "vitest";
import { lexLine, parseLog } from "./parser";

const SUCCESS_LOG = [
  "09:12:01.100 (100000000)|EXECUTION_STARTED",
  "09:12:01.100 (100000000)|CODE_UNIT_STARTED|[EXTERNAL]|01Qxx|AccountTrigger",
  "09:12:01.150 (150000000)|METHOD_ENTRY|[7]|01pxx|MyHandler.handle()",
  "09:12:01.200 (200000000)|SOQL_EXECUTE_BEGIN|[12]|Aggregations:0|SELECT Id, Name FROM Account",
  "09:12:01.400 (400000000)|SOQL_EXECUTE_END|[12]|Rows:1",
  "09:12:01.450 (450000000)|DML_BEGIN|[15]|Op:Update|Type:Account|Rows:1",
  "09:12:01.500 (500000000)|DML_END|[15]",
  "09:12:01.550 (550000000)|METHOD_EXIT|[7]|01pxx|MyHandler.handle()",
  "09:12:01.600 (600000000)|USER_DEBUG|[7]|DEBUG|done ok",
  "09:12:01.650 (650000000)|CODE_UNIT_FINISHED|AccountTrigger",
  "09:12:01.700 (700000000)|EXECUTION_FINISHED",
].join("\n");

const FAILURE_LOG = [
  "10:00:00.000 (0)|EXECUTION_STARTED",
  "10:00:00.010 (10000000)|CODE_UNIT_STARTED|[EXTERNAL]|01pxx|OrderService.placeOrder",
  "10:00:01.000 (1000000000)|CALLOUT_REQUEST|[20]|System.HttpRequest[Endpoint=https://hub.example.com/orders, Method=POST]",
  "10:00:02.500 (2500000000)|EXCEPTION_THROWN|[20]|System.CalloutException: Read timed out",
  "10:00:12.000 (12000000000)|CALLOUT_RESPONSE|[20]|System.HttpResponse[Status=Gateway Timeout, StatusCode=504]",
  "10:00:12.010 (12010000000)|CODE_UNIT_FINISHED|OrderService.placeOrder",
  "10:00:12.020 (12020000000)|EXECUTION_FINISHED",
].join("\n");

describe("lexer", () => {
  it("splits timestamp, event and details", () => {
    const row = lexLine("09:12:01.200 (200000000)|SOQL_EXECUTE_BEGIN|[12]|SELECT 1", 4);
    expect(row).toMatchObject({ line: 4, event: "SOQL_EXECUTE_BEGIN", timestampMs: 200, details: ["[12]", "SELECT 1"] });
  });

  it("treats pipeless header lines as LOG_HEADER, never throws", () => {
    const row = lexLine("66.0 APEX_CODE,DEBUG;DB,INFO", 0);
    expect(row.event).toBe("LOG_HEADER");
    expect(row.timestampMs).toBeUndefined();
  });
});

describe("execution tree", () => {
  it("nests method > soql + dml inside trigger inside transaction", () => {
    const { model } = parseLog(SUCCESS_LOG, "log1");
    expect(model.metrics).toMatchObject({ eventCount: 11, soqlCount: 1, dmlCount: 1, calloutCount: 0, exceptionCount: 0 });
    expect(model.rootIds).toHaveLength(1);
    const root = model.nodes.find((n) => n.id === model.rootIds[0])!;
    expect(root.type).toBe("TRANSACTION");
    expect(root.status).toBe("SUCCESS");
    const trigger = model.nodes.find((n) => n.type === "TRIGGER")!;
    expect(trigger.label).toBe("AccountTrigger");
    expect(trigger.parentId).toBe(root.id);
    const soql = model.nodes.find((n) => n.type === "SOQL")!;
    expect(soql.durationMs).toBe(200);
    expect(soql.label).toContain("SELECT Id");
    const dml = model.nodes.find((n) => n.type === "DML")!;
    expect(dml.label).toBe("DML Update Account (1 rows)");
    const debug = model.nodes.filter((n) => n.label.startsWith("DEBUG"))!;
    expect(debug).toHaveLength(1);
    expect(model.metadata.durationMs).toBe(600);
  });

  it("fails the chain on exception and keeps the raw evidence", () => {
    const { model } = parseLog(FAILURE_LOG, "log2");
    expect(model.metrics.exceptionCount).toBe(1);
    const root = model.nodes.find((n) => n.id === model.rootIds[0])!;
    expect(root.status).toBe("FAILED");
    const exc = model.nodes.find((n) => n.type === "EXCEPTION")!;
    expect(exc.label).toContain("CalloutException");
    expect(exc.status).toBe("FAILED");
    const callout = model.nodes.find((n) => n.type === "CALLOUT")!;
    expect(callout.label).toContain("https://hub.example.com/orders");
    expect(callout.label).toContain("504");
    expect(callout.durationMs).toBe(11000);
    // Raw preserved verbatim with line numbers.
    const ev = model.events.find((e) => e.type === "EXCEPTION_THROWN")!;
    expect(model.events[ev.line].raw).toContain("Read timed out");
  });

  it("preserves unknown events and survives malformed lines", () => {
    const { model } = parseLog(["garbage", "12:00:00.000 (1000000)|WEIRD_FUTURE_EVENT|something", "12:00:00.001 (2000000)|EXECUTION_STARTED", "12:00:00.002 (3000000)|EXECUTION_FINISHED"].join("\n"), "log3");
    expect(model.unknownEventCount).toBe(1);
    expect(model.events.some((e) => e.type === "WEIRD_FUTURE_EVENT")).toBe(true);
    expect(model.events.some((e) => e.type === "LOG_HEADER")).toBe(true);
    expect(model.rootIds).toHaveLength(1);
  });

  it("builds flow element nesting", () => {
    const { model } = parseLog(
      ["00:00:00.000 (0)|FLOW_ELEMENT_BEGIN|flow1|FlowRecordLookup", "00:00:00.050 (50000000)|FLOW_ELEMENT_END|flow1|FlowRecordLookup"].join("\n"),
      "log4"
    );
    const flow = model.nodes.find((n) => n.type === "FLOW")!;
    expect(flow.durationMs).toBe(50);
  });

  it("attaches duplicate-detection families as system context, not unknowns", () => {
    const { model } = parseLog(
      [
        "00:00:00.000 (0)|EXECUTION_STARTED",
        "00:00:00.010 (10000000)|CODE_UNIT_STARTED|[EXTERNAL]|01pxx|MyHandler",
        "00:00:00.020 (20000000)|DUPLICATE_DETECTION_BEGIN",
        "00:00:00.030 (30000000)|DUPLICATE_DETECTION_RULE_INVOCATION|rule1",
        "00:00:00.040 (40000000)|DUPLICATE_DETECTION_MATCH_INVOCATION_DETAILS|m1",
        "00:00:00.050 (50000000)|DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY|1 match",
        "00:00:00.060 (60000000)|DUPLICATE_DETECTION_END",
        "00:00:00.070 (70000000)|CODE_UNIT_FINISHED|MyHandler",
        "00:00:00.080 (80000000)|EXECUTION_FINISHED",
      ].join("\n"),
      "log5"
    );
    expect(model.unknownEventCount).toBe(0);
    expect(model.events.filter((e) => e.category === "SYSTEM").length).toBeGreaterThanOrEqual(5);
    expect(model.nodes.some((n) => n.type === "DML" || n.type === "FLOW")).toBe(false);
  });
});
