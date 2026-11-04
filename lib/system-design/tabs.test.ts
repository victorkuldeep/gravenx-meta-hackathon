import { describe, expect, it } from "vitest";

import {
  coerceFlows,
  coerceScenarios,
  coerceSettings,
  defaultInterfaceFor,
  ensureDefaultInterfaces,
  exportProject,
  importProject,
  newProject,
  resolveSystemBaseUrl,
  validateProject,
} from "./model";

describe("flows / scenarios / settings coercion", () => {
  it("new projects start with empty flows, scenarios, and default settings", () => {
    const p = newProject("x");
    expect(p.flows).toEqual([]);
    expect(p.scenarios).toEqual([]);
    expect(p.settings).toEqual({ retentionDays: 30 });
  });

  it("vintage records validate with coerced defaults", () => {
    const vintage = {
      id: "proj_1",
      name: "vintage",
      schemaVersion: 1,
      updatedAt: 1,
      systems: [],
      connections: [],
    };
    const { project, issues } = validateProject(vintage);
    expect(issues).toEqual([]);
    expect(project?.flows).toEqual([]);
    expect(project?.scenarios).toEqual([]);
    expect(project?.settings).toEqual({ retentionDays: 30 });
  });

  it("flows keep valid entries and drop malformed ones", () => {
    const flows = coerceFlows([
      { id: "f1", name: "TMF622 as-is", startEdgeId: "e1", lanes: [2, 1, 2, -1, "x"], opByEdge: { e1: "op1", bad: 7 } },
      { id: "", name: "no id" },
      { name: "no id at all" },
      "junk",
    ]);
    expect(flows).toHaveLength(1);
    expect(flows[0]).toEqual({ id: "f1", name: "TMF622 as-is", startEdgeId: "e1", lanes: [1, 2], opByEdge: { e1: "op1" } });
  });

  it("scenarios clamp mocks, payload, and expected status", () => {
    const [s] = coerceScenarios([
      {
        id: "s1",
        name: "happy",
        flowId: "f1",
        environmentId: "",
        inputPayload: '{"a":1}',
        mockOverrides: {
          op1: { status: 200, body: '{"ok":true}', latencyMs: 50 },
          bad: { status: "x", body: 1, latencyMs: 2 },
        },
        expectStatus: 200,
      },
      { id: "s2", name: "  ", flowId: 9, expectStatus: 99 },
    ]);
    expect(s.flowId).toBe("f1");
    expect(s.environmentId).toBeNull();
    expect(s.mockOverrides).toEqual({ op1: { status: 200, body: '{"ok":true}', latencyMs: 50 } });
    expect(s.expectStatus).toBe(200);
  });

  it("settings clamp retention to 1-365 days with a 30-day default", () => {
    expect(coerceSettings(undefined)).toEqual({ retentionDays: 30 });
    expect(coerceSettings({})).toEqual({ retentionDays: 30 });
    expect(coerceSettings({ retentionDays: 0 })).toEqual({ retentionDays: 1 });
    expect(coerceSettings({ retentionDays: 9999 })).toEqual({ retentionDays: 365 });
    expect(coerceSettings({ retentionDays: 7 })).toEqual({ retentionDays: 7 });
  });

  it("non-boolean production flags are import issues", () => {
    const raw = {
      id: "proj_1",
      name: "p",
      schemaVersion: 1,
      updatedAt: 1,
      systems: [],
      connections: [],
      environments: [{ id: "env1", name: "Prod", baseUrl: "", isProduction: "yes" }],
    };
    const { project, issues } = validateProject(raw);
    expect(project).toBeNull();
    expect(issues.some((i) => i.path.includes("isProduction"))).toBe(true);
  });

  it("rejects bad vocabularies and duplicate connections", () => {
    const sys = [{ id: "s1", name: "S", systemType: "bogus", position: { x: 0, y: 0 } }];
    const conns = [
      { id: "c1", sourceId: "s1", targetId: "s1" },
      { id: "c1", sourceId: "s1", targetId: "s1" },
    ];
    const first = validateProject({ id: "p", name: "p", schemaVersion: 1, updatedAt: 1, systems: sys, connections: conns });
    expect(first.project).toBeNull();
    const early = first.issues.map((i) => i.path);
    expect(early).toContain("$.systems[0].systemType");
    expect(early).toContain("$.connections[1].id");
    // Registry sections validate after topology passes.
    const second = validateProject({
      id: "p",
      name: "p",
      schemaVersion: 1,
      updatedAt: 1,
      systems: [{ id: "s1", name: "S", systemType: "rest", position: { x: 0, y: 0 } }],
      connections: [],
      interfaces: [{ id: "f1", systemId: "s1", name: "API", protocol: "SOAP2" }],
      operations: [{ id: "o1", interfaceId: "f1", name: "Op", method: "GET", path: 7 }],
      environments: [{ id: "e1", name: "E", baseUrl: 7 }],
    });
    expect(second.project).toBeNull();
    const paths = second.issues.map((i) => i.path);
    expect(paths).toContain("$.interfaces[0].protocol");
    expect(paths).toContain("$.operations[0].path");
    expect(paths).toContain("$.environments[0].baseUrl");
  });

  it("defaults missing registry shapes and truncates oversized sample bodies", () => {
    const raw = {
      id: "proj_1",
      name: "p",
      schemaVersion: 1,
      updatedAt: 1,
      systems: [{ id: "s1", name: "S", systemType: "rest", position: { x: 0, y: 0 } }],
      connections: [],
      interfaces: [{ id: "f1", systemId: "s1", name: "API" }],
      operations: [{ id: "o1", interfaceId: "f1", name: "Op", method: "GET", sampleBody: "x".repeat(25000) }],
      environments: [{ id: "e1", name: "E" }],
    };
    const { project, issues } = validateProject(raw);
    expect(issues).toEqual([]);
    expect(project?.interfaces[0].protocol).toBe("REST");
    expect(project?.interfaces[0].basePath).toBe("");
    expect(project?.operations[0].path).toBe("");
    expect(project?.operations[0].version).toBe("v1");
    expect(project?.operations[0].sampleBody?.length).toBe(20000);
    expect(project?.environments[0].baseUrl).toBe("");
  });

  it("resolves system URLs: env override, then node URL, then fallback", () => {
    const systems = [
      { id: "s1", baseUrl: "https://node.test" },
      { id: "s2", baseUrl: "" },
    ];
    const env = { baseUrl: "https://fallback.test", baseUrlOverrides: { s1: "https://override.test" } };
    expect(resolveSystemBaseUrl(systems, env, "s1")).toBe("https://override.test");
    expect(resolveSystemBaseUrl(systems, { baseUrl: "", baseUrlOverrides: {} }, "s1")).toBe("https://node.test");
    expect(resolveSystemBaseUrl(systems, env, "s2")).toBe("https://fallback.test");
    expect(resolveSystemBaseUrl(systems, null, "s1")).toBe("https://node.test");
    expect(resolveSystemBaseUrl(systems, null, "ghost")).toBe("");
    // Blank overrides fall through instead of blanking the URL.
    expect(resolveSystemBaseUrl(systems, { baseUrl: "", baseUrlOverrides: { s1: "  " } }, "s1")).toBe("https://node.test");
  });

  it("switching environments retargets a fully-specified canvas via overrides", () => {
    const systems = [
      { id: "s1", baseUrl: "https://node-s1.test" },
      { id: "s2", baseUrl: "https://node-s2.test" },
    ];
    const sandbox = { baseUrl: "", baseUrlOverrides: {} };
    const prod = {
      baseUrl: "",
      baseUrlOverrides: { s1: "https://prod-s1.test", s2: "https://prod-s2.test" },
    };
    // Same node URLs, different active environment -> different targets.
    expect(resolveSystemBaseUrl(systems, sandbox, "s1")).toBe("https://node-s1.test");
    expect(resolveSystemBaseUrl(systems, prod, "s1")).toBe("https://prod-s1.test");
    expect(resolveSystemBaseUrl(systems, prod, "s2")).toBe("https://prod-s2.test");
    // Clearing one override drops just that system back to its own URL.
    const partial = { baseUrl: "", baseUrlOverrides: { s1: "https://prod-s1.test" } };
    expect(resolveSystemBaseUrl(systems, partial, "s2")).toBe("https://node-s2.test");
  });

  it("gives every system a default interface, never duplicating", () => {
    const sys = (id: string) => ({ id, baseUrl: "" });
    const withOne = {
      systems: [sys("s1"), sys("s2")],
      interfaces: [defaultInterfaceFor("s1")],
    } as Parameters<typeof ensureDefaultInterfaces>[0];
    const fixed = ensureDefaultInterfaces(withOne);
    expect(fixed.interfaces.filter((f) => f.systemId === "s1")).toHaveLength(1);
    expect(fixed.interfaces.filter((f) => f.systemId === "s2")).toHaveLength(1);
    expect(fixed.interfaces.find((f) => f.systemId === "s2")).toMatchObject({
      name: "REST API",
      protocol: "REST",
      basePath: "",
    });
    // Nothing missing -> same reference back, no churn.
    expect(ensureDefaultInterfaces(fixed)).toBe(fixed);
  });

  it("validator preserves stored interfaces; the app layer backfills vintage projects", () => {
    const vintage = {
      id: "p",
      name: "p",
      schemaVersion: 1,
      updatedAt: 1,
      systems: [{ id: "s1", name: "S", systemType: "rest", position: { x: 0, y: 0 } }],
      connections: [],
      interfaces: [],
      operations: [],
      environments: [{ id: "e1", name: "E", baseUrl: "" }],
    };
    const { project, issues } = validateProject(vintage);
    expect(issues).toEqual([]);
    // Pure contract: the validator stores interfaces exactly as given.
    expect(project?.interfaces).toEqual([]);
    if (!project) throw new Error("expected a valid project");
    // App-layer healing: every load path wraps with ensureDefaultInterfaces.
    expect(ensureDefaultInterfaces(project).interfaces.map((f) => f.systemId)).toEqual(["s1"]);
  });

  it("defaults, validates, and prunes environment URL overrides", () => {
    const raw = {
      id: "proj_1",
      name: "p",
      schemaVersion: 1,
      updatedAt: 1,
      systems: [{ id: "s1", name: "S", systemType: "rest", position: { x: 0, y: 0 } }],
      connections: [],
      environments: [{ id: "e1", name: "E", baseUrlOverrides: { s1: "https://a.test", ghost: "https://b.test" } }],
    };
    const { project, issues } = validateProject(raw);
    expect(issues).toEqual([]);
    expect(project?.environments[0].baseUrlOverrides).toEqual({ s1: "https://a.test" });
    const vintage = validateProject({
      id: "p",
      name: "p",
      schemaVersion: 1,
      updatedAt: 1,
      systems: [],
      connections: [],
      environments: [{ id: "e1", name: "E", baseUrl: "" }],
    });
    expect(vintage.project?.environments[0].baseUrlOverrides).toEqual({});
    const bad = validateProject({
      id: "p",
      name: "p",
      schemaVersion: 1,
      updatedAt: 1,
      systems: [],
      connections: [],
      environments: [{ id: "e1", name: "E", baseUrl: "", baseUrlOverrides: { s1: 7 } }],
    });
    expect(bad.project).toBeNull();
    expect(bad.issues.some((i) => i.path.includes("baseUrlOverrides"))).toBe(true);
  });

  it("survives a save/load cycle with flows, mappings, scenarios, settings, and env URLs intact", () => {
    const p = newProject("roundtrip");
    p.systems.push(
      { id: "s1", name: "A", systemType: "rest", description: "", baseUrl: "https://a.test", position: { x: 0, y: 0 }, iconKey: "bolt" },
      { id: "s2", name: "B", systemType: "rest", description: "", position: { x: 0, y: 0 }, iconKey: "bolt" }
    );
    p.interfaces.push(
      { id: "f1", systemId: "s1", name: "API", protocol: "REST", basePath: "" },
      { id: "f2", systemId: "s2", name: "API", protocol: "REST", basePath: "" }
    );
    p.operations.push(
      { id: "o1", interfaceId: "f1", name: "Get", method: "GET", path: "/x", version: "v1", sampleBody: "{}", headers: [{ key: "X", value: "$env.T" }] },
      { id: "o2", interfaceId: "f2", name: "Post", method: "POST", path: "/y", version: "v1", mock: { status: 200, body: "{}", latencyMs: 0 } }
    );
    p.connections.push({
      id: "c1", sourceId: "s1", targetId: "s2", label: "L", status: "draft",
      sourceOperationId: "o1", targetOperationId: "o2",
      mapping: { mode: "template", template: '{"a":{{response.x}}}' },
    });
    p.environments = [
      { id: "e1", name: "E", baseUrl: "https://fb.test", baseUrlOverrides: { s1: "https://s1.test" }, isProduction: true },
    ];
    p.activeEnvironmentId = "e1";
    p.runScope = { startEdgeId: "c1", lanes: [1], opByEdge: { c1: "o1" } };
    p.flows = [{ id: "fl1", name: "F", startEdgeId: "c1", lanes: [1], opByEdge: {} }];
    p.scenarios = [{
      id: "sc1", name: "S", flowId: "fl1", environmentId: "e1", inputPayload: '{"a":1}',
      mockOverrides: { o2: { status: 200, body: "{}", latencyMs: 5 } }, expectStatus: 200,
    }];
    p.settings = { retentionDays: 7 };
    // Same fidelity as the IndexedDB structured-clone cycle: whole project
    // object out, validated project back.
    const reloaded = importProject(JSON.parse(JSON.stringify(exportProject(p))));
    expect(reloaded.issues).toEqual([]);
    const q = reloaded.project;
    expect(q?.flows).toEqual(p.flows);
    expect(q?.scenarios).toEqual(p.scenarios);
    expect(q?.settings).toEqual(p.settings);
    expect(q?.runScope).toEqual(p.runScope);
    expect(q?.connections[0].mapping).toEqual(p.connections[0].mapping);
    expect(q?.operations).toEqual(p.operations);
    expect(q?.environments).toEqual(p.environments);
    expect(q?.activeEnvironmentId).toBe("e1");
  });

  it("drops scenario mock overrides outside import ranges", () => {
    const [kept] = coerceScenarios([
      {
        id: "s1",
        name: "s",
        mockOverrides: {
          good: { status: 200, body: "{}", latencyMs: 10 },
          badStatus: { status: 99, body: "{}", latencyMs: 10 },
          badLatency: { status: 200, body: "{}", latencyMs: 99999 },
        },
      },
    ]);
    expect(Object.keys(kept.mockOverrides)).toEqual(["good"]);
  });
});
