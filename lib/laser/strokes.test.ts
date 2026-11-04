import { describe, expect, it } from "vitest";
import {
  LASER_FADE_MS,
  LASER_HOLD_MS,
  LASER_LIFETIME_MS,
  LASER_MAX_PTS,
  appendPoint,
  opacityForAge,
} from "./strokes";

describe("appendPoint", () => {
  it("grows until the cap, then slides the window", () => {
    let pts = appendPoint([], { x: 0, y: 0 });
    expect(pts).toHaveLength(1);
    for (let i = 1; i <= LASER_MAX_PTS + 10; i++) pts = appendPoint(pts, { x: i, y: i });
    expect(pts).toHaveLength(LASER_MAX_PTS);
    expect(pts[0]).toEqual({ x: 11, y: 11 });
    expect(pts[pts.length - 1]).toEqual({ x: LASER_MAX_PTS + 10, y: LASER_MAX_PTS + 10 });
  });

  it("honours a custom cap", () => {
    const pts = appendPoint(
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      { x: 2, y: 2 },
      2
    );
    expect(pts).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });
});

describe("opacityForAge", () => {
  it("holds full, melts linear, then stays gone", () => {
    expect(LASER_LIFETIME_MS).toBe(LASER_HOLD_MS + LASER_FADE_MS);
    expect(opacityForAge(-5)).toBe(1);
    expect(opacityForAge(0)).toBe(1);
    expect(opacityForAge(LASER_HOLD_MS - 1)).toBe(1);
    expect(opacityForAge(LASER_HOLD_MS + LASER_FADE_MS / 2)).toBeCloseTo(0.5, 5);
    expect(opacityForAge(LASER_LIFETIME_MS - 1)).toBeGreaterThan(0);
    expect(opacityForAge(LASER_LIFETIME_MS)).toBe(0);
    expect(opacityForAge(LASER_LIFETIME_MS + 5000)).toBe(0);
  });
});
