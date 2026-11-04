import { describe, expect, it } from "vitest";
import { adaptSchema, supportMatrix } from "./adapter";

const req = { version: "3.0.3", direction: "request" as const };
const res = { version: "3.0.3", direction: "response" as const };

describe("adaptSchema (OpenAPI 3.0)", () => {
  it("translates nullable into anyOf null", () => {
    const r = adaptSchema({ type: "string", nullable: true }, req);
    expect(r.supported).toBe(true);
    expect(r.schema).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
  });

  it("appends null to nullable enums", () => {
    const r = adaptSchema({ type: "string", enum: ["a"], nullable: true }, req);
    expect(r.schema).toEqual({ type: "string", enum: ["a", null] });
  });

  it("converts boolean exclusiveMinimum to numeric form", () => {
    const r = adaptSchema({ type: "number", minimum: 5, exclusiveMinimum: true }, req);
    expect(r.schema).toEqual({ type: "number", exclusiveMinimum: 5 });
  });

  it("drops discriminator with an info diagnostic", () => {
    const r = adaptSchema({ oneOf: [{ type: "string" }], discriminator: { propertyName: "kind" } }, req);
    expect(r.supported).toBe(true);
    expect((r.schema as Record<string, unknown>).discriminator).toBeUndefined();
    expect(r.diagnostics.some((d) => d.message.includes("discriminator"))).toBe(true);
  });

  it("relaxes readOnly requiredness for requests", () => {
    const r = adaptSchema(
      { type: "object", required: ["id", "name"], properties: { id: { type: "string", readOnly: true }, name: { type: "string" } } },
      req
    );
    expect((r.schema as Record<string, unknown>).required).toEqual(["name"]);
  });

  it("keeps readOnly requiredness for responses", () => {
    const r = adaptSchema(
      { type: "object", required: ["id"], properties: { id: { type: "string", readOnly: true } } },
      res
    );
    expect((r.schema as Record<string, unknown>).required).toEqual(["id"]);
  });

  it("strips unenforced formats with info", () => {
    const r = adaptSchema({ type: "string", format: "int32" }, req);
    expect((r.schema as Record<string, unknown>).format).toBeUndefined();
    expect(r.diagnostics.some((d) => d.severity === "info")).toBe(true);
  });

  it("keeps enforced formats", () => {
    const r = adaptSchema({ type: "string", format: "date-time" }, req);
    expect((r.schema as Record<string, unknown>).format).toBe("date-time");
  });

  it("blocks unknown types", () => {
    const r = adaptSchema({ type: "file" }, req);
    expect(r.supported).toBe(false);
    expect(r.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("flags suspicious if-without-required conditionals", () => {
    const r = adaptSchema(
      { if: { properties: { kind: { const: "a" } } }, then: { required: ["x"] } },
      req
    );
    expect(r.supported).toBe(true);
    expect(r.diagnostics.some((d) => d.message.includes("Suspicious conditional"))).toBe(true);
  });

  it("drops vendor extensions silently", () => {
    const r = adaptSchema({ type: "string", "x-internal": true }, req);
    expect(r.schema).toEqual({ type: "string" });
    expect(r.diagnostics).toEqual([]);
  });
});

describe("adaptSchema (OpenAPI 3.1 passthrough)", () => {
  it("passes modern schemas through untouched", () => {
    const schema = { type: ["string", "null"], $comment: "hi" };
    const r = adaptSchema(schema, { version: "3.1.0", direction: "request" });
    expect(r.supported).toBe(true);
    expect(r.schema).toEqual(schema);
  });
});

describe("supportMatrix", () => {
  it("covers the required rows", () => {
    const rows = supportMatrix("3.0.3").map((r) => r.feature);
    for (const f of ["Local $ref", "External $ref", "nullable (3.0)", "discriminator", "formats"]) {
      expect(rows).toContain(f);
    }
  });
});
