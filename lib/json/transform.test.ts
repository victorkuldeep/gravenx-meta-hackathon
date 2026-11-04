import { describe, it, expect } from "vitest";
import {
  applyTransformOps,
  escapeForEmbedding,
  buildWrapper,
  unescapeToJson,
  type TransformOp,
} from "./transform";

const src = () => ({
  id: "001A",
  status: "Draft",
  constraint: { active: true, status: "Hold" },
  lines: [{ sku: "A", qty: 1 }, { sku: "B", qty: 2 }],
});

describe("applyTransformOps", () => {
  it("drops object keys and array items", () => {
    const ops: TransformOp[] = [{ kind: "drop", path: "$.status" }, { kind: "drop", path: "$.lines[0]" }];
    const { value, errors } = applyTransformOps(src(), ops);
    expect(errors).toEqual([]);
    expect(value).toEqual({
      id: "001A",
      constraint: { active: true, status: "Hold" },
      lines: [{ sku: "B", qty: 2 }],
    });
  });

  it("sets values from JSON text", () => {
    const ops: TransformOp[] = [
      { kind: "set", path: "$.status", valueText: '"Active"' },
      { kind: "set", path: "$.extra", valueText: '{"by":"arch"}' },
    ];
    const { value, errors } = applyTransformOps(src(), ops);
    expect(errors).toEqual([]);
    expect((value as Record<string, unknown>).status).toBe("Active");
    expect((value as Record<string, unknown>).extra).toEqual({ by: "arch" });
  });

  it("renames keys without losing position data", () => {
    const ops: TransformOp[] = [{ kind: "rename", parent: "$.constraint", from: "status", to: "state" }];
    const { value, errors } = applyTransformOps(src(), ops);
    expect(errors).toEqual([]);
    expect(value).toEqual({
      id: "001A",
      status: "Draft",
      constraint: { active: true, state: "Hold" },
      lines: [{ sku: "A", qty: 1 }, { sku: "B", qty: 2 }],
    });
  });

  it("skips failing ops and reports them, applying the rest", () => {
    const ops: TransformOp[] = [
      { kind: "drop", path: "$.missing" },
      { kind: "set", path: "$.status", valueText: "not json" },
      { kind: "rename", parent: "$", from: "id", to: "status" },
      { kind: "drop", path: "$.status" },
    ];
    const { value, errors } = applyTransformOps(src(), ops);
    expect(errors.map((e) => e.op)).toEqual([0, 1, 2]);
    expect(errors[0].message).toContain("not found");
    expect((value as Record<string, unknown>).status).toBeUndefined();
  });

  it("does not mutate the input", () => {
    const s = src();
    applyTransformOps(s, [{ kind: "drop", path: "$.status" }]);
    expect(s.status).toBe("Draft");
  });
});

describe("escape and embed", () => {
  it("escapes compact JSON for single-quoted embedding", () => {
    const esc = escapeForEmbedding({ a: 'x"y', n: 1 }, false);
    expect(esc).toBe('{\\"a\\":\\"x\\\\\\"y\\",\\"n\\":1}');
    // Round-trips through one JSON.parse into the original text.
    expect(JSON.parse(`"${esc}"`)).toBe('{"a":"x\\"y","n":1}');
  });

  it("builds a wrapper carrying the payload as a string", () => {
    const w = buildWrapper({ a: 1 }, "salesTransaction", { op: "set" });
    expect(w).toEqual({ op: "set", salesTransaction: '{"a":1}' });
  });

  it("unescapes an escaped string back to a value", () => {
    const esc = escapeForEmbedding({ a: 1 }, false);
    const r = unescapeToJson(`"${esc}"`);
    expect(r).toEqual({ ok: true, value: { a: 1 } });
  });

  it("unescapes a full wrapper by its first string field", () => {
    const r = unescapeToJson(JSON.stringify(buildWrapper({ a: 1 }, "salesTransaction")));
    expect(r).toEqual({ ok: true, value: { a: 1 } });
  });

  it("rejects garbage with a message", () => {
    expect(unescapeToJson("   ").ok).toBe(false);
    expect(unescapeToJson("{oops").ok).toBe(false);
  });
});
