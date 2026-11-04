import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { blankProject } from "../mapping/types";
import { blankStudio } from "../studio/types";
import { blankExperienceModule } from "./types";
import { exportWorkspaceZip, inspectWorkspace, remapWorkspaceImport, WORKSPACE_PACKAGE_FORMAT } from "./package";

function workspace() {
  const root = blankStudio({ id: "w1", name: "Accenture", customer: "Accenture", now: "2026-01-01" });
  const exp = blankExperienceModule("e", "2026-01-01");
  exp.screens = [
    { id: "s1", name: "Lead Create", endpoint: "POST /leads", payloadMappingId: "m1", journeyIds: [], canvas: { sourceWidth: 0, sourceHeight: 0, aspectRatio: 0 }, componentIds: [], actionIds: [], bindingIds: [], status: "draft", tags: [], createdAt: "t", updatedAt: "t" },
  ];
  root.experience = exp;
  root.mappingIds = ["m1"];
  const child = blankProject({ id: "m1", name: "TMF622", now: "2026-01-01" });
  child.mappings = [
    { id: "row1", sourcePath: "$.a", planId: null, objectName: "Order", fieldName: "Status", kind: "direct", status: "mapped", updatedAt: "t" },
  ];
  return { root, children: [child] };
}

describe("workspace package", () => {
  it("round-trips root + children + screen payload links", async () => {
    const { root, children } = workspace();
    const { blob, summary } = await exportWorkspaceZip(root, children, async () => null);
    expect(summary.mappings).toBe(1);
    expect(blob.size).toBeGreaterThan(0);
    const inspected = await inspectWorkspace(blob);
    expect(inspected.ok).toBe(true);
    expect(inspected.manifest?.format).toBe(WORKSPACE_PACKAGE_FORMAT);
    expect(inspected.root?.name).toBe("Accenture");
    expect(inspected.mappings).toHaveLength(1);
    expect(inspected.root?.experience?.screens[0].payloadMappingId).toBe("m1");
  });

  it("embeds images and warns on missing ones", async () => {
    const { root, children } = workspace();
    root.experience!.assets = [
      { id: "a1", screenId: "s1", fileName: "s.png", mimeType: "image/png", byteSize: 4, width: 10, height: 10, storageKey: "key-1", thumbnailStorageKey: "key-1-thumb", createdAt: "t" },
    ];
    const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    const { blob } = await exportWorkspaceZip(root, children, async (k) => (k === "key-1" || k === "key-1-thumb" ? png : null));
    const inspected = await inspectWorkspace(blob);
    expect(inspected.ok).toBe(true);
    expect(inspected.manifest?.assets).toHaveLength(1);
  });

  it("remaps record ids on import, preserving payload links", () => {
    const { root, children } = workspace();
    const { root: r2, mappings: m2 } = remapWorkspaceImport(root, children);
    expect(r2.id).not.toBe("w1");
    expect(m2[0].id).not.toBe("m1");
    expect(r2.mappingIds).toEqual([m2[0].id]);
    // Screen payload link follows the mapping to its new id.
    expect(r2.experience?.screens[0].payloadMappingId).toBe(m2[0].id);
    // Row ids preserved so dependency references stay valid.
    expect(m2[0].mappings[0].id).toBe("row1");
  });

  it("bundles linked wireframes and rewrites refs on import", async () => {
    const { root, children } = workspace();
    root.experience!.screens[0].wireframeRef = { experienceId: "exp1", screenId: "w1" };
    const wireframes = [
      { id: "exp1", name: "Portal", version: 1, schemaVersion: 1, status: "draft", screens: [{ id: "w1", name: "Lead form", viewport: { width: 390, height: 844 }, position: { x: 0, y: 0 } }], components: [{ id: "c9", kind: "input", parentId: "w1", label: "Email", props: {} }], journeys: [], proposedFields: [], createdAt: 1, updatedAt: 1 },
    ];
    const { blob, summary } = await exportWorkspaceZip(root, children, async () => null, wireframes as never);
    expect(summary.wireframes).toBe(1);
    const inspected = await inspectWorkspace(blob);
    expect(inspected.ok).toBe(true);
    expect(inspected.wireframes).toHaveLength(1);
    const remapped = remapWorkspaceImport(inspected.root!, inspected.mappings!, inspected.wireframes!);
    expect(remapped.wireframes[0].id).not.toBe("exp1");
    // Ref follows the wireframe + screen to fresh ids, components follow their screen.
    const ref = remapped.root.experience!.screens[0].wireframeRef!;
    expect(ref.experienceId).toBe(remapped.wireframes[0].id);
    expect(ref.screenId).toBe(remapped.wireframes[0].screens[0].id);
    expect(remapped.wireframes[0].components[0].parentId).toBe(ref.screenId);
  });

  it("rejects traversal entries and non-packages", async () => {
    const zip = new JSZip();
    zip.file("../evil.txt", "x");
    expect((await inspectWorkspace(await zip.generateAsync({ type: "blob" }))).ok).toBe(false);
    expect((await inspectWorkspace(new Blob(["nope"], { type: "application/zip" }))).ok).toBe(false);
  });
});
