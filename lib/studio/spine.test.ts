import { describe, expect, it } from "vitest";
import { computeSpine, SPINE_STEPS, spineMemory } from "./spine";

describe("computeSpine", () => {
  it("defines five ordered steps", () => {
    expect(SPINE_STEPS.map((s) => s.id)).toEqual(["connect", "snapshot", "map", "screen", "export"]);
  });

  it("derives completion from counts", () => {
    expect(computeSpine({ connected: false, mappings: 0, screens: 0, snapshots: 0, exported: false })).toEqual({
      connect: false, snapshot: false, map: false, screen: false, export: false,
    });
    expect(computeSpine({ connected: true, mappings: 2, screens: 1, snapshots: 1, exported: true })).toEqual({
      connect: true, snapshot: true, map: true, screen: true, export: true,
    });
  });

  it("memory degrades safely off-browser", () => {
    expect(spineMemory()).toEqual({ dismissed: false, exported: false });
  });
});
