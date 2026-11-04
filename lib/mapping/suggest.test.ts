import { describe, expect, it } from "vitest";
import { extractPaths } from "./source";
import { suggestMappings } from "./suggest";
import { blankProject } from "./types";
import type { MappingProject, SnapshotField } from "./types";

function field(name: string, type: string, label?: string): SnapshotField {
  return {
    name,
    label: label ?? name,
    type,
    length: 255,
    precision: 0,
    scale: 0,
    nillable: true,
    createable: true,
    updateable: true,
    calculated: false,
    defaultedOnCreate: false,
    unique: false,
    externalId: false,
    referenceTo: [],
    relationshipName: null,
    restrictedPicklist: false,
    defaultValue: null,
    picklistValues: [],
  };
}

function projectWith(source: unknown, objects: { name: string; fields: SnapshotField[] }[]): MappingProject {
  const p = blankProject({ id: "m1", name: "t", now: new Date().toISOString() });
  p.source = { kind: "json-sample", name: "s.json", originalText: "{}", paths: extractPaths(source), capturedAt: p.createdAt };
  p.sfSnapshot = {
    id: "snap-1",
    fingerprint: "f",
    capturedAt: p.createdAt,
    objects: objects.map((o) => ({ name: o.name, label: o.name, custom: false, fields: o.fields })),
  };
  return p;
}

describe("suggestMappings", () => {
  it("matches exact names across separator styles and __c suffixes", () => {
    const p = projectWith(
      { orderNumber: "A1", email_address: "a@b.c" },
      [{ name: "Order__c", fields: [field("Order_Number__c", "string"), field("Email__c", "email")] }]
    );
    const s = suggestMappings(p);
    expect(s.find((x) => x.sourcePath === "$.orderNumber")).toMatchObject({
      objectName: "Order__c",
      fieldName: "Order_Number__c",
      confidence: "exact",
    });
    expect(s.find((x) => x.sourcePath === "$.email_address")?.fieldName).toBe("Email__c");
  });

  it("offers close token-overlap matches", () => {
    const p = projectWith({ phone: "1" }, [{ name: "Contact", fields: [field("PhoneNumber", "phone")] }]);
    const s = suggestMappings(p);
    expect(s).toHaveLength(1);
    expect(s[0].confidence).toBe("close");
  });

  it("rejects type-incompatible candidates", () => {
    const p = projectWith({ qty: 2 }, [{ name: "O", fields: [field("Qty", "boolean")] }]);
    expect(suggestMappings(p)).toEqual([]);
  });

  it("skips already-mapped paths and non-scalars", () => {
    const p = projectWith({ a: "x", b: { c: 1 } }, [{ name: "O", fields: [field("A", "string")] }]);
    p.mappings = [
      {
        id: "r1",
        sourcePath: "$.a",
        planId: null,
        objectName: "O",
        fieldName: "A",
        kind: "direct",
        status: "mapped",
        updatedAt: p.createdAt,
      },
    ];
    expect(suggestMappings(p)).toEqual([]);
  });

  it("returns nothing without a metadata snapshot", () => {
    const p = blankProject({ id: "m1", name: "t", now: new Date().toISOString() });
    p.source = { kind: "json-sample", name: "s.json", originalText: "{}", paths: extractPaths({ a: 1 }), capturedAt: p.createdAt };
    expect(suggestMappings(p)).toEqual([]);
  });

  it("scopes to the active plan object when set", () => {
    const p = projectWith(
      { name: "Acme" },
      [
        { name: "Account", fields: [field("Name", "string")] },
        { name: "Contact", fields: [field("Name", "string")] },
      ]
    );
    const s = suggestMappings(p, { planObject: "Contact" });
    expect(s).toHaveLength(1);
    expect(s[0].objectName).toBe("Contact");
  });
});
