import { describe, expect, it } from "vitest";
import { proposeScenario } from "./scenarios";
import type { RiskFinding } from "./rules";
import type { SystemProject } from "@/lib/system-design/model";

function project(): SystemProject {
  return {
    id: "p1",
    name: "Topo",
    systems: [
      { id: "s1", name: "Shop" },
      { id: "s2", name: "Hub" },
    ],
    connections: [
      {
        id: "c1",
        sourceId: "s1",
        targetId: "s2",
        sourceOperationId: "op1",
        targetOperationId: "op2",
        label: "Order",
        status: "ready" as const,
      },
    ],
    interfaces: [
      { id: "i1", systemId: "s1", name: "Shop API" },
      { id: "i2", systemId: "s2", name: "Hub API" },
    ],
    operations: [
      { id: "op1", interfaceId: "i1", name: "Create", method: "POST", path: "/orders", version: "1" },
      { id: "op2", interfaceId: "i2", name: "Accept", method: "POST", path: "/accept", version: "" },
    ],
    environments: [],
    activeEnvironmentId: null,
    flows: [{ id: "flow1", name: "Main", startEdgeId: "c1", lanes: [1], opByEdge: {} }],
    scenarios: [],
    notes: "",
    todos: [],
  } as unknown as SystemProject;
}

function finding(rule: string, refId: string, surface: "system" | "sequence" = "system"): RiskFinding {
  return { rule, severity: "medium", message: `${rule} on ${refId}`, refs: [{ surface, id: refId, name: refId }] };
}

describe("failure-scenario generator", () => {
  it("reproduces a no-retry op with a 500 mock expecting 500", () => {
    const d = proposeScenario(project(), finding("no-retry", "op1"));
    expect(d).not.toBeNull();
    expect(d!.mockOverrides.op1.status).toBe(500);
    expect(d!.expectStatus).toBe(500);
    expect(d!.validates).toEqual([{ rule: "no-retry", refId: "op1", mode: "reproduce" }]);
    expect(d!.flowId).toBe("flow1");
  });

  it("resolves a fan-in hub system to its owned operation", () => {
    const d = proposeScenario(project(), finding("fan-in-hub", "s2"));
    expect(d).not.toBeNull();
    expect(Object.keys(d!.mockOverrides)).toEqual(["op2"]);
    expect(d!.validates[0]).toMatchObject({ rule: "fan-in-hub", refId: "op2", mode: "reproduce" });
  });

  it("withstands a no-timeout op under an 8s latency probe expecting 200", () => {
    const d = proposeScenario(project(), finding("no-timeout", "op1"));
    expect(d).not.toBeNull();
    expect(d!.mockOverrides.op1).toMatchObject({ status: 200, latencyMs: 8000 });
    expect(d!.expectStatus).toBe(200);
    expect(d!.validates[0].mode).toBe("withstand");
  });

  it("returns null when nothing on the canvas answers the finding", () => {
    expect(proposeScenario(project(), finding("no-retry", "ghost"))).toBeNull();
    expect(proposeScenario(project(), { ...finding("sync-chain", "s9"), refs: [] })).toBeNull();
  });

  it("returns null for unknown rules rather than inventing a test", () => {
    expect(proposeScenario(project(), finding("future-rule", "op1"))).toBeNull();
  });
});
