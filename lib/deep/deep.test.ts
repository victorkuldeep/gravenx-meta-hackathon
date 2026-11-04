import { describe, expect, it } from "vitest";
import { findDeepRecord } from "./deep";

const items = [
  { id: "a1", number: "ADR-001", title: "First" },
  { id: "b2", number: "ADR-002", title: "Second" },
  { id: "c3", title: "Unnumbered" },
];

describe("deep record matching", () => {
  it("matches by exact id", () => {
    expect(findDeepRecord(items, "b2")?.title).toBe("Second");
  });

  it("matches human numbers case-insensitively", () => {
    expect(findDeepRecord(items, "ADR-001")?.title).toBe("First");
    expect(findDeepRecord(items, "adr-002")?.title).toBe("Second");
  });

  it("matches records without numbers by id only", () => {
    expect(findDeepRecord(items, "c3")?.title).toBe("Unnumbered");
    expect(findDeepRecord(items, "C3")).toBeNull();
  });

  it("never matches blank or unknown values", () => {
    expect(findDeepRecord(items, null)).toBeNull();
    expect(findDeepRecord(items, "")).toBeNull();
    expect(findDeepRecord(items, "  ")).toBeNull();
    expect(findDeepRecord(items, "ADR-999")).toBeNull();
  });
});
