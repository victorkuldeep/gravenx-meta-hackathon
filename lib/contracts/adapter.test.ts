import { describe, it, expect } from "vitest";
import { adaptDescribe, adaptField } from "./metadata-adapter";
import { allowedForOperation, effectiveRequired } from "./field-policy";
import { leadDescribeFixture } from "./test-fixtures";

describe("metadata-adapter", () => {
  it("adapts object + fields without inventing", () => {
    const adapted = adaptDescribe(leadDescribeFixture());
    expect(adapted.objectApiName).toBe("Lead");
    expect(adapted.fields).toHaveLength(18);
    const status = adapted.fields.find((f) => f.apiName === "Status");
    expect(status?.picklistValues.map((p) => p.value)).toEqual(["New", "Contacted", "Old"]);
    expect(status?.picklistValues.find((p) => p.value === "Old")?.active).toBe(false);
  });
  it("marks unavailable metadata as unknown, never inferred", () => {
    const adapted = adaptDescribe(leadDescribeFixture());
    expect(adapted.unknown).toContain("recordTypeScoping");
    expect(adapted.fields[0].unknown).toContain("dependentPicklist");
  });
  it("copies reference targets verbatim", () => {
    const adapted = adaptDescribe(leadDescribeFixture());
    expect(adapted.fields.find((f) => f.apiName === "RelatedToId")?.referenceTo).toEqual([
      "Account",
      "Opportunity",
    ]);
  });
  it("adapts a single field", () => {
    const m = adaptField(leadDescribeFixture().fields[0]);
    expect(m.apiName).toBe("FirstName");
    expect(m.createable).toBe(true);
  });
});

describe("field-policy", () => {
  const meta = (over: Record<string, unknown>) => ({
    apiName: "X",
    createable: true,
    updateable: true,
    nillable: true,
    defaultedOnCreate: false,
    sfType: "string",
    ...over,
  });

  it("gates POST on createable, PATCH on updateable", () => {
    expect(allowedForOperation(meta({ createable: false }), "POST")).toBe(false);
    expect(allowedForOperation(meta({ createable: false }), "PATCH")).toBe(true);
    expect(allowedForOperation(meta({ updateable: false }), "PATCH")).toBe(false);
    expect(allowedForOperation(meta({ updateable: false }), "POST")).toBe(true);
  });
  it("distinguishes Salesforce-required from integration-required", () => {
    const sfReq = meta({ nillable: false });
    expect(effectiveRequired(sfReq, false, "POST")).toEqual({ required: true, source: "salesforce" });
    expect(effectiveRequired(meta({}), true, "POST")).toEqual({ required: true, source: "integration" });
    expect(effectiveRequired(meta({}), false, "POST")).toEqual({ required: false, source: "none" });
  });
  it("defaulted-on-create is not Salesforce-required", () => {
    const m = meta({ nillable: false, defaultedOnCreate: true });
    expect(effectiveRequired(m, false, "POST").source).not.toBe("salesforce");
  });
});
