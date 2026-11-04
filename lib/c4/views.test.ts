import { describe, expect, it } from "vitest";
import { c4Tree, hiddenNodeIds } from "./views";
import type { SystemProject } from "@/lib/system-design/model";

function project(): SystemProject {
  return {
    id: "p1",
    name: "Topo",
    systems: [
      { id: "person", name: "Customer", level: "context" },
      { id: "shop", name: "Shop", level: "container" },
      { id: "hub", name: "Hub", level: "container" },
      { id: "orders", name: "Orders", level: "component", parentId: "hub" },
      { id: "audit", name: "Audit" },
    ],
    connections: [
      { id: "c1", sourceId: "person", targetId: "shop", label: "browse", status: "ready" },
      { id: "c2", sourceId: "shop", targetId: "hub", label: "order", status: "ready" },
    ],
    interfaces: [],
    operations: [],
    environments: [],
    activeEnvironmentId: null,
    notes: "",
    todos: [],
  } as unknown as SystemProject;
}

describe("c4 views", () => {
  it("filters each view without dropping orphans", () => {
    const p = project();
    expect(hiddenNodeIds(p, "all")).toEqual(new Set());
    // Context: person + shop neighbor. Hub is two hops away: hidden.
    expect(hiddenNodeIds(p, "context")).toEqual(new Set(["hub", "orders", "audit"]));
    // Container: context + containers (audit defaults to container).
    expect(hiddenNodeIds(p, "container")).toEqual(new Set(["orders"]));
    // Component: orders + parent hub + context person.
    expect(hiddenNodeIds(p, "component")).toEqual(new Set(["shop", "audit"]));
  });

  it("shows everything when no levels are assigned", () => {
    const p = project();
    for (const s of p.systems) delete s.level;
    for (const v of ["context", "container", "component"] as const) {
      expect(hiddenNodeIds(p, v)).toEqual(new Set());
    }
  });

  it("builds the review tree with orphans seated", () => {
    const tree = c4Tree(project());
    expect(tree.map((n) => n.name)).toEqual(["Customer", "Shop", "Hub", "Audit"]);
    const hub = tree.find((n) => n.name === "Hub")!;
    expect(hub.children.map((n) => n.name)).toEqual(["Orders"]);
  });
});
