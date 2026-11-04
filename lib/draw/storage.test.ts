import { describe, expect, it } from "vitest";
import { parseStoredScene, slimSceneJson } from "./storage";

const SCENE = JSON.stringify({
  type: "excalidraw",
  elements: [{ id: "a", type: "rectangle" }],
  appState: { viewBackgroundColor: "#fff" },
});

describe("draw reload-safety", () => {
  it("parses a saved scene", () => {
    const scene = parseStoredScene(SCENE);
    expect(scene?.elements).toHaveLength(1);
    expect(scene?.appState?.viewBackgroundColor).toBe("#fff");
  });

  it("treats corrupt or foreign data as a blank canvas", () => {
    expect(parseStoredScene(null)).toBeNull();
    expect(parseStoredScene("")).toBeNull();
    expect(parseStoredScene("not json")).toBeNull();
    expect(parseStoredScene(JSON.stringify({ type: "excalidraw" }))).toBeNull();
    expect(parseStoredScene(JSON.stringify({ elements: "nope" }))).toBeNull();
    expect(parseStoredScene(JSON.stringify({ elements: [], appState: 42 }))).toBeNull();
  });

  it("slims a scene by dropping embedded files", () => {
    const withFiles = JSON.stringify({ ...JSON.parse(SCENE), files: { img: "data:..." } });
    const slimmed = parseStoredScene(slimSceneJson(withFiles));
    expect(slimmed?.elements).toHaveLength(1);
    expect(slimmed?.files).toBeUndefined();
    // Slimming garbage throws - callers only slim what they just stringified.
    expect(() => slimSceneJson("nope")).toThrow();
  });
});
