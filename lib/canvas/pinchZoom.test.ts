import { describe, expect, it } from "vitest";
import {
  DEFAULT_PINCH_AMPLIFICATION,
  DEFAULT_WHEEL_COEFFICIENT,
  NATIVE_WHEEL_COEFFICIENT,
  scaleForTouchRatio,
  scaleForWheelDelta,
  zoomAtPoint,
} from "./pinchZoom";

describe("pinch zoom feel factors", () => {
  it("pins the amplified defaults (touch 4x exponent, wheel 4x coefficient)", () => {
    expect(DEFAULT_PINCH_AMPLIFICATION).toBe(4);
    expect(DEFAULT_WHEEL_COEFFICIENT).toBe(NATIVE_WHEEL_COEFFICIENT * 4);
  });

  it("touch scale is identity at ratio 1 and stronger than the old 2x feel", () => {
    expect(scaleForTouchRatio(1, DEFAULT_PINCH_AMPLIFICATION)).toBe(1);
    const ratio = 1.1; // a small spread
    expect(scaleForTouchRatio(ratio, DEFAULT_PINCH_AMPLIFICATION)).toBeGreaterThan(
      scaleForTouchRatio(ratio, 2),
    );
  });

  it("trackpad scroll-up zooms in and scroll-down zooms out", () => {
    expect(scaleForWheelDelta(-50, DEFAULT_WHEEL_COEFFICIENT)).toBeGreaterThan(1);
    expect(scaleForWheelDelta(50, DEFAULT_WHEEL_COEFFICIENT)).toBeLessThan(1);
    expect(scaleForWheelDelta(0, DEFAULT_WHEEL_COEFFICIENT)).toBe(1);
  });

  it("keeps the anchor point fixed and clamps to bounds", () => {
    const vp = { x: 100, y: 80, zoom: 1 };
    const next = zoomAtPoint(vp, 200, 160, 2, 0.15, 4);
    expect(next.zoom).toBe(2);
    // The world point under the anchor is unchanged by the zoom.
    expect((200 - next.x) / next.zoom).toBe((200 - vp.x) / vp.zoom);
    expect((160 - next.y) / next.zoom).toBe((160 - vp.y) / vp.zoom);
    expect(zoomAtPoint(vp, 200, 160, 99, 0.15, 4).zoom).toBe(4);
    expect(zoomAtPoint(vp, 200, 160, 0.001, 0.15, 4).zoom).toBe(0.15);
  });
});
