import { describe, expect, it } from "vitest";
import type { SalesforceField } from "@/lib/salesforce/types";
import { buildBoundComponent, fieldToComponentKind, isPaletteField, paletteFields } from "./schema";

function field(over: Partial<SalesforceField> = {}): SalesforceField {
  return {
    name: "Name",
    label: "Account Name",
    type: "string",
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
    picklistValues: [],
    restrictedPicklist: false,
    autoNumber: false,
    idLookup: false,
    filterable: true,
    sortable: true,
    groupable: true,
    nameField: true,
    htmlFormatted: false,
    deprecatedAndHidden: false,
    digits: 0,
    byteLength: 255,
    inlineHelpText: null,
    defaultValue: null,
    soapType: "xsd:string",
    ...over,
  };
}

describe("fieldToComponentKind", () => {
  it("maps each editor family to its Salesforce-aware component", () => {
    expect(fieldToComponentKind(field({ type: "boolean" }))).toBe("checkbox");
    expect(fieldToComponentKind(field({ type: "picklist" }))).toBe("sfpicklist");
    expect(fieldToComponentKind(field({ type: "multipicklist" }))).toBe("sfpicklist");
    expect(fieldToComponentKind(field({ type: "reference" }))).toBe("sflookup");
    expect(fieldToComponentKind(field({ type: "textarea" }))).toBe("sffield");
    expect(fieldToComponentKind(field({ type: "date" }))).toBe("sffield");
    expect(fieldToComponentKind(field({ type: "datetime" }))).toBe("sffield");
    expect(fieldToComponentKind(field({ type: "currency" }))).toBe("sffield");
    expect(fieldToComponentKind(field({ type: "double" }))).toBe("sffield");
    expect(fieldToComponentKind(field({ type: "email" }))).toBe("sffield");
    expect(fieldToComponentKind(field({ type: "string" }))).toBe("sffield");
  });
});

describe("buildBoundComponent", () => {
  it("binds label, object, field and required-ness from describe", () => {
    const c = buildBoundComponent(field({ name: "Phone", label: "Phone", nillable: true }), "Account", "scr_1");
    expect(c.kind).toBe("sffield");
    expect(c.parentId).toBe("scr_1");
    expect(c.label).toBe("Phone");
    expect(c.bindingState).toBe("existing");
    expect(c.binding).toMatchObject({ source: "salesforce", object: "Account", field: "Phone" });
    expect(c.validation?.required).toBe(false);
  });

  it("marks non-nillable fields required", () => {
    const c = buildBoundComponent(field({ nillable: false }), "Account", "scr_1");
    expect(c.validation?.required).toBe(true);
  });

  it("carries active picklist options onto selects", () => {
    const c = buildBoundComponent(
      field({
        type: "picklist",
        picklistValues: [
          { active: true, defaultValue: false, label: "Hot", value: "Hot", validFor: null },
          { active: false, defaultValue: false, label: "Cold", value: "Cold", validFor: null },
        ],
      }),
      "Lead",
      "scr_1",
    );
    expect(c.kind).toBe("sfpicklist");
    expect(c.props.options).toEqual(["Hot"]);
  });

  it("records lookup targets for future reference resolution", () => {
    const c = buildBoundComponent(field({ type: "reference", referenceTo: ["User"] }), "Account", "scr_1");
    expect(c.kind).toBe("sflookup");
    expect(c.props.referenceTo).toEqual(["User"]);
  });
});

describe("palette fields", () => {
  it("hides deprecated fields but keeps the rest in order", () => {
    const fields = [
      field({ name: "A" }),
      field({ name: "B", deprecatedAndHidden: true }),
      field({ name: "C" }),
    ];
    expect(paletteFields({ name: "X", label: "X", labelPlural: "X", custom: false, createable: true, updateable: true, fields, childRelationships: [] }).map((f) => f.name)).toEqual(["A", "C"]);
    expect(isPaletteField(field({ deprecatedAndHidden: true }))).toBe(false);
    expect(paletteFields(null)).toEqual([]);
  });
});
