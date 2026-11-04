import { describe, expect, it } from "vitest";
import { blankProject } from "./types";
import { compareProjects, mergeNonConflicting, serializeProject, validateImport, type ExportKind } from "./exchange";

function proj() {
  const p = blankProject({ id: "p1", name: "Demo", now: "2026-01-01T00:00:00.000Z" });
  p.mappings = [
    { id: "m1", sourcePath: "$.a", planId: null, objectName: "Order", fieldName: "OrderNumber", kind: "direct", status: "mapped", updatedAt: "2026-01-01" },
  ];
  p.decisions = [
    { id: "d1", title: "Q?", description: "", sourcePaths: [], status: "open", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  ];
  return p;
}

describe("exchange round trip", () => {
  for (const kind of ["full", "handoff", "mapping-only"] as ExportKind[]) {
    it(`exports + imports ${kind} losslessly`, () => {
      const text = serializeProject(proj(), kind, "2026-02-01T00:00:00.000Z");
      const v = validateImport(text);
      expect(v.ok).toBe(true);
      expect(v.project?.id).toBe("p1");
      expect(v.project?.mappings).toHaveLength(1);
      expect(v.preview?.mappings).toBe(1);
    });
  }
  it("mapping-only strips sample values but keeps paths", () => {
    const p = proj();
    p.source = { kind: "json-sample", name: "s", originalText: '{"a":1}', paths: [{ id: "$.a", path: "$.a", parent: "$", key: "a", kind: "scalar", jsonType: "integer", example: 1, depth: 1, inArray: false, required: "unknown" }], capturedAt: "2026-01-01" };
    const v = validateImport(serializeProject(p, "mapping-only", "2026-02-01"));
    expect(v.ok).toBe(true);
    expect(v.project?.source?.originalText).toBe("");
    expect(v.project?.source?.paths[0].id).toBe("$.a");
    expect(v.project?.source?.paths[0].example).toBeUndefined();
  });
  it("rejects garbage, wrong format and newer versions", () => {
    expect(validateImport("nope").ok).toBe(false);
    expect(validateImport('{"format":"other","formatVersion":1}').ok).toBe(false);
    expect(validateImport('{"format":"gravenx-mapping-project","formatVersion":99,"project":{}}').ok).toBe(false);
  });
  it("rejects broken references and duplicate ids", () => {
    const p = proj();
    p.mappings.push({ id: "m1", sourcePath: "$.b", planId: "nope", objectName: "Order", fieldName: "X", kind: "direct", status: "mapped", updatedAt: "t" });
    const v = validateImport(serializeProject(p, "full", "t"));
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/Duplicate mapping id|unknown plan/);
  });
});

describe("compare + merge", () => {
  it("classifies added vs conflicting changes", () => {
    const local = proj();
    const incoming = proj();
    incoming.mappings.push({ id: "m2", sourcePath: "$.b", planId: null, objectName: "Order", fieldName: "Status", kind: "direct", status: "mapped", updatedAt: "t" });
    incoming.mappings[0] = { ...incoming.mappings[0], fieldName: "OrderNumber2" };
    const cmp = compareProjects(local, incoming);
    expect(cmp.some((c) => c.key === "map:m2" && !c.conflict)).toBe(true);
    expect(cmp.some((c) => c.key === "map:m1" && c.conflict)).toBe(true);
  });
  it("merges additions, keeps local on conflict", () => {
    const local = proj();
    const incoming = proj();
    incoming.mappings.push({ id: "m2", sourcePath: "$.b", planId: null, objectName: "Order", fieldName: "Status", kind: "direct", status: "mapped", updatedAt: "t" });
    incoming.mappings[0] = { ...incoming.mappings[0], fieldName: "Changed" };
    const { merged, applied, conflicts } = mergeNonConflicting(local, incoming);
    expect(applied).toBe(1);
    expect(conflicts).toBe(1);
    expect(merged.mappings.some((m) => m.id === "m2")).toBe(true);
    expect(merged.mappings.find((m) => m.id === "m1")?.fieldName).toBe("OrderNumber");
  });
});
