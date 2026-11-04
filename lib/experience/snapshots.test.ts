import { describe, expect, it } from "vitest";
import { blankProject } from "../mapping/types";
import { compareSnapshots, integrationImpact, operationImpact, takeSnapshot } from "./snapshots";
import { blankApiCatalog, blankExperienceModule } from "./types";

function project() {
  const p = blankProject({ id: "p1", name: "T", now: "2026-01-01" });
  const exp = blankExperienceModule("e", "2026-01-01");
  exp.screens = [
    { id: "s1", name: "List", journeyIds: [], canvas: { sourceWidth: 0, sourceHeight: 0, aspectRatio: 0 }, componentIds: [], actionIds: [], bindingIds: [], status: "draft", tags: [], createdAt: "t", updatedAt: "t" },
  ];
  exp.components = [
    { id: "c1", screenId: "s1", name: "Table", componentType: "table", requirementIds: [], bindingIds: [], actionIds: [], stateIds: [], status: "draft", tags: [], createdAt: "t", updatedAt: "t" },
  ];
  exp.bindings = [
    { id: "b1", screenId: "s1", componentId: "c1", operationId: "op1", usage: "read", trigger: "screen-load", requestRequirementIds: [], responseRequirementIds: [], stateIds: [], status: "proposed", createdAt: "t", updatedAt: "t" },
  ];
  p.experience = exp;
  const cat = blankApiCatalog("a", "2026-01-01");
  cat.operations = [
    { id: "op1", operationKey: "GET /x", name: "X", method: "GET", path: "/x", layer: "bff", errorContractIds: [], dependencyIds: [], lifecycle: "existing", status: "confirmed", tags: [], createdAt: "t", updatedAt: "t" },
  ];
  p.apiCatalog = cat;
  return p;
}

describe("snapshots", () => {
  it("compares by stable id: added, removed, changed", () => {
    const p = project();
    const a = takeSnapshot(p, "v1", "Baseline", "2026-01-01");
    p.experience!.screens.push({ id: "s2", name: "Detail", journeyIds: [], canvas: { sourceWidth: 0, sourceHeight: 0, aspectRatio: 0 }, componentIds: [], actionIds: [], bindingIds: [], status: "draft", tags: [], createdAt: "t", updatedAt: "t" });
    p.experience!.components = p.experience!.components.filter((c) => c.id !== "c1");
    p.apiCatalog!.operations[0] = { ...p.apiCatalog!.operations[0], owner: "BFF team" };
    const b = takeSnapshot(p, "v2", "Review", "2026-02-01");
    const changes = compareSnapshots(a, b);
    expect(changes.some((c) => c.key === "screen:added:s2")).toBe(true);
    expect(changes.some((c) => c.key === "component:removed:c1")).toBe(true);
    expect(changes.some((c) => c.key === "operation:changed:op1")).toBe(true);
  });

  it("traces operation impact to screens and components", () => {
    const impact = operationImpact(project(), "op1");
    expect(impact.map((n) => n.kind).sort()).toEqual(["component", "screen"]);
  });

  it("traces integration artifacts to operations and screens", () => {
    const p = project();
    p.mappings = [
      { id: "row1", sourcePath: "$.a", planId: null, objectName: "Order", fieldName: "Status", kind: "direct", status: "mapped", updatedAt: "t" },
    ];
    p.apiCatalog!.dependencies = [
      { id: "d1", operationId: "op1", kind: "integration-mapping", reference: { artifactId: "row1" }, label: "row", status: "confirmed" },
    ];
    const impact = integrationImpact(p, "row1");
    expect(impact.some((n) => n.kind === "operation" && n.id === "op1")).toBe(true);
    expect(impact.some((n) => n.kind === "screen" && n.id === "s1")).toBe(true);
    expect(impact.some((n) => n.kind === "mapping" && n.id === "row1")).toBe(true);
  });
});
