import { describe, expect, it } from "vitest";
import { checkImageFile } from "./assets";
import { blankExperienceModule } from "./types";
import { deleteScreenCascade, reorderScreens, screenImpact } from "./screens";

describe("checkImageFile", () => {
  it("accepts PNG and WebP", () => {
    expect(checkImageFile({ type: "image/png", size: 100, name: "a.png" }).ok).toBe(true);
    expect(checkImageFile({ type: "image/webp", size: 100, name: "a.webp" }).ok).toBe(true);
  });
  it("rejects JPEG, empty and oversize files", () => {
    expect(checkImageFile({ type: "image/jpeg", size: 100, name: "a.jpg" }).ok).toBe(false);
    expect(checkImageFile({ type: "image/png", size: 0, name: "a.png" }).ok).toBe(false);
    expect(checkImageFile({ type: "image/png", size: 11 * 1024 * 1024, name: "a.png" }).ok).toBe(false);
  });
  it("distrusts extension-only claims", () => {
    expect(checkImageFile({ type: "image/jpeg", size: 100, name: "a.png" }).ok).toBe(false);
  });
});

describe("screen inventory", () => {
  function mod() {
    const exp = blankExperienceModule("e1", "2026-01-01");
    exp.screens = [
      { id: "s1", name: "One", journeyIds: [], canvas: { sourceWidth: 100, sourceHeight: 100, aspectRatio: 1 }, componentIds: [], actionIds: [], bindingIds: [], status: "draft", tags: [], createdAt: "t", updatedAt: "t" },
      { id: "s2", name: "Two", journeyIds: [], canvas: { sourceWidth: 100, sourceHeight: 100, aspectRatio: 1 }, componentIds: [], actionIds: [], bindingIds: [], status: "draft", tags: [], createdAt: "t", updatedAt: "t" },
    ];
    exp.components = [{ id: "c1", screenId: "s1", name: "C", componentType: "button", requirementIds: [], bindingIds: [], actionIds: [], stateIds: [], status: "draft", tags: [], createdAt: "t", updatedAt: "t" }];
    exp.annotations = [{ id: "a1", screenId: "s1", label: "A", geometry: { x: 0, y: 0, width: 10, height: 10, coordinateSpace: "source-pixels" }, zIndex: 0, createdAt: "t", updatedAt: "t" }];
    return exp;
  }

  it("reports deletion impact before deleting", () => {
    expect(screenImpact(mod(), "s1")).toMatchObject({ components: 1, annotations: 1 });
    expect(screenImpact(mod(), "s2")).toMatchObject({ components: 0, annotations: 0 });
  });

  it("cascades screen-scoped artifacts, keeps shared catalogs", () => {
    const next = deleteScreenCascade(mod(), "s1");
    expect(next.screens.map((s) => s.id)).toEqual(["s2"]);
    expect(next.components).toEqual([]);
    expect(next.annotations).toEqual([]);
  });

  it("reorders with clamping", () => {
    const m = mod();
    expect(reorderScreens(m.screens, 0, 5).map((s) => s.id)).toEqual(["s2", "s1"]);
    expect(reorderScreens(m.screens, 1, 0).map((s) => s.id)).toEqual(["s2", "s1"]);
  });
});
