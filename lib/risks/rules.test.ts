import { describe, expect, it } from "vitest";
import { analyzeProject } from "./rules";
import type { SystemProject } from "@/lib/system-design/model";
import type { SequenceDocument } from "@/lib/sequence/model";

function project(over: Partial<SystemProject> = {}): SystemProject {
  return {
    id: "p1",
    name: "Topo",
    systems: [
      { id: "s1", name: "Shop" },
      { id: "s2", name: "Hub" },
      { id: "s3", name: "Billing" },
      { id: "s4", name: "Audit" },
    ],
    connections: [
      { id: "c1", sourceId: "s1", targetId: "s2", label: "Order", status: "ready" as const },
      { id: "c2", sourceId: "s2", targetId: "s3", label: "Bill", status: "ready" as const },
      { id: "c3", sourceId: "s3", targetId: "s4", label: "Log", status: "ready" as const },
    ],
    interfaces: [],
    operations: [],
    environments: [],
    activeEnvironmentId: null,
    notes: "",
    todos: [],
    ...over,
  } as unknown as SystemProject;
}

describe("risk rules", () => {
  it("flags long chains, fan-in hubs and unversioned ops", () => {
    const f = analyzeProject(
      project({
        connections: [
          { id: "c1", sourceId: "s1", targetId: "s2", label: "A", status: "ready" as const },
          { id: "c2", sourceId: "s3", targetId: "s2", label: "B", status: "ready" as const },
          { id: "c3", sourceId: "s4", targetId: "s2", label: "C", status: "ready" as const },
        ],
        operations: [{ id: "op1", interfaceId: "i1", name: "X", method: "POST", path: "/x", version: "" }],
      }),
    );
    expect(f.some((x) => x.rule === "fan-in-hub" && x.severity === "medium")).toBe(true);
    expect(f.some((x) => x.rule === "unversioned-api")).toBe(true);
    // No 4-chain here (star, not line).
    expect(f.some((x) => x.rule === "sync-chain")).toBe(false);
  });

  it("flags a 4-chain and missing policy on bound ops", () => {
    const f = analyzeProject(
      project({
        connections: [
          { id: "c1", sourceId: "s1", targetId: "s2", label: "Order", status: "ready" as const, targetOperationId: "op1" },
          { id: "c2", sourceId: "s2", targetId: "s3", label: "Bill", status: "ready" as const },
          { id: "c3", sourceId: "s3", targetId: "s4", label: "Log", status: "ready" as const },
        ],
        operations: [{ id: "op1", interfaceId: "i1", name: "Create", method: "POST", path: "/orders", version: "v1" }],
      }),
    );
    const chain = f.find((x) => x.rule === "sync-chain");
    expect(chain?.message).toContain("4 systems");
    expect(f.some((x) => x.rule === "no-timeout")).toBe(true);
    expect(f.some((x) => x.rule === "no-retry")).toBe(true);
  });

  it("stays quiet when policy is stated and flags naked sync calls", () => {
    const f = analyzeProject(
      project({
        systems: [
          { id: "s1", name: "Shop", systemType: "custom", description: "", position: { x: 0, y: 0 }, iconKey: "plus" },
          { id: "s2", name: "Hub", systemType: "custom", description: "", position: { x: 0, y: 0 }, iconKey: "plus" },
        ],
        connections: [{ id: "c1", sourceId: "s1", targetId: "s2", label: "Order", status: "ready" as const, targetOperationId: "op1" }],
        operations: [
          { id: "op1", interfaceId: "i1", name: "Create", method: "POST", path: "/orders", version: "v1", policy: { timeoutSecs: 30, retryAttempts: 3 } },
        ],
      }),
      [
        {
          id: "q1",
          name: "Flow",
          participants: [],
          nodes: [{ nodeType: "message", id: "m1", from: "a", to: "b", label: "Create", kind: "sync" }],
        } as unknown as SequenceDocument,
      ],
    );
    expect(f.some((x) => x.rule === "no-timeout" || x.rule === "no-retry")).toBe(false);
    expect(f.some((x) => x.rule === "naked-sync" && x.severity === "medium")).toBe(true);
  });
});
