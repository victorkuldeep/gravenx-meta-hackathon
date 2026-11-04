import { describe, expect, it } from "vitest";
import { suggestHypotheses, summarizeInvestigation } from "./investigate";
import type { ExecutionModel, Finding } from "./model";

function finding(type: Finding["type"], title: string): Finding {
  return { id: type, type, severity: "HIGH", title, summary: title, evidence: [], relatedNodeIds: [] };
}

function execWith(opts: { operation: string; durationMs: number; nodes: number; soql: number }): ExecutionModel {
  const nodes =
    opts.nodes === 1
      ? [{ id: "n1", type: "TRANSACTION" as const, label: "TRANSACTION", children: [], eventIds: [], status: "SUCCESS" as const, durationMs: opts.durationMs }]
      : [
          { id: "n1", type: "TRANSACTION" as const, label: "TRANSACTION", children: ["n2"], eventIds: [], status: "SUCCESS" as const, durationMs: opts.durationMs },
          { id: "n2", type: "CODE_UNIT" as const, label: "UNIT handler", children: [], eventIds: [], status: "SUCCESS" as const, durationMs: 5 },
        ];
  return {
    executionId: "ex1",
    logId: "log1",
    metadata: { operation: opts.operation, durationMs: opts.durationMs },
    rootIds: ["n1"],
    nodes,
    events: [],
    unknownEventCount: 0,
    findings: [],
    metrics: { eventCount: 10, soqlCount: opts.soql, dmlCount: 0, calloutCount: 0, exceptionCount: 0 },
  };
}

describe("hypothesis suggestions", () => {
  it("drafts one hypothesis per finding kind from the top hit", () => {
    const out = suggestHypotheses([finding("EXCEPTION", "NullPointerException"), finding("GOVERNOR_LIMIT", "SOQL rows near limit")]);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("NullPointerException");
    expect(out[1]).toContain("SOQL rows near limit");
  });

  it("concludes failure from the top exception with a narrative", () => {
    const exec = execWith({ operation: "Order sync", durationMs: 120, nodes: 2, soql: 1 });
    const v = summarizeInvestigation([exec], [finding("EXCEPTION", "NullPointerException")]);
    expect(v?.status).toBe("failed");
    expect(v?.headline).toContain("Order sync failed");
    expect(v?.bullets.length).toBeGreaterThan(0);
    expect(v?.narrative).toEqual(["TRANSACTION · 120ms", "UNIT handler · 5ms"]);
  });

  it("reports a clean run with its shape, null when empty", () => {
    const exec = execWith({ operation: "Ping", durationMs: 12, nodes: 1, soql: 1 });
    const v = summarizeInvestigation([exec], []);
    expect(v?.status).toBe("clean");
    expect(v?.headline).toContain("ran clean");
    expect(v?.bullets.join(" ")).toContain("1 SOQL");
    expect(summarizeInvestigation([], [])).toBeNull();
  });

  it("stays silent on a clean log and caps at three", () => {
    expect(suggestHypotheses([])).toEqual([]);
    const many = suggestHypotheses([
      finding("EXCEPTION", "E"),
      finding("GOVERNOR_LIMIT", "G"),
      finding("PERFORMANCE", "P"),
      finding("CALLOUT", "C"),
      finding("ANOMALY", "A"),
    ]);
    expect(many).toHaveLength(3);
  });
});
