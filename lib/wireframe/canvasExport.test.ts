import { describe, expect, it } from "vitest";
import { contentBounds, frameFor, toWorld, wirePngFileName } from "./canvasExport";

describe("contentBounds", () => {
  it("unions card rects and ignores empty ones", () => {
    expect(
      contentBounds([
        { x: 0, y: 0, width: 300, height: 400 },
        { x: 400, y: 100, width: 300, height: 200 },
        { x: 0, y: 0, width: 0, height: 0 },
      ]),
    ).toEqual({ x: 0, y: 0, width: 700, height: 400 });
  });

  it("returns null when there is nothing", () => {
    expect(contentBounds([])).toBeNull();
  });
});

describe("frameFor", () => {
  it("pads small content up to the minimum frame", () => {
    const f = frameFor({ x: 0, y: 0, width: 700, height: 400 });
    expect(f.imgW).toBe(1200);
    expect(f.imgH).toBe(800);
    expect(f.zoom).toBeLessThanOrEqual(2);
    expect(f.tx).toBe(60);
    expect(f.ty).toBe(60);
  });

  it("grows the frame for large content and offsets negative origins", () => {
    const f = frameFor({ x: -200, y: -100, width: 2000, height: 1200 });
    expect(f.imgW).toBe(2120);
    expect(f.imgH).toBe(1320);
    expect(f.tx).toBeGreaterThan(60);
    expect(f.ty).toBeGreaterThan(60);
  });
});

describe("toWorld", () => {
  it("inverts the viewport transform", () => {
    expect(toWorld({ left: 140, top: 240, width: 150, height: 200 }, { left: 0, top: 0 }, { x: 40, y: 40, k: 0.5 })).toEqual({
      x: 200,
      y: 400,
      width: 300,
      height: 400,
    });
  });
});

describe("wirePngFileName", () => {
  it("slugifies the experience and stamps the scale", () => {
    expect(wirePngFileName("Customer Portal!", 3)).toMatch(/^customer-portal-\d{8}-\d{4}@3x\.png$/);
    expect(wirePngFileName("", 2)).toMatch(/^wireframe-\d{8}-\d{4}@2x\.png$/);
  });
});
