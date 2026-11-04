import { describe, expect, it } from "vitest";
import { parseLog } from "./parser";
import { detectFindings, duplicateSoql } from "./findings";

const LIMIT_LOG = [
  "10:00:00.000 (0)|EXECUTION_STARTED",
  "10:00:00.010 (10000000)|CODE_UNIT_STARTED|[EXTERNAL]|01pxx|BulkHandler.run",
  "10:00:05.000 (5000000000)|LIMIT_USAGE_FOR_NS|[DEFAULT]|Number of SOQL queries: 97 out of 100",
  "10:00:05.010 (5010000000)|LIMIT_USAGE_FOR_NS|[DEFAULT]|Maximum CPU time: 9500 out of 10000",
  "10:00:05.020 (5020000000)|LIMIT_USAGE_FOR_NS|[DEFAULT]|Number of DML statements: 10 out of 150",
  "10:00:05.030 (5030000000)|CODE_UNIT_FINISHED|BulkHandler.run",
  "10:00:05.040 (5040000000)|EXECUTION_FINISHED",
].join("\n");

const EXC_LOG = [
  "10:00:00.000 (0)|EXECUTION_STARTED",
  "10:00:00.010 (10000000)|CODE_UNIT_STARTED|[EXTERNAL]|01pxx|OrderService.placeOrder",
  "10:00:01.000 (1000000000)|CALLOUT_REQUEST|[20]|System.HttpRequest[Endpoint=https://hub.example.com/orders, Method=POST]",
  "10:00:01.500 (1500000000)|EXCEPTION_THROWN|[20]|System.CalloutException: Read timed out",
  "10:00:02.000 (2000000000)|EXCEPTION_THROWN|[21]|System.DmlException: Insert failed",
  "10:00:12.000 (12000000000)|CALLOUT_RESPONSE|[20]|System.HttpResponse[Status=Gateway Timeout, StatusCode=504]",
  "10:00:12.010 (12010000000)|CODE_UNIT_FINISHED|OrderService.placeOrder",
  "10:00:12.020 (12020000000)|EXECUTION_FINISHED",
].join("\n");

function repeatSoql(n: number): string {
  const rows = ["00:00:00.000 (0)|EXECUTION_STARTED"];
  for (let i = 0; i < n; i++) {
    rows.push(`00:00:0${i}.000 (${i * 100000000})|SOQL_EXECUTE_BEGIN|[1]|SELECT Id FROM Account WHERE Name = 'x'`);
    rows.push(`00:00:0${i}.050 (${i * 100000000 + 50000000})|SOQL_EXECUTE_END|[1]|Rows:1`);
  }
  rows.push("00:00:09.000 (9000000000)|EXECUTION_FINISHED");
  return rows.join("\n");
}

describe("multiline limit blocks (real org shape)", () => {
  it("parses metrics split across continuation lines", () => {
    const { model } = parseLog(
      [
        "66.0 APEX_CODE,DEBUG;DB,INFO",
        "Execute Anonymous: System.debug(1);",
        "00:03:09.4 (4321402)|USER_INFO|[EXTERNAL]|005xx",
        "00:03:09.4 (4376413)|EXECUTION_STARTED",
        "00:03:09.15 (15925658)|CUMULATIVE_LIMIT_USAGE",
        "00:03:09.15 (15925658)|LIMIT_USAGE_FOR_NS|(default)|",
        "  Number of SOQL queries: 97 out of 100",
        "  Maximum CPU time: 9500 out of 10000",
        "  Number of DML statements: 1 out of 150",
        "",
        "00:03:09.15 (15925658)|CUMULATIVE_LIMIT_USAGE_END",
        "00:03:09.4 (16051079)|EXECUTION_FINISHED",
      ].join("\n"),
      "live"
    );
    expect(model.unknownEventCount).toBe(0);
    const limits = detectFindings(model).filter((f) => f.type === "GOVERNOR_LIMIT");
    expect(limits.map((f) => f.title).sort()).toEqual(["CPU time: 9500/10000", "SOQL queries: 97/100"]);
  });
});

describe("governor limit findings", () => {
  it("flags near-exhaustion with usage bars, skips healthy budgets", () => {
    const { model } = parseLog(LIMIT_LOG, "l1");
    const findings = detectFindings(model);
    const limits = findings.filter((f) => f.type === "GOVERNOR_LIMIT");
    expect(limits.map((f) => f.title)).toEqual(["SOQL queries: 97/100", "CPU time: 9500/10000"]);
    expect(limits[0].severity).toBe("CRITICAL");
    expect(limits[1].severity).toBe("CRITICAL");
    expect(limits[0].summary).toContain("97%");
  });
});

describe("exception + callout + anomaly findings", () => {
  it("headlines the first exception and flags multiples", () => {
    const { model } = parseLog(EXC_LOG, "l2");
    const findings = detectFindings(model);
    const exc = findings.filter((f) => f.type === "EXCEPTION");
    expect(exc).toHaveLength(2);
    expect(exc[0].severity).toBe("CRITICAL");
    expect(exc[1].severity).toBe("HIGH");
    expect(exc[0].evidence.length).toBeGreaterThan(0);
    const anomaly = findings.find((f) => f.type === "ANOMALY" && f.title.includes("2 exceptions"));
    expect(anomaly?.severity).toBe("HIGH");
    const callout = findings.find((f) => f.type === "CALLOUT");
    expect(callout?.severity).toBe("HIGH");
    const perf = findings.find((f) => f.type === "PERFORMANCE");
    expect(perf?.title).toContain("11,000ms");
  });
});

describe("repeated soql anomaly", () => {
  it("detects identical queries run more than 3 times", () => {
    const { model } = parseLog(repeatSoql(5), "l3");
    expect(duplicateSoql(model)).toHaveLength(1);
    const findings = detectFindings(model);
    expect(findings.some((f) => f.type === "ANOMALY" && f.title.includes("×5"))).toBe(true);
  });

  it("stays quiet at 3 or fewer repeats", () => {
    const { model } = parseLog(repeatSoql(3), "l4");
    expect(duplicateSoql(model)).toEqual([]);
    expect(detectFindings(model).filter((f) => f.type === "ANOMALY")).toEqual([]);
  });
});
