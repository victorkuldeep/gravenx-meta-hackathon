import { describe, expect, it } from "vitest";
import { newConsoleTask } from "@/lib/console/model";
import { buildIndex } from "@/lib/graph/index";
import { GRAPH_TOOLS } from "./toolsGraph";

// graph_describe runs against the live IDB stores, so unit coverage pins
// the contract (read-only, approval-free) and the pure shaping around it:
// totals, bounded matches, inbound/outbound counts per record.

describe("graph tool set", () => {
  it("registers one approval-free read tool", () => {
    expect(GRAPH_TOOLS.map((t) => t.name)).toEqual(["graph_describe"]);
    expect(GRAPH_TOOLS[0].needsApproval).toBe(false);
  });

  it("validates its args", () => {
    const t = GRAPH_TOOLS[0];
    expect(t.schema.safeParse({}).success).toBe(true);
    expect(t.schema.safeParse({ query: "x", surface: "system" }).success).toBe(true);
    expect(t.schema.safeParse({ surface: "nope" }).success).toBe(false);
  });

  it("counts inbound/outbound off a hand-built index", () => {
    const t = { ...newConsoleTask("Track the portal", 4), links: [{ surface: "wireframe" as const, recordId: "e1", label: "P" }] };
    const g = buildIndex({ tasks: [t] });
    // Task links a missing experience: one links edge, one unresolved stub.
    expect(g.edges.filter((e) => e.kind === "links")).toHaveLength(1);
    expect(g.unresolved.length).toBeGreaterThan(0);
    const task = g.nodes.find((n) => n.kind === "console-task")!;
    expect(g.edges.filter((e) => e.from === task.key)).toHaveLength(1);
  });
});
