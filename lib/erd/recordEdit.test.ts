"use client";

import { describe, it, expect } from "vitest";
import { serializeDraftValue } from "./recordWalk";

describe("record draft serialization", () => {
  it("passes booleans through", () => {
    expect(serializeDraftValue("boolean", true)).toBe(true);
  });
  it("skips empties", () => {
    expect(serializeDraftValue("string", "   ")).toBeUndefined();
  });
  it("converts numbers, keeps garbage as text for server validation", () => {
    expect(serializeDraftValue("currency", "12.5")).toBe(12.5);
    expect(serializeDraftValue("int", "abc")).toBe("abc");
  });
  it("formats datetimes for the api", () => {
    expect(serializeDraftValue("datetime", "2024-05-01T10:30")).toBe("2024-05-01T10:30:00.000+0000");
    expect(serializeDraftValue("date", "2024-05-01")).toBe("2024-05-01");
  });
  it("passes plain text through", () => {
    expect(serializeDraftValue("string", " hello ")).toBe("hello");
  });
});
