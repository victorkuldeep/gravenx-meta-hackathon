"use client";

import { describe, it, expect } from "vitest";
import {
  fingerprintField,
  fingerprintEntity,
  diffFieldFacts,
  diffEntityFacts,
} from "./schemaReview";

describe("schema review fingerprints", () => {
  it("is deterministic and order-insensitive for reference targets", () => {
    const a = fingerprintField({ name: "X", type: "reference", required: true, referenceTo: ["B", "A"], label: "X" });
    const b = fingerprintField({ name: "X", type: "reference", required: true, referenceTo: ["A", "B"], label: "Other label" });
    expect(a).toBe(b);
  });

  it("changes when material facts change, ignores labels", () => {
    const base = { name: "X", type: "reference", required: false, referenceTo: ["A"], label: "X" };
    expect(fingerprintField({ ...base, required: true })).not.toBe(fingerprintField(base));
    expect(fingerprintField({ ...base, type: "string" })).not.toBe(fingerprintField(base));
    expect(fingerprintField({ ...base, referenceTo: ["B"] })).not.toBe(fingerprintField(base));
  });

  it("entity fingerprints detect field add/remove, ignore order", () => {
    const a = fingerprintEntity({ apiName: "O", fieldCount: 2, fieldNames: ["A", "B"], childNames: [] });
    const b = fingerprintEntity({ apiName: "O", fieldCount: 2, fieldNames: ["B", "A"], childNames: [] });
    expect(a).toBe(b);
    expect(fingerprintEntity({ apiName: "O", fieldCount: 3, fieldNames: ["A", "B", "C"], childNames: [] })).not.toBe(a);
  });

  it("field diffs name exactly what changed", () => {
    const diffs = diffFieldFacts(
      { type: "reference", required: false, referenceTo: ["A"], label: "X" },
      { name: "X", type: "string", required: true, referenceTo: [], label: "X" }
    );
    expect(diffs).toContain("type reference → string");
    expect(diffs).toContain("became required");
    expect(diffs).toContain("lookup target A → none");
    expect(diffFieldFacts(
      { type: "string", required: false, referenceTo: [], label: "X" },
      { name: "X", type: "string", required: false, referenceTo: [], label: "X" }
    )).toEqual([]);
  });

  it("entity diffs summarize added/removed fields", () => {
    const diffs = diffEntityFacts(
      { fieldNames: ["A", "B"], childNames: [] },
      { apiName: "O", fieldCount: 2, fieldNames: ["B", "C"], childNames: [] }
    );
    expect(diffs.some((d) => d.startsWith("+1 field (C)"))).toBe(true);
    expect(diffs.some((d) => d.startsWith("−1 field (A)"))).toBe(true);
  });
});
