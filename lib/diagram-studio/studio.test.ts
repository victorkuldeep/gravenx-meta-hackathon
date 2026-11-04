import { describe, expect, it } from "vitest";
import { blankStudioProject, orphanedItems, studioItemPngFileName, studioSetFileName, type StudioItem } from "./types";
import { STUDIO_THEMES, studioTheme } from "./themes";

const item = (id: string, refId: string): StudioItem => ({ id, kind: "sequence", refId, addedAt: 0 });

describe("blankStudioProject", () => {
  it("starts empty on the premium-light theme", () => {
    const p = blankStudioProject("RCA pack");
    expect(p.name).toBe("RCA pack");
    expect(p.items).toEqual([]);
    expect(p.themeId).toBe("premium-light");
  });

  it("falls back to a name when blank", () => {
    expect(blankStudioProject("  ").name).toBe("Untitled pack");
  });
});

describe("orphanedItems", () => {
  it("flags items whose source canvas is gone, keeping the rest", () => {
    const items = [item("a", "seq-1"), item("b", "gone-9")];
    expect(orphanedItems(items, new Set(["seq-1"])).map((i) => i.id)).toEqual(["b"]);
  });

  it("is empty when every source is live", () => {
    expect(orphanedItems([item("a", "seq-1")], new Set(["seq-1"]))).toEqual([]);
  });
});

describe("studioSetFileName", () => {
  it("prefixes the ordered index", () => {
    expect(studioSetFileName(0, "RCA Review!", 2)).toMatch(/^01-rca-review-\d{8}-\d{4}@2x\.png$/);
    expect(studioSetFileName(9, "X", 3)).toMatch(/^10-x-\d{8}-\d{4}@3x\.png$/);
  });
});

describe("studioItemPngFileName", () => {
  it("slugs the title and carries the scale", () => {
    expect(studioItemPngFileName("RCA Review!", 3)).toMatch(/^rca-review-\d{8}-\d{4}@3x\.png$/);
  });
});

describe("studioTheme", () => {
  it("resolves every registered theme and falls back safely", () => {
    for (const t of STUDIO_THEMES) expect(studioTheme(t.id).id).toBe(t.id);
    expect(studioTheme("nope").id).toBe("premium-light");
  });
});
