import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDefaultPolicy,
  clampCaps,
  clearPolicyCache,
  DEFAULT_CAPS,
  getPolicy,
  policyCaps,
  resetPolicy,
  resolveNeedsApproval,
  savePolicy,
  setPolicyDefaults,
  skillEnabled,
  toolEnabled,
  type PolicyInventorySkill,
} from "./policy";

const tool = (name: string, needsApproval: boolean): PolicyInventorySkill["tools"][number] => ({
  name,
  needsApproval,
  description: `${name} contract`,
  schema: { type: "object" },
});

const INVENTORY: PolicyInventorySkill[] = [
  { skill: "studio", tools: [tool("query_soql_run", false), tool("apex_run", true)] },
  { skill: "system", tools: [tool("system_add", true)] },
];

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  clearPolicyCache();
  setPolicyDefaults(buildDefaultPolicy(INVENTORY));
});

describe("agent policy defaults", () => {
  it("enables everything with code approval flags", () => {
    const p = getPolicy();
    expect(p.version).toBe(1);
    expect(p.globalReadOnly).toBe(false);
    expect(p.caps).toEqual(DEFAULT_CAPS);
    expect(p.skills.studio.tools["apex_run"]).toEqual({ enabled: true, approval: "default" });
    expect(skillEnabled("studio")).toBe(true);
    expect(toolEnabled("studio", "apex_run")).toBe(true);
    expect(toolEnabled("nope", "nothing")).toBe(true);
  });

  it("clamps caps into sane bounds", () => {
    expect(clampCaps({ maxRows: 5000 }).maxRows).toBe(100);
    expect(clampCaps({ maxRows: -3 }).maxRows).toBe(1);
    expect(clampCaps({ maxSteps: NaN }).maxSteps).toBe(DEFAULT_CAPS.maxSteps);
    expect(policyCaps().maxRows).toBe(DEFAULT_CAPS.maxRows);
  });
});

describe("policy persistence", () => {
  it("round-trips through localStorage and resets to defaults", () => {
    const next = getPolicy();
    next.skills.studio.tools["apex_run"] = { enabled: false, approval: "always" };
    next.globalReadOnly = true;
    savePolicy(next);
    clearPolicyCache();
    expect(toolEnabled("studio", "apex_run")).toBe(false);
    expect(getPolicy().globalReadOnly).toBe(true);
    resetPolicy();
    expect(toolEnabled("studio", "apex_run")).toBe(true);
    expect(getPolicy().globalReadOnly).toBe(false);
  });

  it("merges stored edits over fresh defaults, dropping unknown tools", () => {
    savePolicy({
      ...getPolicy(),
      skills: {
        studio: {
          enabled: false,
          tools: {
            apex_run: { enabled: false, approval: "never" },
            ghost_tool: { enabled: true, approval: "default" },
          },
        },
      } as never,
    });
    // New tool ships in code defaults afterwards.
    clearPolicyCache();
    setPolicyDefaults(
      buildDefaultPolicy([
        { skill: "studio", tools: [tool("apex_run", true), tool("shiny_new", false)] },
      ])
    );
    const p = getPolicy();
    expect(p.skills.studio.enabled).toBe(false);
    expect(p.skills.studio.tools["apex_run"]).toEqual({ enabled: false, approval: "never" });
    expect(p.skills.studio.tools["shiny_new"]).toEqual({ enabled: true, approval: "default" });
    expect("ghost_tool" in p.skills.studio.tools).toBe(false);
  });

  it("rejects foreign blobs back to defaults", () => {
    try {
      localStorage.setItem("gravenx-agent-policy", JSON.stringify({ version: 99, skills: {} }));
    } catch {
      /* ignore */
    }
    clearPolicyCache();
    expect(getPolicy().skills.studio.tools["apex_run"].enabled).toBe(true);
  });
});

describe("approval resolution", () => {
  const read = { name: "query_soql_run", needsApproval: false, orgTouch: true };
  const write = { name: "apex_run", needsApproval: true, orgTouch: true };
  const local = { name: "erd_snapshots", needsApproval: false };

  it("follows tool flags by default", () => {
    expect(resolveNeedsApproval("studio", read)).toBe(false);
    expect(resolveNeedsApproval("studio", write)).toBe(true);
  });

  it("honors per-tool overrides", () => {
    const p = getPolicy();
    p.skills.studio.tools["query_soql_run"] = { enabled: true, approval: "always" };
    p.skills.studio.tools["apex_run"] = { enabled: true, approval: "never" };
    savePolicy(p);
    expect(resolveNeedsApproval("studio", read)).toBe(true);
    expect(resolveNeedsApproval("studio", write)).toBe(false);
  });

  it("global read-only forces Apply on org tools only", () => {
    savePolicy({ ...getPolicy(), globalReadOnly: true });
    expect(resolveNeedsApproval("studio", read)).toBe(true);
    expect(resolveNeedsApproval("studio", write)).toBe(true);
    expect(resolveNeedsApproval("studio", local)).toBe(false);
  });
});
