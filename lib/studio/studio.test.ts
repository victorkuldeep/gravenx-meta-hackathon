import { describe, expect, it } from "vitest";
import { blankProject } from "../mapping/types";
import { blankStudio } from "./types";
import { toStudioSummary } from "./store";
import { attachMapping, detachMapping, upgradeToWorkspace } from "./upgrade";
import { blankApiCatalog, blankExperienceModule } from "../experience/types";

describe("studio workspace", () => {
  it("creates a root umbrella", () => {
    const ws = blankStudio({ id: "w1", name: "Accenture", customer: "Accenture", now: "2026-01-01" });
    expect(toStudioSummary(ws)).toMatchObject({ mappingCount: 0, screenCount: 0 });
  });

  it("upgrades a standalone mapping without data loss", () => {
    const p = blankProject({ id: "m1", name: "TMF622", now: "2026-01-01" });
    p.experience = blankExperienceModule("e", "2026-01-01");
    p.experience.screens = [{ id: "s1", name: "S", journeyIds: [], canvas: { sourceWidth: 0, sourceHeight: 0, aspectRatio: 0 }, componentIds: [], actionIds: [], bindingIds: [], status: "draft", tags: [], createdAt: "t", updatedAt: "t" }];
    p.apiCatalog = blankApiCatalog("a", "2026-01-01");
    p.mappings = [{ id: "row1", sourcePath: "$.a", planId: null, objectName: "Order", fieldName: "Status", kind: "direct", status: "mapped", updatedAt: "t" }];

    const { root, child } = upgradeToWorkspace(p, "2026-02-01");
    // Root owns experience + catalog.
    expect(root.mappingIds).toEqual(["m1"]);
    expect(root.experience?.screens).toHaveLength(1);
    expect(root.apiCatalog?.id).toBe("a");
    // Child keeps payload maps, sheds workspace modules.
    expect(child.mappings).toHaveLength(1);
    expect(child.experience).toBeUndefined();
    expect(child.apiCatalog).toBeUndefined();
    expect(child.archDecisions).toBeUndefined();
  });

  it("attaches and detaches without duplicating", () => {
    const ws = blankStudio({ id: "w1", name: "W", now: "t" });
    const a = attachMapping(ws, "m1", "t");
    expect(attachMapping(a, "m1", "t").mappingIds).toEqual(["m1"]);
    expect(detachMapping(a, "m1", "t").mappingIds).toEqual([]);
  });
});
