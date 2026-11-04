import { describe, expect, it } from "vitest";
import { clampK, loadViewport, panBy, screenToWorld, storeViewport, worldToScreen, zoomAt } from "./viewport";

describe("viewport math", () => {
  it("clamps scale", () => {
    expect(clampK(10)).toBe(2.5);
    expect(clampK(0.01)).toBe(0.25);
    expect(clampK(1)).toBe(1);
  });

  it("zooms around the cursor point", () => {
    const v = { x: 0, y: 0, k: 1 };
    const z = zoomAt(v, 100, 50, 2);
    expect(z.k).toBe(2);
    // World point under cursor stays under cursor.
    expect(worldToScreen(z, 100, 50)).toEqual({ x: 100, y: 50 });
  });

  it("pans and round-trips coordinates", () => {
    const v = panBy({ x: 10, y: 20, k: 2 }, 5, -5);
    expect(v).toEqual({ x: 15, y: 15, k: 2 });
    const w = screenToWorld(v, 115, 115);
    expect(worldToScreen(v, w.x, w.y)).toEqual({ x: 115, y: 115 });
  });

  it("persists per experience in session only", () => {
    sessionStorage.clear();
    expect(loadViewport("e1")).toBeNull();
    storeViewport("e1", { x: 1, y: 2, k: 3 });
    expect(loadViewport("e1")).toEqual({ x: 1, y: 2, k: 2.5 });
    expect(loadViewport("e2")).toBeNull();
    sessionStorage.setItem("gravenx_wf_view_e1", "[[broken");
    expect(loadViewport("e1")).toBeNull();
  });
});
