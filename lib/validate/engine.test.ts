import { beforeEach, describe, expect, it } from "vitest";
import { clearEngineCache, validatePayload } from "./engine";
import type { ValidationTarget } from "./types";

function target(schema: unknown, schemaId = "test"): ValidationTarget {
  return {
    operationId: "GET /x",
    direction: "request",
    mediaType: "application/json",
    schemaId,
    dialect: "https://json-schema.org/draft/2020-12/schema",
    schema,
  };
}

beforeEach(() => clearEngineCache());

describe("engine - basics", () => {
  const schema = {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string", minLength: 2 }, age: { type: "integer", minimum: 0 } },
    additionalProperties: false,
  };

  it("passes a valid object", () => {
    const r = validatePayload(target(schema, "basic"), { name: "Ada", age: 3 });
    expect(r.report?.outcome).toBe("valid");
    expect(r.report?.findings).toEqual([]);
  });

  it("flags missing required with the property path", () => {
    const r = validatePayload(target(schema, "basic-req"), { age: 3 });
    expect(r.report?.outcome).toBe("invalid");
    const f = r.report!.findings[0];
    expect(f.keyword).toBe("required");
    expect(f.path).toBe("/name");
    expect(f.expected).toEqual({ missingProperty: "name" });
  });

  it("flags additional properties at the exact key", () => {
    const r = validatePayload(target(schema, "basic-add"), { name: "Ada", nick: "x" });
    const f = r.report!.findings.find((x) => x.keyword === "additionalProperties")!;
    expect(f.path).toBe("/nick");
    expect(f.actual).toBe("x");
  });

  it("does not coerce types (string stays string)", () => {
    const r = validatePayload(target(schema, "basic-coerce"), { name: "Ada", age: "3" });
    expect(r.report?.outcome).toBe("invalid");
    expect(r.report!.findings.some((f) => f.path === "/age" && f.keyword === "type")).toBe(true);
  });

  it("returns compile errors as contract problems, not payload failures", () => {
    const r = validatePayload(target({ type: "object", properties: 42 } as never, "bad-schema"), {});
    expect(r.report).toBeUndefined();
    expect(r.compileError).toBeTruthy();
  });
});

describe("engine - conditionals (if/then/else)", () => {
  const schema = {
    type: "object",
    properties: { kind: { type: "string" }, value: { type: "number" } },
    if: { properties: { kind: { const: "n" } }, required: ["kind"] },
    then: { required: ["value"] },
    else: { required: ["kind"] },
  };

  it("condition matches -> then enforced", () => {
    const r = validatePayload(target(schema, "cond-1"), { kind: "n" });
    expect(r.report?.outcome).toBe("invalid");
  });
  it("condition matches + then satisfied -> valid", () => {
    const r = validatePayload(target(schema, "cond-2"), { kind: "n", value: 1 });
    expect(r.report?.outcome).toBe("valid");
  });
  it("condition fails -> else enforced", () => {
    const r = validatePayload(target(schema, "cond-3"), { kind: "x" });
    expect(r.report?.outcome).toBe("valid"); // kind present satisfies else
  });
  it("condition property missing -> else enforced", () => {
    const r = validatePayload(target(schema, "cond-4"), {});
    expect(r.report?.outcome).toBe("invalid");
  });
  it("condition property null -> else enforced", () => {
    const r = validatePayload(target(schema, "cond-5"), { kind: null });
    expect(r.report?.outcome).toBe("invalid");
  });
  it("conditional nested in allOf", () => {
    const nested = { allOf: [schema, { type: "object" }] };
    const r = validatePayload(target(nested, "cond-6"), { kind: "n" });
    expect(r.report?.outcome).toBe("invalid");
  });
});

describe("engine - composition", () => {
  it("oneOf: exactly one branch -> valid", () => {
    const r = validatePayload(target({ oneOf: [{ type: "string" }, { type: "number" }] }, "one-1"), "hi");
    expect(r.report?.outcome).toBe("valid");
  });
  it("oneOf: zero branches -> invalid", () => {
    const r = validatePayload(target({ oneOf: [{ type: "string" }, { type: "number" }] }, "one-2"), true);
    expect(r.report?.outcome).toBe("invalid");
  });
  it("oneOf: multiple branches -> invalid (exactly-one semantics)", () => {
    const r = validatePayload(
      target({ oneOf: [{ type: "object" }, { required: ["a"] }] }, "one-3"),
      { a: 1 }
    );
    expect(r.report?.outcome).toBe("invalid");
    expect(r.report!.findings.some((f) => f.keyword === "oneOf")).toBe(true);
  });
  it("anyOf: multiple branches -> still valid", () => {
    const r = validatePayload(
      target({ anyOf: [{ type: "object" }, { required: ["a"] }] }, "any-1"),
      { a: 1 }
    );
    expect(r.report?.outcome).toBe("valid");
  });
  it("anyOf: zero branches -> invalid", () => {
    const r = validatePayload(target({ anyOf: [{ type: "string" }] }, "any-2"), 7);
    expect(r.report?.outcome).toBe("invalid");
  });
  it("allOf: one branch fails -> invalid", () => {
    const r = validatePayload(
      target({ allOf: [{ type: "object" }, { required: ["a"] }] }, "all-1"),
      {}
    );
    expect(r.report?.outcome).toBe("invalid");
  });
  it("allOf accumulates required across branches", () => {
    const r = validatePayload(
      target({ allOf: [{ required: ["a"] }, { required: ["b"] }] }, "all-2"),
      { a: 1 }
    );
    expect(r.report!.findings.some((f) => f.path === "/b")).toBe(true);
  });
});

describe("engine - formats and enums", () => {
  it("enforces date-time format", () => {
    const r = validatePayload(target({ type: "string", format: "date-time" }, "fmt-1"), "not-a-date");
    expect(r.report?.outcome).toBe("invalid");
  });
  it("enforces enum with truncated expected list", () => {
    const r = validatePayload(target({ enum: ["a", "b"] }, "enum-1"), "c");
    const f = r.report!.findings[0];
    expect(f.expected).toEqual(["a", "b"]);
    expect(f.actual).toBe("c");
  });
});
