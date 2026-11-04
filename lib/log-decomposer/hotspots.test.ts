import { describe, expect, it } from "vitest";
import { aggregateHotspots, fingerprintMethod, fingerprintSoql } from "./hotspots";
import type { ExecutionModel, ExecutionNode } from "./model";

function node(partial: Partial<ExecutionNode> & { id: string }): ExecutionNode {
  return { label: partial.id, type: "METHOD", children: [], eventIds: [], status: "SUCCESS", ...partial } as ExecutionNode;
}

describe("hotspot aggregation", () => {
  it("folds SOQL literals and method args into signatures", () => {
    expect(fingerprintSoql("SELECT Id FROM Account WHERE Name = 'Acme' AND N = 3")).toBe(
      "SELECT Id FROM Account WHERE Name = '?' AND N = ?"
    );
    expect(fingerprintMethod("InvoiceService.postLines(String, Integer)")).toBe("InvoiceService.postLines");
  });

  it("groups repeats and ranks self-time", () => {
    const nodes = [
      node({ id: "root", type: "TRANSACTION", children: ["q1", "q2", "m1"], durationMs: 200 }),
      node({ id: "q1", type: "SOQL", parentId: "root", label: "SELECT Id FROM Account WHERE Name = 'A'", children: [], durationMs: 60 }),
      node({ id: "q2", type: "SOQL", parentId: "root", label: "SELECT Id FROM Account WHERE Name = 'B'", children: [], durationMs: 40 }),
      node({ id: "m1", type: "METHOD", parentId: "root", label: "Svc.run()", children: ["q3"], durationMs: 90 }),
      node({ id: "q3", type: "SOQL", parentId: "m1", label: "SELECT Id FROM Contact LIMIT 5", children: [], durationMs: 70 }),
    ];
    const model = {
      executionId: "ex", logId: "l", metadata: {}, rootIds: ["root"], nodes, events: [],
      unknownEventCount: 0, findings: [],
      metrics: { eventCount: 0, soqlCount: 0, dmlCount: 0, calloutCount: 0, exceptionCount: 0 },
    } as ExecutionModel;
    const hot = aggregateHotspots(model);
    const account = hot.find((h) => h.label.includes("FROM Account"));
    expect(account?.calls).toBe(2);
    expect(account?.totalMs).toBe(100);
    // Svc.run self = 90 - 70 child.
    expect(hot.find((h) => h.label === "Svc.run")?.selfMs).toBe(20);
  });
});
