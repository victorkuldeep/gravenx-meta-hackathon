import { describe, it, expect } from "vitest";
import { canTransition, setDecisionStatus, approvedDecisions } from "./decision-model";
import { suggestForProject, mergeSuggestions } from "./assistant";
import { evaluateRules, detectOwnershipConflicts, collectMappings } from "./rules-model";
import { compileArchitectProject } from "./openapi-compiler";
import { seedAcquisitionProject, seedEnrichmentProject } from "./seeds";

describe("decision-model", () => {
  it("enforces explicit transitions", () => {
    expect(canTransition("proposed", "accepted")).toBe(true);
    expect(canTransition("proposed", "proposed")).toBe(false);
    expect(canTransition("accepted", "rejected")).toBe(false);
    const p = seedAcquisitionProject();
    p.decisions.push({
      id: "d1", topic: "T", question: "Q?", options: ["Y", "N"], chosen: "",
      rationale: "why", owner: "", status: "proposed", suggested: true,
      relatedOps: [], createdAt: 0, revision: 1,
    });
    expect(approvedDecisions(p)).toHaveLength(0);
    const { project, ok } = setDecisionStatus(p, "d1", "accepted");
    expect(ok).toBe(true);
    expect(approvedDecisions(project)).toHaveLength(1);
    expect(setDecisionStatus(project, "d1", "rejected").ok).toBe(false);
  });
});

describe("assistant", () => {
  it("proposes for gaps with stable ids (no duplicates on re-run)", () => {
    const p = seedAcquisitionProject();
    const s1 = suggestForProject(p, new Map([["Lead", 18]]));
    expect(s1.length).toBeGreaterThan(0);
    expect(s1.every((s) => s.status === "proposed" && s.suggested)).toBe(true);
    const { project, added } = mergeSuggestions(p, s1);
    expect(added).toBe(s1.length);
    expect(mergeSuggestions(project, suggestForProject(project, new Map([["Lead", 18]]))).added).toBe(0);
  });
  it("proposed suggestions never change the compiled document", () => {
    const p = seedAcquisitionProject();
    const before = compileArchitectProject(p, 1).hash;
    const { project } = mergeSuggestions(p, suggestForProject(p, new Map()));
    expect(compileArchitectProject(project, 1).hash).toBe(before);
  });
  it("flags overexposure only when coverage is wide", () => {
    const p = seedAcquisitionProject();
    const narrow = suggestForProject(p, new Map([["Lead", 500]]));
    expect(narrow.some((s) => s.topic === "Overexposure")).toBe(false);
    const wide = suggestForProject(p, new Map([["Lead", 6]]));
    expect(wide.some((s) => s.topic === "Overexposure")).toBe(true);
  });
});

describe("rules-model", () => {
  it("evaluates conditional-required rules", () => {
    const rules = [
      { id: "r1", description: "d", kind: "conditional-required" as const, whenField: "leadSource", whenEquals: "Campaign", requireFields: ["campaignId"] },
    ];
    expect(evaluateRules(rules, { leadSource: "Campaign" })).toHaveLength(1);
    expect(evaluateRules(rules, { leadSource: "Web", campaignId: "x" })).toHaveLength(0);
    expect(evaluateRules(rules, { leadSource: "Campaign", campaignId: "c1" })).toHaveLength(0);
  });
  it("flags conflicting writers, ignores shared", () => {
    const conflicts = detectOwnershipConflicts([
      { targetObject: "Lead", targetField: "Industry", ownership: "consumer" },
      { targetObject: "Lead", targetField: "Industry", ownership: "salesforce" },
      { targetObject: "Lead", targetField: "Status", ownership: "consumer" },
      { targetObject: "Lead", targetField: "Status", ownership: "shared" },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].targetField).toBe("Industry");
  });
  it("collects mappings across schemas", () => {
    const found = collectMappings(seedEnrichmentProject());
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((m) => m.targetObject === "Lead")).toBe(true);
    expect(collectMappings(seedAcquisitionProject()).length).toBeGreaterThan(0);
  });
});
