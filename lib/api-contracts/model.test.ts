import { describe, it, expect } from "vitest";
import { validateApiProject } from "./project-schema";
import { validateOperations, extractPathParams } from "./operation-model";
import { seedAcquisitionProject, seedEnrichmentProject } from "./seeds";

describe("project-schema", () => {
  it("accepts both seed projects", () => {
    expect(validateApiProject(seedAcquisitionProject()).ok).toBe(true);
    expect(validateApiProject(seedEnrichmentProject()).ok).toBe(true);
  });
  it("rejects missing name, bad operationId, relative route", () => {
    const bad = { ...seedAcquisitionProject(), name: "" };
    expect(validateApiProject(bad).ok).toBe(false);
    const bad2 = seedAcquisitionProject();
    bad2.operations[0].operationId = "has space";
    expect(validateApiProject(bad2).ok).toBe(false);
    const bad3 = seedAcquisitionProject();
    bad3.operations[0].route = "leads";
    expect(validateApiProject(bad3).ok).toBe(false);
  });
  it("rejects duplicate ids within a project", () => {
    const p = seedAcquisitionProject();
    p.operations.push({ ...p.operations[0], id: "other-id" });
    const diags = validateOperations(p.operations);
    expect(diags.some((d) => d.code === "duplicate-operation-id")).toBe(true);
  });
});

describe("operation-model", () => {
  it("extracts path params", () => {
    expect(extractPathParams("/leads/{leadId}")).toEqual(["leadId"]);
    expect(extractPathParams("/leads")).toEqual([]);
  });
  it("flags duplicate routes, bad syntax, missing params, bad deps", () => {
    const ops = seedAcquisitionProject().operations;
    const dup = [...ops, { ...ops[0], id: "x" }];
    expect(validateOperations(dup).some((d) => d.code === "duplicate-route")).toBe(true);
    const bad = [{ ...ops[0], route: "/leads/{a}/{a}" }];
    expect(validateOperations(bad).some((d) => d.code === "duplicate-param")).toBe(true);
    const missing = [{ ...ops[0], route: "/leads/{leadId}", parameters: [] }];
    expect(validateOperations(missing).some((d) => d.code === "missing-param")).toBe(true);
    const selfDep = [{ ...ops[0], dependencies: [ops[0].id] }];
    expect(validateOperations(selfDep).some((d) => d.code === "self-dependency")).toBe(true);
  });
  it("warns on GET with body", () => {
    const ops = seedAcquisitionProject().operations;
    const get = [{ ...ops[1], requestSchema: "LeadCreateRequest" }];
    expect(validateOperations(get).some((d) => d.code === "get-with-body")).toBe(true);
  });
});

describe("project isolation", () => {
  it("seeds share metadata without sharing decisions", () => {
    const a = seedAcquisitionProject();
    const e = seedEnrichmentProject();
    expect(a.metadataRefs).toEqual(e.metadataRefs);
    a.decisions.push({
      id: "d1", topic: "T", question: "Q?", options: ["Y"], chosen: "Y",
      rationale: "", owner: "", status: "accepted", suggested: false, relatedOps: [], createdAt: 0, revision: 1,
    });
    expect(e.decisions).toHaveLength(0);
  });
});
