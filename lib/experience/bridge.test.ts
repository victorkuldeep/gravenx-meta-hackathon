import { describe, expect, it } from "vitest";
import { blankProject } from "../mapping/types";
import { checkDependencies, componentLineage } from "./bridge";
import { blankApiCatalog, blankExperienceModule } from "./types";

function setup() {
  const p = blankProject({ id: "p1", name: "T", now: "2026-01-01" });
  p.experience = blankExperienceModule("e", "2026-01-01");
  p.apiCatalog = blankApiCatalog("a", "2026-01-01");
  p.apiCatalog.operations = [
    { id: "op1", operationKey: "GET /x", name: "X", method: "GET", path: "/x", layer: "bff", errorContractIds: [], dependencyIds: [], lifecycle: "existing", status: "confirmed", tags: [], createdAt: "t", updatedAt: "t" },
  ];
  return p;
}

describe("checkDependencies", () => {
  it("passes clean references", () => {
    const p = setup();
    p.sfSnapshot = { id: "s", capturedAt: "t", fingerprint: "f", objects: [{ name: "Order", label: "Order", custom: false, fields: [] }] };
    p.apiCatalog!.dependencies = [
      { id: "d1", operationId: "op1", kind: "salesforce-object", reference: { objectApiName: "Order", label: "Order" }, label: "Order", status: "confirmed" },
    ];
    expect(checkDependencies(p)).toEqual([]);
  });
  it("flags missing snapshot objects, fields, artifacts and ops", () => {
    const p = setup();
    p.apiCatalog!.dependencies = [
      { id: "d1", operationId: "op1", kind: "salesforce-object", reference: { objectApiName: "Gone" }, label: "Gone", status: "open" },
      { id: "d2", operationId: "op1", kind: "integration-mapping", reference: { artifactId: "row-x" }, label: "row", status: "open" },
      { id: "d3", operationId: "missing-op", kind: "external-service", label: "ext", status: "open" },
    ];
    const problems = checkDependencies(p);
    expect(problems).toHaveLength(3);
    expect(problems.map((x) => x.dependencyId).sort()).toEqual(["d1", "d2", "d3"]);
  });
});

describe("componentLineage", () => {
  it("traces requirement -> binding -> operation -> dependencies", () => {
    const p = setup();
    p.experience!.requirements = [
      { id: "r1", screenId: "s", componentId: "c", name: "Total", direction: "response", propertyPath: "total", required: true, source: "design", status: "proposed" },
    ];
    p.experience!.bindings = [
      { id: "b1", screenId: "s", componentId: "c", operationId: "op1", usage: "read", trigger: "screen-load", requestRequirementIds: [], responseRequirementIds: ["r1"], stateIds: [], status: "proposed", createdAt: "t", updatedAt: "t" },
    ];
    p.apiCatalog!.dependencies = [
      { id: "d1", operationId: "op1", kind: "salesforce-object", reference: { objectApiName: "Order" }, label: "Order", status: "proposed" },
    ];
    const lineage = componentLineage(p, "c");
    expect(lineage).toHaveLength(1);
    expect(lineage[0].operationKey).toBe("GET /x");
    expect(lineage[0].dependencies[0].broken).toBe(true); // Order not in snapshot
  });
});
