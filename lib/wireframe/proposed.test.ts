import { describe, expect, it } from "vitest";
import { newExperience } from "./model";
import { newComponent } from "./registry";
import { invalidProposals, schemaDelta, suggestApiName, validateProposed } from "./proposed";

describe("suggestApiName", () => {
  it("derives Custom_Field__c from a label", () => {
    expect(suggestApiName("Annual Contract Value")).toBe("Annual_Contract_Value__c");
    expect(suggestApiName("  customer-segment ")).toBe("Customersegment__c");
    expect(suggestApiName("")).toBe("");
    expect(suggestApiName("Tier__c")).toBe("Tier__c");
  });
});

describe("validateProposed", () => {
  const base = { object: "Account", apiName: "Tier__c", label: "Tier", type: "Text" };
  it("accepts a clean proposal", () => {
    expect(validateProposed(base)).toEqual([]);
  });
  it("flags api-name, picklist and lookup gaps", () => {
    expect(validateProposed({ ...base, apiName: "Tier" })).toHaveLength(1);
    expect(validateProposed({ ...base, type: "Picklist", values: [] }).join(" ")).toMatch(/Picklist/);
    expect(validateProposed({ ...base, type: "Lookup", values: [] }).join(" ")).toMatch(/Lookup/);
    expect(validateProposed({ ...base, object: " " })).toHaveLength(1);
  });
});

describe("schemaDelta", () => {
  it("groups existing bindings and rollup proposals per object", () => {
    const exp = newExperience("Delta");
    const a = { ...newComponent("sffield", "s1"), bindingState: "existing" as const, binding: { source: "salesforce" as const, object: "Account", field: "Name" } };
    const b = { ...newComponent("sffield", "s1"), bindingState: "existing" as const, binding: { source: "salesforce" as const, object: "Account", field: "Name" } };
    const withRollup = {
      ...exp,
      components: [a, b],
      proposedFields: [{ object: "Account", apiName: "Tier__c", label: "Tier", type: "Picklist", values: ["A", "B"] }],
    };
    const delta = schemaDelta(withRollup);
    expect(delta).toHaveLength(1);
    expect(delta[0].existing).toEqual(["Account.Name"]);
    expect(delta[0].proposed.map((p) => p.apiName)).toEqual(["Tier__c"]);
  });

  it("lists proposed-only objects and skips blank rows", () => {
    const exp = { ...newExperience("Delta"), proposedFields: [{ object: "Contact", apiName: "X__c", label: "X", type: "Text" }, { object: " ", apiName: "Y__c", label: "Y", type: "Text" }] };
    const delta = schemaDelta(exp);
    expect(delta.map((d) => d.object)).toEqual(["Contact"]);
  });
});

describe("invalidProposals", () => {
  it("flags only proposed-state components with problems", () => {
    const good = { ...newComponent("input", "s1"), id: "g", bindingState: "proposed" as const, proposedField: { object: "Account", apiName: "Tier__c", label: "Tier", type: "Text" } };
    const bad = { ...newComponent("input", "s1"), id: "b", label: "Seg", bindingState: "proposed" as const, proposedField: { object: "Account", apiName: "nope", label: "Seg", type: "Picklist", values: [] } };
    const plain = { ...newComponent("input", "s1"), id: "p" };
    const out = invalidProposals([good, bad, plain]);
    expect(out.map((o) => o.id)).toEqual(["b"]);
    expect(out[0].problems.length).toBeGreaterThan(1);
  });
});
