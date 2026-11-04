import { describe, it, expect } from "vitest";
import { mapSfTypeToJsonSchema, isPolymorphic } from "./type-mapper";
import { adaptDescribe } from "./metadata-adapter";
import { leadDescribeFixture } from "./test-fixtures";

const metaFor = (apiName: string) => {
  const m = adaptDescribe(leadDescribeFixture()).fields.find((f) => f.apiName === apiName);
  if (!m) throw new Error(`no fixture field ${apiName}`);
  return m;
};

describe("type-mapper", () => {
  it("maps strings and booleans", () => {
    expect(mapSfTypeToJsonSchema(metaFor("FirstName")).schema).toMatchObject({ type: "string", maxLength: 40 });
    expect(mapSfTypeToJsonSchema(metaFor("HasOptedOutOfEmail")).schema).toMatchObject({ type: "boolean" });
  });
  it("maps picklists to enums with active values only", () => {
    const { schema, warnings } = mapSfTypeToJsonSchema(metaFor("Status"));
    expect(schema).toMatchObject({ type: "string", enum: ["New", "Contacted"] });
    expect(warnings).toHaveLength(0);
  });
  it("marks restricted picklists explicitly", () => {
    const { schema } = mapSfTypeToJsonSchema(metaFor("Rating"));
    expect(schema.enum).toEqual(["Hot", "Warm", "Cold"]);
    expect(String(schema.description)).toMatch(/Restricted/);
  });
  it("maps currency/int/date/datetime", () => {
    expect(mapSfTypeToJsonSchema(metaFor("AnnualRevenue")).schema).toMatchObject({ type: "number" });
    expect(mapSfTypeToJsonSchema(metaFor("NumberOfEmployees")).schema).toMatchObject({ type: "integer" });
    expect(mapSfTypeToJsonSchema(metaFor("Birthdate")).schema).toMatchObject({ type: "string", format: "date" });
    expect(mapSfTypeToJsonSchema(metaFor("LastActivityDate")).schema).toMatchObject({ type: "string", format: "date-time" });
  });
  it("documents single-target references as IDs", () => {
    const { schema } = mapSfTypeToJsonSchema(metaFor("OwnerId"));
    expect(schema.type).toBe("string");
    expect(String(schema.description)).toMatch(/User/);
    expect(isPolymorphic(metaFor("OwnerId"))).toBe(false);
  });
  it("marks polymorphic references explicitly, never nested", () => {
    const { schema, warnings } = mapSfTypeToJsonSchema(metaFor("RelatedToId"));
    expect(schema.type).toBe("string");
    expect(schema["x-sf-polymorphic"]).toEqual(["Account", "Opportunity"]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(isPolymorphic(metaFor("RelatedToId"))).toBe(true);
  });
  it("warns on empty picklists instead of inventing enums", () => {
    const m = { ...metaFor("Status"), picklistValues: [] };
    const { schema, warnings } = mapSfTypeToJsonSchema(m);
    expect(schema.enum).toBeUndefined();
    expect(warnings.length).toBeGreaterThan(0);
  });
});
