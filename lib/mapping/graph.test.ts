import { describe, expect, it } from "vitest";
import { buildMappingGraph, GRAPH_EDGE_COLOR, statusLabel } from "./graph";
import { blankProject, type MappingProject, type MappingRow } from "./types";

const NOW = "2026-10-12T00:00:00.000Z";

function row(partial: Partial<MappingRow> & { id: string }): MappingRow {
  return {
    sourcePath: "$.order.id",
    planId: null,
    objectName: "",
    fieldName: "",
    kind: "direct",
    status: "mapped",
    updatedAt: NOW,
    ...partial,
  };
}

function project(): MappingProject {
  const p = blankProject({ id: "p1", name: "Demo", now: NOW });
  p.source = {
    kind: "json-sample",
    name: "order.json",
    originalText: "{}",
    capturedAt: NOW,
    paths: [
      { id: "$.order.id", path: "$.order.id", parent: null, key: "id", kind: "scalar", jsonType: "string", depth: 1, inArray: false, required: "unknown" },
      { id: "$.order.total", path: "$.order.total", parent: null, key: "total", kind: "scalar", jsonType: "number", depth: 1, inArray: false, required: "unknown" },
      { id: "$.order.note", path: "$.order.note", parent: null, key: "note", kind: "scalar", jsonType: "string", depth: 1, inArray: false, required: "unknown" },
    ],
  };
  p.sfSnapshot = {
    id: "s1",
    capturedAt: NOW,
    fingerprint: "f",
    objects: [
      {
        name: "Account",
        label: "Account",
        custom: false,
        fields: [
          { name: "OrderId__c", label: "Order Id", type: "string", length: 80, precision: 0, scale: 0, nillable: true, createable: true, updateable: true, calculated: false, defaultedOnCreate: false, unique: false, externalId: false, referenceTo: [], relationshipName: null, restrictedPicklist: false, defaultValue: null, picklistValues: [] },
        ],
      },
    ],
  };
  p.recordPlans = [{ id: "plan1", name: "Create Account", objectName: "Account", intent: "create", sourcePath: "", cardinality: "one", parentPlanId: null }];
  p.mappings = [
    row({ id: "m1", sourcePath: "$.order.id", planId: "plan1", objectName: "Account", fieldName: "OrderId__c", status: "mapped" }),
    row({ id: "k1", sourcePath: "(constant)", objectName: "", fieldName: "", kind: "hardcoded", status: "hardcoded", hardcodedValue: "ProductOrder", notes: "ORDER TYPE" }),
    row({ id: "m2", sourcePath: "$.order.total", planId: "plan1", objectName: "Account", fieldName: "OrderId__c", kind: "hardcoded", status: "hardcoded", hardcodedValue: "ProductOrder" }),
    row({ id: "m3", sourcePath: "$.order.note", planId: "plan1", objectName: "Account", fieldName: "OrderId__c", kind: "excluded", status: "excluded" }),
  ];
  return p;
}

describe("buildMappingGraph", () => {
  it("groups one box per object with labels from the snapshot", () => {
    const g = buildMappingGraph(project());
    expect(g.hasSource).toBe(true);
    expect(g.sourceName).toBe("order.json");
    expect(g.leafCount).toBe(3);
    expect(g.objects).toHaveLength(1);
    expect(g.objects[0]).toMatchObject({ objectName: "Account", label: "Account", blind: false });
    expect(g.objects[0].fields).toHaveLength(1);
    expect(g.objects[0].fields[0]).toMatchObject({ apiName: "OrderId__c", label: "Order Id" });
    expect(g.objects[0].plans).toEqual([{ id: "plan1", name: "Create Account", intent: "create" }]);
  });

  it("counts unmapped leaves and skips excluded rows", () => {
    const g = buildMappingGraph(project());
    // $.order.id covered, $.order.total covered (via constant), $.order.note excluded = uncovered
    expect(g.unmappedCount).toBe(1);
    expect(g.edges.find((e) => e.id === "m3")).toBeUndefined();
  });

  it("routes constant copies from the constants box", () => {
    const g = buildMappingGraph(project());
    expect(g.constants).toEqual([{ id: "k1", label: "ORDER TYPE", value: "ProductOrder" }]);
    const edge = g.edges.find((e) => e.id === "m2");
    expect(edge).toMatchObject({ kind: "constant", constantId: "k1", objectName: "Account" });
    expect(g.edges.find((e) => e.id === "m1")).toMatchObject({ kind: "field", sourceLeaf: "$.order.id" });
  });

  it("falls back to API names without a snapshot", () => {
    const p = project();
    p.sfSnapshot = null;
    const g = buildMappingGraph(p);
    expect(g.objects[0].blind).toBe(true);
    expect(g.objects[0].pending).toBe(true);
    expect(g.objects[0].fields[0].label).toBe("OrderId__c");
    expect(g.objects[0].fields[0].pending).toBe(false);
  });

  it("flags author-mode targets missing from the snapshot", () => {
    const p = project();
    p.mappings = [
      ...p.mappings,
      row({ id: "m4", sourcePath: "$.order.total", planId: "plan1", objectName: "Account", fieldName: "Future__c", status: "mapped" }),
      row({ id: "m5", sourcePath: "$.order.note", planId: null, objectName: "Sketch__c", fieldName: "NewField__c", status: "mapped" }),
    ];
    const g = buildMappingGraph(p);
    const account = g.objects.find((o) => o.objectName === "Account")!;
    expect(account.pending).toBe(false);
    expect(account.fields.find((f) => f.apiName === "Future__c")).toMatchObject({ label: "Future__c", pending: true });
    const sketch = g.objects.find((o) => o.objectName === "Sketch__c")!;
    expect(sketch).toMatchObject({ pending: true, blind: true, label: "Sketch__c" });
  });

  it("colors every status and labels them", () => {
    for (const s of ["mapped", "hardcoded", "unmapped", "needs-transformation", "incompatible"] as const) {
      expect(GRAPH_EDGE_COLOR[s]).toMatch(/^#/);
      expect(statusLabel(s).length).toBeGreaterThan(0);
    }
  });
});
