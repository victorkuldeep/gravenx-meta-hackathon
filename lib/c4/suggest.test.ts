import { describe, expect, it } from "vitest";
import { suggestC4 } from "./suggest";
import type { SystemProject } from "@/lib/system-design/model";

function project(): SystemProject {
  return {
    id: "p1",
    name: "Topo",
    systems: [
      { id: "shop", name: "Shop", systemType: "webapp" },
      { id: "hub", name: "Hub", systemType: "middleware" },
      { id: "billing", name: "Billing", systemType: "saas" },
      { id: "orders", name: "Orders DB", systemType: "database" },
      { id: "audit", name: "Audit", systemType: "custom" },
      { id: "lone", name: "Lone", systemType: "rest" },
      { id: "fixed", name: "Fixed", systemType: "saas", level: "container" },
    ],
    connections: [
      { id: "c1", sourceId: "shop", targetId: "hub", label: "order", status: "ready" },
      { id: "c2", sourceId: "hub", targetId: "billing", label: "bill", status: "ready" },
      { id: "c3", sourceId: "hub", targetId: "orders", label: "store", status: "ready" },
      { id: "c4", sourceId: "hub", targetId: "audit", label: "log", status: "ready" },
      { id: "c5", sourceId: "hub", targetId: "fixed", label: "use", status: "ready" },
    ],
    interfaces: [],
    operations: [],
    environments: [],
    activeEnvironmentId: null,
    notes: "",
    todos: [],
  } as unknown as SystemProject;
}

describe("c4 suggest", () => {
  it("places hubs, edges, stores and externals with reasons", () => {
    const byId = new Map(suggestC4(project()).map((s) => [s.id, s]));
    expect(byId.get("hub")).toMatchObject({ level: "container", alreadySet: false });
    expect(byId.get("hub")!.rationale).toContain("5 neighbors");
    expect(byId.get("shop")!.level).toBe("context");
    expect(byId.get("billing")).toMatchObject({ level: "context" });
    expect(byId.get("audit")!.level).toBe("context");
    // Lone datastore leaf nests inside its container service.
    expect(byId.get("orders")).toMatchObject({ level: "component", parentId: "hub" });
    // Every suggestion explains itself.
    for (const s of byId.values()) expect(s.rationale.length).toBeGreaterThan(0);
  });

  it("says nothing for unconnected nodes and keeps explicit levels", () => {
    const byId = new Map(suggestC4(project()).map((s) => [s.id, s]));
    expect(byId.get("lone")!.level).toBeNull();
    expect(byId.get("fixed")).toMatchObject({ alreadySet: true });
  });

  it("never nests under context - components need container parents", () => {
    const p = project();
    // Hub forced to context: the datastore must not follow it down.
    p.systems.find((s) => s.id === "hub")!.level = "context";
    const byId = new Map(suggestC4(p).map((s) => [s.id, s]));
    expect(byId.get("orders")).toMatchObject({ level: "container" });
    expect(byId.get("orders")!.parentId).toBeUndefined();
  });
});
