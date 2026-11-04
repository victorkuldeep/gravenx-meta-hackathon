import { afterEach, describe, expect, it } from "vitest";
import { registerSystemBridge } from "./systemBridge";
import { DECISION_TOOLS } from "./toolsDecisions";
import { RISK_TOOLS, setRisksBackend } from "./toolsRisks";
import { toolsForSkill } from "./toolsSystem";
import { type Decision } from "@/lib/decisions/model";
import type { SystemProject } from "@/lib/system-design/model";

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
  notes: "",
  todos: [],
} as unknown as SystemProject;

let decisions: Decision[];

function seed() {
  decisions = [];
  registerSystemBridge({
    getSnapshot: () => null,
    getProject: () => project,
    apply: () => ({ ok: true }),
  });
  setRisksBackend({
    sequences: async () => [],
    decisions: async () => [...decisions],
    saveDecision: async (d) => {
      decisions.push(d);
    },
  });
}

afterEach(() => {
  registerSystemBridge(null);
  setRisksBackend(null);
});

function tool(name: string) {
  return RISK_TOOLS.find((t) => t.name === name)!;
}

async function run(name: string, args: unknown = {}) {
  const t = tool(name);
  const parsed = t.schema.safeParse(args);
  if (!parsed.success) throw new Error(`bad test args for ${name}`);
  return t.execute(parsed.data);
}

describe("risk skill + tool set", () => {
  it("extends the system pack with approval-gated propose", () => {
    seed();
    expect(toolsForSkill("system").some((t) => t.name === "risk_describe")).toBe(true);
    expect(toolsForSkill("system").some((t) => t.name === "risk_propose_adr")).toBe(true);
    expect(tool("risk_describe").needsApproval).toBe(false);
    expect(tool("risk_propose_adr").needsApproval).toBe(true);
    // Sanity: decisions pack untouched.
    expect(DECISION_TOOLS).toHaveLength(4);
  });

  it("describes findings and proposes linked ADRs", async () => {
    seed();
    const d = await run("risk_describe");
    expect(d.ok).toBe(true);
    const rules = (d.result as { findings: { rule: string }[] }).findings.map((f) => f.rule);
    expect(rules).toContain("no-timeout");

    const p = await run("risk_propose_adr", { title: "Bound the hub hop with timeouts", context: "no-timeout on POST /orders" });
    expect(p.ok).toBe(true);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].number).toBe("ADR-001");
    expect(decisions[0].links).toEqual([{ surface: "system", recordId: "p1", label: "Ordering topology" }]);
    expect(decisions[0].history.some((h) => h.what.includes("risk lens"))).toBe(true);
  });

  it("reports honestly with no canvas open", async () => {
    registerSystemBridge(null);
    setRisksBackend({ sequences: async () => [], decisions: async () => [], saveDecision: async () => {} });
    expect((await run("risk_describe")).ok).toBe(false);
    expect((await run("risk_propose_adr", { title: "X" })).ok).toBe(false);
  });
});
