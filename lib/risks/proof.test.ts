import { describe, expect, it } from "vitest";
import { coveringScenarios, findingKey, proveFindings } from "./proof";
import type { RiskFinding } from "./rules";
import type { ScenarioDef } from "@/lib/system-design/model";
import type { SystemRunRecord } from "@/lib/system-design/runStore";

const finding: RiskFinding = {
  rule: "no-retry",
  severity: "low",
  message: "No retry stated on POST /orders",
  refs: [{ surface: "system", id: "op1", name: "POST /orders" }],
};

function scenario(over: Partial<ScenarioDef> = {}): ScenarioDef {
  return {
    id: "scn1",
    name: "Hub down",
    flowId: "flow1",
    environmentId: null,
    inputPayload: "{}",
    mockOverrides: {},
    expectStatus: 500,
    ...over,
  };
}

function run(over: Partial<SystemRunRecord> = {}): SystemRunRecord {
  return {
    id: "run1",
    createdAt: Date.now(),
    operationName: "Chain from Shop (1 lane)",
    systemName: "Shop",
    environmentName: "(no environment)",
    method: "CHAIN",
    endpoint: "",
    status: 500,
    statusText: "chain with failures",
    durationMs: 12,
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

describe("finding proof states", () => {
  it("keys findings by rule plus cited record ids", () => {
    expect(findingKey(finding)).toBe("no-retry:op1");
  });

  it("is unproven with no validating scenario", () => {
    const [p] = proveFindings([finding], [scenario({ validates: undefined })], [], 30);
    expect(p.state).toBe("unproven");
    expect(coveringScenarios(finding, [scenario({ validates: undefined })])).toHaveLength(0);
  });

  it("is covered when a scenario names the rule and record", () => {
    const s = scenario({ validates: [{ rule: "no-retry", refId: "op1" }] });
    const [p] = proveFindings([finding], [s], [], 30);
    expect(p.state).toBe("covered");
    expect(p.scenarioIds).toEqual(["scn1"]);
  });

  it("ignores validates entries naming other rules or records", () => {
    const s = scenario({ validates: [{ rule: "no-timeout", refId: "op1" }, { rule: "no-retry", refId: "op9" }] });
    const [p] = proveFindings([finding], [s], [], 30);
    expect(p.state).toBe("unproven");
  });

  it("proves live on a fresh passing run with no mocks", () => {
    const s = scenario({ validates: [{ rule: "no-retry", refId: "op1" }] });
    const r = run({ scenarioId: "scn1", verdict: "pass", status: 200 });
    const [p] = proveFindings([finding], [s], [r], 30);
    expect(p.state).toBe("proven-live");
    expect(p.provingRunIds).toEqual(["run1"]);
  });

  it("proves mock when the launching scenario carried overrides", () => {
    const s = scenario({ validates: [{ rule: "no-retry", refId: "op1" }], mockOverrides: { op1: { status: 500, body: "{}", latencyMs: 0 } } });
    const r = run({ scenarioId: "scn1", verdict: "pass", status: 200 });
    const [p] = proveFindings([finding], [s], [r], 30);
    expect(p.state).toBe("proven-mock");
  });

  it("trusts the run labels over scenario intent for mock detection", () => {
    const s = scenario({ validates: [{ rule: "no-retry", refId: "op1" }] });
    const r = run({
      scenarioId: "scn1",
      verdict: "pass",
      steps: [{ label: "L1 · Call · POST X (Hub) (mock)", status: 200, statusText: "ok", durationMs: 3, endpoint: "", requestBodyPreview: "", responseBodyPreview: "" }],
    });
    const [p] = proveFindings([finding], [s], [r], 30);
    expect(p.state).toBe("proven-mock");
  });

  it("marks failed when a fresh run reproduces the feared condition - loudest wins", () => {
    const s = scenario({ validates: [{ rule: "no-retry", refId: "op1" }] });
    const bad = run({ id: "bad", scenarioId: "scn1", verdict: "fail" });
    const good = run({ id: "good", scenarioId: "scn1", verdict: "pass", status: 200 });
    const [p] = proveFindings([finding], [s], [good, bad], 30);
    expect(p.state).toBe("failed");
    expect(p.failedRunIds).toEqual(["bad"]);
  });

  it("decays to covered when the only proof is older than retention", () => {
    const s = scenario({ validates: [{ rule: "no-retry", refId: "op1" }] });
    const old = run({ scenarioId: "scn1", verdict: "pass", status: 200, createdAt: Date.now() - 31 * 24 * 3600 * 1000 });
    const [p] = proveFindings([finding], [s], [old], 30);
    expect(p.state).toBe("covered");
    expect(p.provingRunIds).toEqual([]);
  });

  it("ignores orphaned runs whose scenario was deleted", () => {
    const r = run({ scenarioId: "gone", verdict: "pass", status: 200 });
    const [p] = proveFindings([finding], [], [r], 30);
    expect(p.state).toBe("unproven");
  });

  it("confirms the risk when a reproduce run meets its failure expectation", () => {
    const s = scenario({ validates: [{ rule: "no-retry", refId: "op1", mode: "reproduce" }] });
    const r = run({ scenarioId: "scn1", verdict: "pass", status: 500 });
    const [p] = proveFindings([finding], [s], [r], 30);
    expect(p.state).toBe("failed");
    expect(p.failedRunIds).toEqual(["run1"]);
  });

  it("treats an unexpectedly successful reproduce run as the design holding", () => {
    const s = scenario({ validates: [{ rule: "no-retry", refId: "op1", mode: "reproduce" }] });
    const r = run({ scenarioId: "scn1", verdict: "fail", status: 200 });
    const [p] = proveFindings([finding], [s], [r], 30);
    expect(p.state).toBe("proven-live");
    expect(p.provingRunIds).toEqual(["run1"]);
  });

  it("counts a signed override-pass as proof and a verdict-less run as cover only", () => {
    const s = scenario({ validates: [{ rule: "no-retry", refId: "op1" }] });
    const over = run({ id: "over", scenarioId: "scn1", verdict: "override-pass", status: 200 });
    const [p1] = proveFindings([finding], [s], [over], 30);
    expect(p1.state).toBe("proven-live");
    const bare = run({ id: "bare", scenarioId: "scn1", verdict: undefined, status: 200 });
    const [p2] = proveFindings([finding], [s], [bare], 30);
    expect(p2.state).toBe("covered");
  });
});
