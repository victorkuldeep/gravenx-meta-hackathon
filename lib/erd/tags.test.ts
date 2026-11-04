import { describe, expect, it } from "vitest";
import {
  ERD_TAG_COLORS,
  cleanTagName,
  createTag,
  nodeMatchesTagFilter,
  snapTagColor,
  tintForTags,
} from "./tags";

describe("erd tags", () => {
  it("fixes an 8-color palette", () => {
    expect(ERD_TAG_COLORS).toHaveLength(8);
    expect(new Set(ERD_TAG_COLORS).size).toBe(8);
  });

  it("rejects empty names and caps length", () => {
    expect(cleanTagName("   ")).toBeNull();
    expect(cleanTagName("  Core  Model ")).toBe("Core Model");
    expect(cleanTagName("x".repeat(99))).toHaveLength(24);
  });

  it("creates tags with palette-snapped colors", () => {
    const tag = createTag("PII", "#722F37", []);
    expect(tag).toMatchObject({ name: "PII", color: "#722F37" });
    expect(typeof tag?.id).toBe("string");
    expect(createTag("   ", "#722F37", [])).toBeNull();
    // Unknown color snaps into the palette, avoiding taken slots.
    const again = createTag("Other", "hotpink", tag ? [tag] : []);
    expect(ERD_TAG_COLORS).toContain(again?.color);
    expect(again?.color).not.toBe(tag?.color);
  });

  it("snaps colors into the palette", () => {
    expect(snapTagColor("#722f37")).toBe("#722F37");
    expect(snapTagColor("hotpink", new Set(ERD_TAG_COLORS))).toBe(ERD_TAG_COLORS[0]);
  });

  it("tints from the first tag only", () => {
    expect(tintForTags([])).toBeNull();
    expect(tintForTags([{ color: "#1F766E" }, { color: "#722F37" }])).toBe("#1F766E");
  });

  it("matches nodes against the session filter", () => {
    expect(nodeMatchesTagFilter(["a"], new Set())).toBe(true);
    expect(nodeMatchesTagFilter(["a"], new Set(["a", "b"]))).toBe(true);
    expect(nodeMatchesTagFilter(["c"], new Set(["a", "b"]))).toBe(false);
    expect(nodeMatchesTagFilter([], ["a"])).toBe(false);
  });
});
