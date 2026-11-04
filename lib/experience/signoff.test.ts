import { describe, expect, it } from "vitest";
import { buildSignoffWorkbook } from "./signoff";
import { blankExperienceModule } from "./types";

describe("screen sign-off", () => {
  it("lists screens with contracts, counts, and blank approval columns", async () => {
    const exp = blankExperienceModule("e", "2026-01-01");
    exp.screens = [
      { id: "s1", name: "List", route: "/list", endpoint: "GET /x", feature: "Browse", journeyIds: [], userRole: "Agent", deviceContext: "desktop", canvas: { sourceWidth: 0, sourceHeight: 0, aspectRatio: 0 }, componentIds: [], actionIds: [], bindingIds: [], status: "draft", tags: [], createdAt: "t", updatedAt: "t" },
    ];
    exp.components = [
      { id: "c1", screenId: "s1", name: "Grid", componentType: "table", requirementIds: [], bindingIds: [], actionIds: [], stateIds: [], status: "draft", tags: [], createdAt: "t", updatedAt: "t" },
    ];
    const wb = await buildSignoffWorkbook("Demo", exp);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Screens", "Components"]);
    const screens = wb.getWorksheet("Screens")!;
    expect(screens.getRow(2).values).toEqual([
      undefined, "List", "/list", "GET /x", "Browse", "Agent", "desktop", "draft", 1, "", "", "",
    ]);
    const comps = wb.getWorksheet("Components")!;
    expect(comps.getRow(2).values).toEqual([undefined, "Grid", "List", "table", "", "draft"]);
  });
});
