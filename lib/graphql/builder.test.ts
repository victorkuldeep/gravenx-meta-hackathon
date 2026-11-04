import { describe, it, expect } from "vitest";
import {
  buildGraphQLQueryMulti,
  isGraphQLSelectable,
  defaultGraphQLSelection,
  fieldNeedsValueSubselect,
  MAX_BLOCKS,
} from "./builder";
import type { SalesforceField } from "../salesforce/types";

const field = (over: Partial<SalesforceField>): SalesforceField => ({
  name: "X",
  label: "X",
  type: "string",
  length: 0,
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
  picklistValues: [],
  restrictedPicklist: false,
  autoNumber: false,
  idLookup: true,
  filterable: true,
  sortable: true,
  groupable: true,
  nameField: false,
  htmlFormatted: false,
  deprecatedAndHidden: false,
  digits: 0,
  byteLength: 0,
  inlineHelpText: null,
  defaultValue: null,
  soapType: "xsd:string",
  ...over,
});

describe("isGraphQLSelectable", () => {
  it("accepts scalar types", () => {
    expect(isGraphQLSelectable(field({ name: "Name", type: "string" }))).toBe(true);
    expect(isGraphQLSelectable(field({ name: "Amount", type: "currency" }))).toBe(true);
  });
  it("rejects compound / binary types", () => {
    expect(isGraphQLSelectable(field({ name: "Addr", type: "address" }))).toBe(false);
    expect(isGraphQLSelectable(field({ name: "Blob", type: "base64" }))).toBe(false);
    expect(isGraphQLSelectable(field({ name: "Loc", type: "location" }))).toBe(false);
  });
  it("rejects deprecated / hidden", () => {
    expect(isGraphQLSelectable(field({ deprecatedAndHidden: true }))).toBe(false);
  });
  it("rejects unsafe names", () => {
    expect(isGraphQLSelectable(field({ name: "1bad" }))).toBe(false);
    expect(isGraphQLSelectable(field({ name: "has-dash" }))).toBe(false);
    expect(isGraphQLSelectable(field({ name: "has space" }))).toBe(false);
  });
});

describe("defaultGraphQLSelection", () => {
  it("prefers Id + Name when present", () => {
    const out = defaultGraphQLSelection([
      field({ name: "Id", type: "id" }),
      field({ name: "Name", type: "string", nameField: true }),
      field({ name: "Other", type: "string" }),
    ]);
    expect(out).toEqual(["Id", "Name"]);
  });
  it("falls back to first 3 selectable when Id/Name absent", () => {
    const out = defaultGraphQLSelection([
      field({ name: "A", type: "string" }),
      field({ name: "B", type: "string" }),
      field({ name: "C", type: "string" }),
    ]);
    expect(out).toEqual(["A", "B", "C"]);
  });
});

describe("fieldNeedsValueSubselect", () => {
  it("only Id is a true scalar", () => {
    expect(fieldNeedsValueSubselect({ name: "Id", type: "id", nameField: false })).toBe(false);
    expect(fieldNeedsValueSubselect({ name: "Name", type: "string", nameField: true })).toBe(true);
  });
});

describe("buildGraphQLQueryMulti", () => {
  it("builds a single-object uiapi query", () => {
    const out = buildGraphQLQueryMulti([
      {
        objectName: "Account",
        first: 5,
        nodes: [
          { kind: "leaf", name: "Id", needsValue: false },
          { kind: "leaf", name: "Name", needsValue: true },
        ],
      },
    ]);
    expect(out).toContain("uiapi {");
    expect(out).toContain("Account(first: 5)");
    expect(out).toContain("Id");
    expect(out).toMatch(/Name\s*\{\s*value\s*\}/);
  });

  it("builds parent traversal via relationshipName", () => {
    const out = buildGraphQLQueryMulti([
      {
        objectName: "Account",
        first: 1,
        nodes: [
          { kind: "leaf", name: "Id", needsValue: false },
          {
            kind: "parent",
            relation: "Owner",
            fields: [{ kind: "leaf", name: "Name", needsValue: true }],
          },
        ],
      },
    ]);
    expect(out).toMatch(/Owner\s*\{\s*Name\s*\{\s*value\s*}/);
  });

  it("builds child list with edges/nodes", () => {
    const out = buildGraphQLQueryMulti([
      {
        objectName: "Account",
        first: 1,
        nodes: [
          { kind: "leaf", name: "Id", needsValue: false },
          {
            kind: "child",
            relation: "Contacts",
            first: 3,
            fields: [{ kind: "leaf", name: "Name", needsValue: true }],
          },
        ],
      },
    ]);
    expect(out).toContain("Contacts(first: 3)");
    expect(out).toContain("edges");
    expect(out).toContain("node");
  });

  it("rejects invalid object names", () => {
    expect(() =>
      buildGraphQLQueryMulti([
        { objectName: "Bad-Name", first: 1, nodes: [{ kind: "leaf", name: "Id", needsValue: false }] },
      ])
    ).toThrow();
  });

  it("rejects when no nodes", () => {
    expect(() =>
      buildGraphQLQueryMulti([{ objectName: "Account", first: 1, nodes: [] }])
    ).toThrow();
  });

  it("rejects more than MAX_BLOCKS", () => {
    const blocks = Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => ({
      objectName: `Obj${i}`,
      first: 1,
      nodes: [{ kind: "leaf" as const, name: "Id", needsValue: false }],
    }));
    expect(() => buildGraphQLQueryMulti(blocks)).toThrow(/At most/);
  });

  it("clamps `first` between 1 and MAX_FIRST", () => {
    const lo = buildGraphQLQueryMulti([
      {
        objectName: "Account",
        first: 0,
        nodes: [{ kind: "leaf", name: "Id", needsValue: false }],
      },
    ]);
    expect(lo).toMatch(/Account\(first: 1\)/);
    const hi = buildGraphQLQueryMulti([
      {
        objectName: "Account",
        first: 999999,
        nodes: [{ kind: "leaf", name: "Id", needsValue: false }],
      },
    ]);
    expect(hi).toMatch(/Account\(first: 2000\)/);
  });
});
