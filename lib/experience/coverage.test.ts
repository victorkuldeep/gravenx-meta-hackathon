import { describe, expect, it } from "vitest";
import { blankProject } from "../mapping/types";
import { analyzeCoverage } from "./coverage";
import { blankApiCatalog, blankExperienceModule } from "./types";

describe("analyzeCoverage", () => {
  it("finds gaps deterministically", () => {
    const p = blankProject({ id: "p1", name: "T", now: "2026-01-01" });
    const exp = blankExperienceModule("e", "2026-01-01");
    exp.screens = [
      { id: "s1", name: "List", journeyIds: [], canvas: { sourceWidth: 0, sourceHeight: 0, aspectRatio: 0 }, componentIds: [], actionIds: [], bindingIds: [], status: "draft", tags: [], createdAt: "t", updatedAt: "t" },
    ];
    exp.components = [
      { id: "c1", screenId: "s1", name: "Table", componentType: "table", requirementIds: [], bindingIds: [], actionIds: [], stateIds: [], status: "draft", tags: [], createdAt: "t", updatedAt: "t" },
    ];
    p.experience = exp;
    const cat = blankApiCatalog("a", "2026-01-01");
    cat.operations = [
      { id: "o1", operationKey: "GET /x", name: "X", method: "GET", path: "/x", layer: "bff", errorContractIds: [], dependencyIds: [], lifecycle: "proposed", status: "proposed", tags: [], createdAt: "t", updatedAt: "t" },
    ];
    p.apiCatalog = cat;
    const { counts, findings } = analyzeCoverage(p);
    expect(counts.screens).toBe(1);
    expect(counts.orphanOperations).toBe(1);
    const types = findings.map((f) => f.type);
    expect(types).toContain("screen-no-image");
    expect(types).toContain("component-no-binding");
    expect(types).toContain("operation-unused");
    expect(types).toContain("operation-no-owner");
    // Deterministic: same input, same keys in same order.
    expect(analyzeCoverage(p).findings.map((f) => f.key)).toEqual(findings.map((f) => f.key));
  });

  it("treats a linked wireframe as a design source", () => {
    const p = blankProject({ id: "p1", name: "T", now: "2026-01-01" });
    const exp = blankExperienceModule("e", "2026-01-01");
    exp.screens = [
      { id: "s1", name: "Capture", journeyIds: [], canvas: { sourceWidth: 0, sourceHeight: 0, aspectRatio: 0 }, componentIds: [], actionIds: [], bindingIds: [], status: "draft", tags: [], createdAt: "t", updatedAt: "t", wireframeRef: { experienceId: "exp1", screenId: "w1" } },
    ];
    p.experience = exp;
    const types = analyzeCoverage(p).findings.map((f) => f.type);
    expect(types).not.toContain("screen-no-image");
    expect(types).not.toContain("screen-no-components");
  });
});
