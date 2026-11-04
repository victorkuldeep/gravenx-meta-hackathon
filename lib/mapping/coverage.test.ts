import { describe, expect, it } from "vitest";
import { candidateSources, requiredTargets, unmappedSourceCount } from "./coverage";
import { extractPaths } from "./source";
import { blankProject } from "./types";
import type { MappingProject, SnapshotField } from "./types";

function field(name: string, type: string, opts?: Partial<SnapshotField>): SnapshotField {
  return {
    name,
    label: name,
    type,
    length: 255,
    precision: 0,
    scale: 0,
    nillable: false,
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
    ...opts,
  };
}

function projectWith(
  source: unknown,
  objects: { name: string; fields: SnapshotField[] }[],
  plans: { id: string; objectName: string }[] = []
): MappingProject {
  const p = blankProject({ id: "m1", name: "t", now: new Date().toISOString() });
  p.source = { kind: "json-sample", name: "s.json", originalText: "{}", paths: extractPaths(source), capturedAt: p.createdAt };
  p.sfSnapshot = {
    id: "snap-1",
    fingerprint: "f",
    capturedAt: p.createdAt,
    objects: objects.map((o) => ({ name: o.name, label: o.name, custom: false, fields: o.fields })),
  };
  p.recordPlans = plans.map((pl) => ({
    id: pl.id,
    name: pl.objectName,
    objectName: pl.objectName,
    intent: "create" as const,
    sourcePath: "",
    cardinality: "one" as const,
    parentPlanId: null,
  }));
  return p;
}

describe("requiredTargets", () => {
  it("lists required unmapped fields with their plan", () => {
    const f = field("Name", "string");
    const p = projectWith({ x: 1 }, [{ name: "Account", fields: [f] }], [{ id: "pl1", objectName: "Account" }]);
    const items = requiredTargets(p);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ objectName: "Account", planId: "pl1" });
    expect(items[0].field.name).toBe("Name");
  });

  it("skips nillable, defaulted, non-createable, and already-mapped fields", () => {
    const p = projectWith(
      { a: "x" },
      [
        {
          name: "O",
          fields: [
            field("Req", "string"),
            field("Opt", "string", { nillable: true }),
            field("Def", "string", { defaultedOnCreate: true }),
            field("NoCreate", "string", { createable: false }),
          ],
        },
      ]
    );
    p.mappings = [
      { id: "r1", sourcePath: "$.a", planId: null, objectName: "O", fieldName: "Req", kind: "direct", status: "mapped", updatedAt: p.createdAt },
    ];
    expect(requiredTargets(p)).toEqual([]);
  });
});

describe("candidateSources", () => {
  it("ranks exact above close and shows sample values", () => {
    const f = field("Email", "email");
    const p = projectWith({ email: "a@b.c", contactEmail: "d@e.f" }, [{ name: "C", fields: [f] }]);
    const cands = candidateSources(p, f);
    expect(cands.map((c) => c.path.id)).toEqual(["$.email", "$.contactEmail"]);
    expect(cands[0].confidence).toBe("exact");
    expect(cands[1].confidence).toBe("close");
  });

  it("excludes type-incompatible and already-mapped paths", () => {
    const f = field("Active", "boolean");
    const p = projectWith({ active: 1, other: 1 }, [{ name: "C", fields: [f] }]);
    // Number vs checkbox is incompatible -> excluded; "other" has no name overlap.
    expect(candidateSources(p, f)).toEqual([]);
    expect(unmappedSourceCount(p)).toBe(2);
  });
});
