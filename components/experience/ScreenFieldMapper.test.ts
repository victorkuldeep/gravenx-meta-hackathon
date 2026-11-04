import { describe, expect, it } from "vitest";
import { isMandatory } from "./ScreenFieldMapper";

describe("isMandatory", () => {
  it("matches the Builder rule: writable, non-nullable, no create default", () => {
    expect(isMandatory({ nillable: false, createable: true, defaultedOnCreate: false })).toBe(true);
  });

  it("rejects nullable, read-only and defaulted fields", () => {
    expect(isMandatory({ nillable: true, createable: true, defaultedOnCreate: false })).toBe(false);
    expect(isMandatory({ nillable: false, createable: false, defaultedOnCreate: false })).toBe(false);
    expect(isMandatory({ nillable: false, createable: true, defaultedOnCreate: true })).toBe(false);
    expect(isMandatory({})).toBe(false);
  });
});
