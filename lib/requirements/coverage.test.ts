import { describe, expect, it } from "vitest";
import { buildIndex } from "@/lib/graph/index";
import { coverageOf, coverageSummary } from "./coverage";
import { exportRequirements, importRequirements } from "./store";
import { linkRequirement, newRequirement } from "./model";
import type { SystemProject } from "@/lib/system-design/model";

const project = {
  id: "p1",
  name: "Ordering topology",
  systems: [{ id: "s1", name: "Salesforce" }],
  interfaces: [],
  operations: [],
  connections: [],
} as unknown as SystemProject;

describe("requirements coverage", () => {
  it("derives covered from live links, never from status", () => {
    const live = linkRequirement(newRequirement("A", "REQ-001", 1), {
      surface: "system",
      recordId: "p1",
      label: "Ordering topology",
    });
    const stale = linkRequirement(newRequirement("B", "REQ-002", 2), {
      surface: "system",
      recordId: "p-gone",
      label: "Ghost",
    });
    const bare = newRequirement("C", "REQ-003", 3);
    const g = buildIndex({ systems: [project], requirements: [live, stale, bare] });
    expect(coverageOf(g, live)).toMatchObject({ covered: true, liveLinks: 1, danglingLinks: 0 });
    expect(coverageOf(g, stale)).toMatchObject({ covered: false, liveLinks: 0, danglingLinks: 1 });
    expect(coverageOf(g, bare).covered).toBe(false);
    const s = coverageSummary(g, [live, stale, bare]);
    expect(s).toMatchObject({ covered: 1, total: 3 });
    expect(s.uncovered.map((u) => u.number)).toEqual(["REQ-002", "REQ-003"]);
  });
});

describe("requirements packages", () => {
  it("round-trips and never overwrites on import", () => {
    const pkg = exportRequirements([newRequirement("A", "REQ-102", 1000)]);
    expect(pkg).toContain("gravenx-requirements-package");
    const { requirements, error } = importRequirements(pkg, [{ number: "REQ-102" }], 2000);
    expect(error).toBeUndefined();
    expect(requirements).toHaveLength(1);
    expect(requirements[0].number).toBe("REQ-103");
    expect(importRequirements("nope").error).toBe("Not valid JSON.");
    expect(importRequirements("{}").error).toBe("No requirements array in this package.");
  });
});
