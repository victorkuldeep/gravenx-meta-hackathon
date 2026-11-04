import { describe, expect, it } from "vitest";
import {
  clampRect,
  dragRect,
  fitScale,
  fitViewport,
  normalizeRect,
  toSource,
  toView,
  validateGeometry,
  zoomAbout,
} from "./geometry";

describe("viewport math", () => {
  it("fits without upscaling past 3x", () => {
    expect(fitScale(100, 100, 1000, 1000)).toBe(3);
    expect(fitScale(1000, 500, 500, 500)).toBe(0.5);
  });
  it("centers the image on fit", () => {
    const vp = fitViewport(1000, 500, 500, 500);
    expect(vp.scale).toBe(0.5);
    expect(vp.tx).toBe(0);
    expect(vp.ty).toBe(125);
  });
  it("round-trips view <-> source at any zoom/pan", () => {
    const vp = zoomAbout({ scale: 1, tx: 10, ty: -20 }, 2.5, 100, 100);
    const view = toView(vp, 42, 77);
    const back = toSource(vp, view.px, view.py);
    expect(back.x).toBeCloseTo(42, 9);
    expect(back.y).toBeCloseTo(77, 9);
  });
  it("clamps zoom range", () => {
    expect(zoomAbout({ scale: 1, tx: 0, ty: 0 }, 100, 0, 0).scale).toBe(8);
    expect(zoomAbout({ scale: 1, tx: 0, ty: 0 }, 0.001, 0, 0).scale).toBe(0.1);
  });
});

describe("rectangles", () => {
  it("normalizes any drag direction", () => {
    expect(normalizeRect(50, 50, 10, 20)).toEqual({ x: 10, y: 20, width: 40, height: 30 });
  });
  it("clamps to bounds, rejects slivers", () => {
    expect(clampRect({ x: -10, y: -10, width: 100, height: 100 }, 80, 80)).toEqual({ x: 0, y: 0, width: 80, height: 80 });
    expect(clampRect({ x: 0, y: 0, width: 3, height: 3 }, 80, 80)).toBeNull();
  });
  it("validates stored geometry", () => {
    expect(validateGeometry({ x: 0, y: 0, width: 10, height: 10 }, 80, 80)).toBeNull();
    expect(validateGeometry({ x: -1, y: 0, width: 10, height: 10 }, 80, 80)).toMatch(/outside/);
    expect(validateGeometry({ x: 0, y: 0, width: 0, height: 10 }, 80, 80)).toMatch(/positive/);
    expect(validateGeometry({ x: NaN, y: 0, width: 10, height: 10 }, 80, 80)).toMatch(/finite/);
  });
  it("drags handles flip-safely", () => {
    const r = dragRect({ x: 10, y: 10, width: 40, height: 40 }, "se", 5, 5);
    expect(r).toEqual({ x: 10, y: 10, width: 45, height: 45 });
    const flipped = dragRect({ x: 10, y: 10, width: 40, height: 40 }, "nw", 100, 100);
    expect(flipped.width).toBeGreaterThanOrEqual(0);
    expect(flipped.height).toBeGreaterThanOrEqual(0);
  });
});
