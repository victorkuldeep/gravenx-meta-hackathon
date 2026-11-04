import { describe, expect, it } from "vitest";
import { buildShareEnvelope, validateShareEnvelope, SHARE_ENVELOPE_MAX_BYTES } from "./envelope";

describe("share envelope", () => {
  it("accepts a well-formed envelope", () => {
    const env = buildShareEnvelope("sequence", "Order flow", { id: "seq_1", nodes: [] });
    expect(validateShareEnvelope(env)).toEqual(env);
  });

  it("rejects unknown kinds and bad versions", () => {
    expect(validateShareEnvelope({ v: 1, kind: "erd", name: "x", data: {} })).toBeNull();
    expect(validateShareEnvelope({ v: 2, kind: "sequence", name: "x", data: {} })).toBeNull();
    expect(validateShareEnvelope({ v: 1, kind: "sequence", name: "", data: {} })).toBeNull();
    expect(validateShareEnvelope(null)).toBeNull();
  });

  it("rejects oversized payloads", () => {
    const big = "x".repeat(SHARE_ENVELOPE_MAX_BYTES + 1);
    expect(validateShareEnvelope({ v: 1, kind: "experience", name: "big", data: big })).toBeNull();
  });
});
