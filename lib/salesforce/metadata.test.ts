import { describe, it, expect } from "vitest";
import type { SalesforceField } from "./types";
import {
  getWritableFields,
  getActivePicklistValues,
  isReferenceField,
  isPicklistField,
  isRequiredField,
  getFieldEditorType,
} from "./metadata";

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

describe("getWritableFields", () => {
  it("excludes system / calculated / autoNumber / deprecated fields", () => {
    const fields = [
      field({ name: "Id" }),
      field({ name: "CreatedDate" }),
      field({ name: "AutoNum", autoNumber: true }),
      field({ name: "Formula", calculated: true }),
      field({ name: "Hidden", deprecatedAndHidden: true }),
      field({ name: "Good", createable: true, updateable: true }),
    ];
    expect(getWritableFields(fields, "POST").map((f) => f.name)).toEqual(["Good"]);
    expect(getWritableFields(fields, "PATCH").map((f) => f.name)).toEqual(["Good"]);
  });

  it("POST requires createable; PATCH requires updateable", () => {
    const fields = [
      field({ name: "A", createable: false, updateable: true }),
      field({ name: "B", createable: true, updateable: false }),
    ];
    expect(getWritableFields(fields, "POST").map((f) => f.name)).toEqual(["B"]);
    expect(getWritableFields(fields, "PATCH").map((f) => f.name)).toEqual(["A"]);
  });
});

describe("getActivePicklistValues", () => {
  it("filters inactive", () => {
    const f = field({
      picklistValues: [
        { active: true, defaultValue: false, label: "A", value: "a", validFor: null },
        { active: false, defaultValue: false, label: "B", value: "b", validFor: null },
      ],
    });
    expect(getActivePicklistValues(f).map((v) => v.value)).toEqual(["a"]);
  });
});

describe("type predicates", () => {
  it("isReferenceField", () => {
    expect(isReferenceField(field({ type: "reference" }))).toBe(true);
    expect(isReferenceField(field({ type: "string" }))).toBe(false);
  });
  it("isPicklistField", () => {
    expect(isPicklistField(field({ type: "picklist" }))).toBe(true);
    expect(isPicklistField(field({ type: "multipicklist" }))).toBe(true);
    expect(isPicklistField(field({ type: "string" }))).toBe(false);
  });
  it("isRequiredField - only on POST", () => {
    expect(
      isRequiredField(
        field({ name: "X", nillable: false, defaultedOnCreate: false, createable: true }),
        "POST"
      )
    ).toBe(true);
    expect(isRequiredField(field({ name: "X", nillable: true }), "POST")).toBe(false);
    expect(isRequiredField(field({ name: "X", nillable: false }), "PATCH")).toBe(false);
  });
});

describe("getFieldEditorType", () => {
  it.each([
    ["boolean", "boolean"],
    ["int", "number"],
    ["double", "number"],
    ["currency", "number"],
    ["percent", "number"],
    ["date", "date"],
    ["datetime", "datetime"],
    ["email", "email"],
    ["phone", "phone"],
    ["url", "url"],
    ["picklist", "picklist"],
    ["multipicklist", "multipicklist"],
    ["reference", "reference"],
    ["textarea", "textarea"],
    ["string", "string"],
  ] as const)("maps %s to %s", (input, expected) => {
    expect(getFieldEditorType(field({ type: input }))).toBe(expected);
  });
});
