import { describe, it, expect } from "vitest";
import { diffSegments } from "./diffText";

describe("diffSegments", () => {
  it("returns a single same run for identical strings", () => {
    expect(diffSegments("abc", "abc")).toEqual([{ text: "abc", kind: "same" }]);
  });
  it("marks changed characters as del/add runs", () => {
    const segs = diffSegments("Created", "Accepted");
    expect(segs).not.toBeNull();
    const kinds = new Set((segs ?? []).map((s) => s.kind));
    expect(kinds.has("del")).toBe(true);
    expect(kinds.has("add")).toBe(true);
    // Rebuilding each side from its runs round-trips exactly.
    const a = (segs ?? []).filter((s) => s.kind !== "add").map((s) => s.text).join("");
    const b = (segs ?? []).filter((s) => s.kind !== "del").map((s) => s.text).join("");
    expect(a).toBe("Created");
    expect(b).toBe("Accepted");
  });
  it("merges adjacent runs of the same kind", () => {
    const segs = diffSegments("100", "200") ?? [];
    expect(segs.filter((s) => s.kind === "del")).toHaveLength(1);
    expect(segs.filter((s) => s.kind === "add")).toHaveLength(1);
  });
  it("refuses oversized inputs", () => {
    expect(diffSegments("x".repeat(801), "y")).toBeNull();
  });
});
