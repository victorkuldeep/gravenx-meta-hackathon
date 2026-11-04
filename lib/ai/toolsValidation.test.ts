import { afterEach, describe, expect, it } from "vitest";
import { registerSystemBridge } from "./systemBridge";
import { setValidationBackend, VALIDATION_TOOLS } from "./toolsValidation";
import { toolsForSkill } from "./toolsSystem";
import type { SystemProject } from "@/lib/system-design/model";
import type { SystemRunRecord } from "@/lib/system-design/runStore";

const project = {
  id: "p1",
  name: "Ordering topology",
  systems: [
    { id: "s1", name: "Shop" },
    { id: "s2", name: "Hub" },
  ],
  connections: [{ id: "c1", sourceId: "s1", targetId: "s2", label: "Order", targetOperationId: "op1" }],
  interfaces: [],
  operations: [{ id: "op1", name: "Create", method: "POST", path: "/orders", version: "v1" }],
  environments: [],
  activeEnvironmentId: null,
  flows: [{ id: "flow1", name: "Main", startEdgeId: "c1", lanes: [1], opByEdge: {} }],
  scenarios: [],
  settings: { retentionDays: 30 },
  notes: "",
  todos: [],
} as unknown as SystemProject;

let runs: SystemRunRecord[];
let applied: SystemProject[];

function seed() {
  runs = [];
  applied = [];
  registerSystemBridge({
    getSnapshot: () => null,
    getProject: () => project,
    apply: (fn) => {
      const next = fn(project);
      applied.push(next);
      Object.assign(project, next);
      return { ok: true };
    },
  });
  setValidationBackend({
    sequences: async () => [],
    runs: async () => [...runs],
  });
}

afterEach(() => {
  registerSystemBridge(null);
  setValidationBackend(null);
});

function tool(name: string) {
  return VALIDATION_TOOLS.find((t) => t.name === name)!;
}

async function run(name: string, args: unknown = {}) {
  const t = tool(name);
  const parsed = t.schema.safeParse(args);
  if (!parsed.success) throw new Error(`bad test args for ${name}`);
  return t.execute(parsed.data);
}

function runRecord(over: Partial<SystemRunRecord> = {}): SystemRunRecord {
  return {
    id: "run1",
    createdAt: Date.now(),
    operationName: "Chain",
    systemName: "Shop",
    environmentName: "(no environment)",
    method: "CHAIN",
    endpoint: "",
    status: 500,
    statusText: "chain with failures",
    durationMs: 9,
    truncated: false,
    requestHeaders: {},
    requestBodyPreview: "{}",
    responseHeaders: {},
    responseBodyPreview: "",
    kind: "chain",
    steps: [],
    ...over,
  };
}

describe("validation skill + tool set", () => {
  it("extends the system pack: two reads free, one propose Apply-gated", () => {
    seed();
    for (const name of ["validation_status", "scenario_propose_for_risk", "verdict_explain"]) {
      expect(toolsForSkill("system").some((t) => t.name === name)).toBe(true);
    }
    expect(tool("validation_status").needsApproval).toBe(false);
    expect(tool("verdict_explain").needsApproval).toBe(false);
    expect(tool("scenario_propose_for_risk").needsApproval).toBe(true);
  });

  it("reports proof states and proposes a runnable scenario", async () => {
    seed();
    const before = await run("validation_status");
    expect(before.ok).toBe(true);
    const rows = (before.result as { rows: { rule: string; state: string }[] }).rows;
    expect(rows.some((r) => r.rule === "no-retry" && r.state === "unproven")).toBe(true);

    const p = await run("scenario_propose_for_risk", { rule: "no-retry", refId: "op1" });
    expect(p.ok).toBe(true);
    expect(applied).toHaveLength(1);
    const added = applied[0].scenarios[applied[0].scenarios.length - 1];
    expect(added.expectStatus).toBe(500);
    expect(added.validates).toEqual([{ rule: "no-retry", refId: "op1", mode: "reproduce" }]);
    expect(added.flowId).toBe("flow1");

    Object.assign(project, { scenarios: applied[0].scenarios });
    runs.push(runRecord({ scenarioId: added.id, verdict: "pass", status: 500 }));
    const after = await run("validation_status");
    const row = (after.result as { rows: { rule: string; state: string; confirmingRuns: string[] }[] }).rows.find(
      (r) => r.rule === "no-retry",
    )!;
    expect(row.state).toBe("failed");
    expect(row.confirmingRuns).toEqual(["run1"]);
  });

  it("explains verdicts and refuses invented findings", async () => {
    seed();
    const empty = await run("verdict_explain", { scenarioId: "scn9" });
    expect(empty.ok).toBe(false);
    const invented = await run("scenario_propose_for_risk", { rule: "no-retry", refId: "ghost" });
    expect(invented.ok).toBe(false);

    project.scenarios.push({
      id: "scn1",
      name: "Hub down",
      flowId: "flow1",
      environmentId: null,
      inputPayload: "{}",
      mockOverrides: { op1: { status: 500, body: "{}", latencyMs: 0 } },
      expectStatus: 500,
      validates: [{ rule: "no-retry", refId: "op1", mode: "reproduce" }],
    });
    runs.push(
      runRecord({
        scenarioId: "scn1",
        verdict: "pass",
        status: 500,
        steps: [{ label: "L1 · Call · POST Create (Hub) (mock)", status: 500, statusText: "failed", durationMs: 3, endpoint: "", requestBodyPreview: "", responseBodyPreview: "" }],
      }),
    );
    const explained = await run("verdict_explain", { scenarioId: "scn1" });
    expect(explained.ok).toBe(true);
    const result = explained.result as { verdict: string; intent: string; hops: { label: string }[] };
    expect(result.verdict).toBe("pass");
    expect(result.intent).toContain("no-retry (reproduce)");
    expect(result.hops).toHaveLength(1);
    project.scenarios.pop();
  });

  it("reports honestly with no canvas open", async () => {
    registerSystemBridge(null);
    expect((await run("validation_status")).ok).toBe(false);
    expect((await run("scenario_propose_for_risk", { rule: "no-retry", refId: "op1" })).ok).toBe(false);
    expect((await run("verdict_explain", { scenarioId: "scn1" })).ok).toBe(false);
  });
});
