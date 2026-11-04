import { describe, expect, it } from "vitest";
import {
  buildSystemBridgeHandlers,
  resolveSystemByName,
  resolveSystemType,
  SYSTEM_BRIDGE_KINDS,
  type SystemBridgeContext,
} from "./system";
import type { SystemProject } from "../system-design/model";

function setupCtx(): SystemBridgeContext & {
  project: SystemProject;
  placed: { type: string; name?: string }[];
  connected: { from: string; to: string; label?: string }[];
  removed: string[][];
} {
  const project = {
    id: "p1",
    name: "Demo",
    schemaVersion: 1,
    updatedAt: 1,
    systems: [
      { id: "s1", name: "Salesforce", systemType: "salesforce", description: "", position: { x: 0, y: 0 }, iconKey: "cloud" },
      { id: "s2", name: "Middleware", systemType: "middleware", description: "", position: { x: 1, y: 1 }, iconKey: "exchange" },
    ],
    connections: [],
    interfaces: [],
    operations: [],
    environments: [],
    activeEnvironmentId: null,
    notes: "",
    todos: [],
    canvasNotes: [],
    canvasImages: [],
    groups: [],
    flows: [],
    scenarios: [],
    settings: { retentionDays: 30 },
  } as unknown as SystemProject;
  const placed: { type: string; name?: string }[] = [];
  const connected: { from: string; to: string; label?: string }[] = [];
  const removed: string[][] = [];
  return {
    project,
    placed,
    connected,
    removed,
    getProject: () => project,
    newBlankProject: (name?: string) => ({ id: "p-new", name: name ?? "Untitled architecture" }),
    rebalance: () => ({ moved: project.systems.length }),
    placeSystems: (specs) => {
      // Mirror the real ctx: unknown types fail the whole call.
      for (const s of specs) resolveSystemType(s.type);
      for (const s of specs) placed.push({ type: s.type, name: s.name });
      return { placed: specs.map((s, i) => s.name ?? `System ${i}`) };
    },
    connectByName: (from, to, label) => {
      const a = resolveSystemByName(project.systems, from);
      const b = resolveSystemByName(project.systems, to);
      connected.push({ from: a.name, to: b.name, label });
      return { from: a.name, to: b.name };
    },
    removeByName: (names) => {
      removed.push(names);
      const doomed = names.map((n) => resolveSystemByName(project.systems, n).name);
      return { removed: doomed };
    },
  };
}

describe("system bridge handlers", () => {
  it("registers the 6 sys kinds", () => {
    expect(SYSTEM_BRIDGE_KINDS).toHaveLength(6);
    const handlers = buildSystemBridgeHandlers(setupCtx());
    for (const kind of SYSTEM_BRIDGE_KINDS) expect(handlers[kind]).toBeTypeOf("function");
  });

  it("starts a blank project from scratch", async () => {
    const handlers = buildSystemBridgeHandlers(setupCtx());
    const named = (await handlers["sys.new"]!({ name: "Headless CPQ demo" })) as { id: string; name: string };
    expect(named).toEqual({ id: "p-new", name: "Headless CPQ demo" });
    const blank = (await handlers["sys.new"]!({})) as { id: string; name: string };
    expect(blank).toEqual({ id: "p-new", name: "Untitled architecture" });
  });

  it("rebalances through the context", async () => {
    const handlers = buildSystemBridgeHandlers(setupCtx());
    const out = (await handlers["sys.rebalance"]!({})) as { moved: number };
    expect(out).toEqual({ moved: 2 });
  });

  it("snapshots the open project", async () => {
    const out = (await buildSystemBridgeHandlers(setupCtx())["sys.snapshot"]!({})) as {
      project: string;
      counts: { systems: number };
    };
    expect(out.project).toBe("Demo");
    expect(out.counts.systems).toBe(2);
  });

  it("resolves types and names with fail-closed errors", () => {
    expect(resolveSystemType("salesforce").type).toBe("salesforce");
    expect(resolveSystemType("Queue").type).toBe("queue");
    expect(() => resolveSystemType("teleporter")).toThrow(/Unknown system type/);
    const ctx = setupCtx();
    expect(resolveSystemByName(ctx.project.systems, "sales").name).toBe("Salesforce");
    expect(() => resolveSystemByName(ctx.project.systems, "nope")).toThrow(/Unknown system/);
  });

  it("places, connects and removes through the context", async () => {
    const ctx = setupCtx();
    const handlers = buildSystemBridgeHandlers(ctx);
    await expect(handlers["sys.place"]!({ systems: [] })).rejects.toThrow(/at least one/);
    await expect(handlers["sys.place"]!({ systems: [{ type: "teleporter" }] })).rejects.toThrow(/Unknown system type/);
    const placed = (await handlers["sys.place"]!({ systems: [{ type: "queue", name: "Orders" }] })) as { placed: string[] };
    expect(placed).toEqual({ placed: ["Orders"] });
    await expect(handlers["sys.connect"]!({ from: "Salesforce", to: "Salesforce" })).rejects.toThrow(/itself/);
    const conn = (await handlers["sys.connect"]!({ from: "sales", to: "Middleware", label: "orders" })) as { from: string; to: string };
    expect(conn).toEqual({ from: "Salesforce", to: "Middleware" });
    const removed = (await handlers["sys.remove"]!({ names: ["Middleware"] })) as { removed: string[] };
    expect(removed).toEqual({ removed: ["Middleware"] });
    await expect(handlers["sys.remove"]!({ names: ["Ghost"] })).rejects.toThrow(/Unknown system/);
  });
});
