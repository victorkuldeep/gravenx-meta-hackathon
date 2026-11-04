import { describe, expect, it } from "vitest";
import { newProject, rebalanceLayout, type SystemConnection, type SystemNode } from "./model";

function node(id: string, x = 0, y = 0): SystemNode {
  return { id, name: id, systemType: "salesforce", description: "", position: { x, y }, iconKey: "cloud" };
}

function link(sourceId: string, targetId: string, n: number): SystemConnection {
  return { id: `c${n}`, sourceId, targetId, label: "", status: "draft" };
}

describe("rebalanceLayout", () => {
  it("lays a chain left to right with readable pitch", () => {
    const p = { ...newProject("t"), systems: [node("a"), node("b"), node("c")], connections: [link("a", "b", 1), link("b", "c", 2)] };
    const out = rebalanceLayout(p);
    expect(out.get("a")).toEqual({ x: 120, y: 160 });
    expect(out.get("b")).toEqual({ x: 500, y: 160 });
    expect(out.get("c")).toEqual({ x: 880, y: 160 });
  });

  it("stacks fan-out vertically in the same layer", () => {
    const p = {
      ...newProject("t"),
      systems: [node("src"), node("x", 0, 300), node("y", 0, 100)],
      connections: [link("src", "x", 1), link("src", "y", 2)],
    };
    const out = rebalanceLayout(p);
    expect(out.get("src")).toEqual({ x: 120, y: 160 });
    // Same layer keeps current top-to-bottom order (y before x).
    expect(out.get("y")).toEqual({ x: 500, y: 160 });
    expect(out.get("x")).toEqual({ x: 500, y: 420 });
  });

  it("keeps unconnected systems without crashing", () => {
    const p = { ...newProject("t"), systems: [node("solo", 5, 5)], connections: [] };
    expect(rebalanceLayout(p).get("solo")).toEqual({ x: 120, y: 160 });
  });

  it("survives cycles instead of looping forever", () => {
    const p = {
      ...newProject("t"),
      systems: [node("a"), node("b")],
      connections: [link("a", "b", 1), link("b", "a", 2)],
    };
    const out = rebalanceLayout(p);
    expect(out.size).toBe(2);
  });
});
