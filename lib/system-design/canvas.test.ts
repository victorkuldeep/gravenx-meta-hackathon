import { describe, expect, it } from "vitest";

import { isPastesableImage } from "./blobStore";
import {
  CANVAS_NOTE_TEXT_MAX,
  coerceCanvasGroups,
  coerceCanvasImages,
  coerceCanvasNotes,
  pruneCanvasGroups,
  validateProject,
} from "./model";

const vintageBase = {
  id: "p1",
  name: "P",
  schemaVersion: 1,
  updatedAt: 1,
  systems: [],
  connections: [],
};

describe("canvas sticky notes", () => {
  it("defaults vintage records to no notes or images", () => {
    const { project, issues } = validateProject({ ...vintageBase });
    expect(issues).toEqual([]);
    expect(project?.canvasNotes).toEqual([]);
    expect(project?.canvasImages).toEqual([]);
  });

  it("keeps valid notes, drops junk, dedupes, truncates", () => {
    const big = "x".repeat(CANVAS_NOTE_TEXT_MAX + 50);
    const out = coerceCanvasNotes([
      { id: "n1", position: { x: 10, y: 20 }, text: "hello", createdAt: 5, updatedAt: 6 },
      { id: "n1", position: { x: 0, y: 0 }, text: "dup" },
      { id: "", position: { x: 0, y: 0 }, text: "no id" },
      { id: "n2", position: { x: NaN, y: 0 }, text: "bad pos" },
      { id: "n3", position: { x: 0, y: 0 }, text: 42 },
      { id: "n4", position: { x: 1, y: 2 }, text: big },
      null,
    ]);
    expect(out.map((n) => n.id)).toEqual(["n1", "n4"]);
    expect(out[0]).toMatchObject({ position: { x: 10, y: 20 }, text: "hello", createdAt: 5, updatedAt: 6 });
    expect(out[1].text).toHaveLength(CANVAS_NOTE_TEXT_MAX);
    expect(out[1].createdAt).toBeGreaterThan(0);
  });
});

describe("canvas pasted images", () => {
  it("keeps valid image metadata, drops junk, clamps dimensions", () => {
    const good = { id: "i1", position: { x: 0, y: 0 }, width: 800, height: 600, blobId: "blob_1", name: "shot.png", createdAt: 7 };
    const out = coerceCanvasImages([
      good,
      { ...good, id: "i2", blobId: "" },
      { ...good, id: "i3", width: 4, height: 600 },
      { ...good, id: "i4", width: 9000, height: 9000 },
      { ...good, id: "i1", width: 10, height: 10 },
    ]);
    expect(out.map((i) => i.id)).toEqual(["i1", "i4"]);
    expect(out[0]).toMatchObject({ blobId: "blob_1", name: "shot.png", createdAt: 7 });
    expect(out[1]).toMatchObject({ width: 4000, height: 4000 });
  });

  it("round-trips through validation with metadata only", () => {
    const { project, issues } = validateProject({
      ...vintageBase,
      canvasImages: [
        { id: "i1", position: { x: 3, y: 4 }, width: 320, height: 200, blobId: "blob_9", name: "a.png", createdAt: 1 },
      ],
    });
    expect(issues).toEqual([]);
    expect(project?.canvasImages).toHaveLength(1);
    expect(project?.canvasImages[0]).toMatchObject({ blobId: "blob_9", width: 320, height: 200 });
  });
});

describe("canvas groups", () => {
  it("defaults vintage records to no groups", () => {
    const { project, issues } = validateProject({ ...vintageBase });
    expect(issues).toEqual([]);
    expect(project?.groups).toEqual([]);
  });

  it("coerces shape, dedupes members, drops empties", () => {
    const out = coerceCanvasGroups([
      { id: "g1", memberIds: ["a", "b", "a"] },
      { id: "g1", memberIds: ["c"] },
      { id: "", memberIds: ["a"] },
      { id: "g2", memberIds: [] },
      { id: "g3", memberIds: "nope" },
      null,
    ]);
    expect(out).toEqual([{ id: "g1", memberIds: ["a", "b"] }]);
  });

  it("prunes ghosts and collapses sub-pair groups", () => {
    const base = {
      systems: [{ id: "s1" }, { id: "s2" }],
      canvasNotes: [{ id: "n1" }],
      canvasImages: [],
      groups: [
        { id: "g1", memberIds: ["s1", "s2"] },
        { id: "g2", memberIds: ["s1", "ghost"] },
        { id: "g3", memberIds: ["ghost", "gone"] },
      ],
    } as unknown as Parameters<typeof pruneCanvasGroups>[0];
    const pruned = pruneCanvasGroups(base);
    expect(pruned.groups).toEqual([{ id: "g1", memberIds: ["s1", "s2"] }]);
    // Nothing to prune -> same reference back.
    expect(pruneCanvasGroups(pruned)).toBe(pruned);
  });
});

describe("paste gate", () => {
  it("accepts supported images under the cap, rejects the rest", () => {
    expect(isPastesableImage({ type: "image/png", size: 1024 })).toBe(true);
    expect(isPastesableImage({ type: "image/webp", size: 8 * 1024 * 1024 })).toBe(true);
    expect(isPastesableImage({ type: "image/png", size: 8 * 1024 * 1024 + 1 })).toBe(false);
    expect(isPastesableImage({ type: "application/pdf", size: 1024 })).toBe(false);
    expect(isPastesableImage({ type: "image/png", size: 0 })).toBe(false);
    expect(isPastesableImage(null)).toBe(false);
    expect(isPastesableImage(undefined)).toBe(false);
  });
});
