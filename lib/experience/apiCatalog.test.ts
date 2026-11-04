import { describe, expect, it } from "vitest";
import { blankApiCatalog, blankExperienceModule } from "./types";
import { findDuplicateOperations, normalizeOperationKey, operationUsage, orphanOperations, validateBindings } from "./apiCatalog";

describe("api catalog", () => {
  it("normalizes method + path for duplicate detection", () => {
    expect(normalizeOperationKey("get", "/orders/")).toBe("GET /orders");
    const ops = [
      { id: "o1", operationKey: "GET /orders", name: "List", method: "GET", path: "/orders", layer: "bff", errorContractIds: [], dependencyIds: [], lifecycle: "existing", status: "confirmed", tags: [], createdAt: "t", updatedAt: "t" },
    ];
    expect(findDuplicateOperations(ops as never, "get", "/orders/")).toHaveLength(1);
    expect(findDuplicateOperations(ops as never, "get", "/orders/", "o1")).toHaveLength(0);
    expect(findDuplicateOperations(ops as never, "post", "/orders")).toHaveLength(0);
  });

  it("counts usage and finds orphans", () => {
    const exp = blankExperienceModule("e", "t");
    exp.bindings = [
      { id: "b1", screenId: "s1", componentId: "c1", operationId: "o1", usage: "read", trigger: "screen-load", requestRequirementIds: [], responseRequirementIds: [], stateIds: [], status: "proposed", createdAt: "t", updatedAt: "t" },
      { id: "b2", screenId: "s2", operationId: "o1", usage: "read", trigger: "screen-load", requestRequirementIds: [], responseRequirementIds: [], stateIds: [], status: "proposed", createdAt: "t", updatedAt: "t" },
    ];
    expect(operationUsage(exp.bindings, "o1")).toMatchObject({ screens: 2, components: 1, actions: 0 });
    const cat = blankApiCatalog("a", "t");
    cat.operations = [
      { id: "o1", operationKey: "GET /x", name: "X", method: "GET", path: "/x", layer: "bff", errorContractIds: [], dependencyIds: [], lifecycle: "existing", status: "confirmed", tags: [], createdAt: "t", updatedAt: "t" },
      { id: "o2", operationKey: "GET /y", name: "Y", method: "GET", path: "/y", layer: "bff", errorContractIds: [], dependencyIds: [], lifecycle: "proposed", status: "draft", tags: [], createdAt: "t", updatedAt: "t" },
    ];
    expect(orphanOperations(cat.operations, exp.bindings).map((o) => o.id)).toEqual(["o2"]);
  });

  it("flags bindings with missing references", () => {
    const exp = blankExperienceModule("e", "t");
    exp.bindings = [
      { id: "b1", screenId: "missing-screen", operationId: "missing-op", usage: "read", trigger: "screen-load", requestRequirementIds: [], responseRequirementIds: [], stateIds: [], status: "proposed", createdAt: "t", updatedAt: "t" },
    ];
    expect(validateBindings(exp, [])).toHaveLength(2);
  });
});
