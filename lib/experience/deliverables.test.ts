import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { blankProject } from "../mapping/types";
import { apiCatalogCsv, buildExperienceWorkbook, buildWordPack, screenApiMatrixCsv, screenApiMatrixTsv } from "./deliverables";
import { blankApiCatalog, blankExperienceModule } from "./types";

function project() {
  const p = blankProject({ id: "p1", name: "Demo, Inc.", now: "2026-01-01" });
  const exp = blankExperienceModule("e", "2026-01-01");
  exp.screens = [
    { id: "s1", name: "List", journeyIds: [], canvas: { sourceWidth: 0, sourceHeight: 0, aspectRatio: 0 }, componentIds: [], actionIds: [], bindingIds: [], status: "draft", tags: [], createdAt: "t", updatedAt: "t" },
  ];
  p.experience = exp;
  const cat = blankApiCatalog("a", "2026-01-01");
  cat.operations = [
    { id: "o1", operationKey: "GET /x", name: 'Get "quoted"', method: "GET", path: "/x", layer: "bff", errorContractIds: [], dependencyIds: [], lifecycle: "existing", status: "confirmed", tags: [], createdAt: "t", updatedAt: "t" },
  ];
  p.apiCatalog = cat;
  return p;
}

describe("deliverables", () => {
  it("builds a Word pack buffer", async () => {
    const blob = await buildWordPack(project(), async () => null);
    expect(blob.size).toBeGreaterThan(1000);
    expect(blob.type).toContain("wordprocessingml");
  });

  it("builds the 13-sheet workbook", async () => {
    const names = [
      "Summary", "Screens", "Journeys", "Components", "API Bindings", "API Catalog",
      "Data Requirements", "Backend Dependencies", "Integration References",
      "Decisions", "Assumptions", "Coverage Findings", "Change Log",
    ];
    const wb = await buildExperienceWorkbook(project());
    expect(wb.worksheets.map((w) => w.name)).toEqual(names);
    const buf = await wb.xlsx.writeBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000);
    // Round-trip: the bytes parse back into the same 13 sheets.
    const round = new ExcelJS.Workbook();
    await round.xlsx.load(buf);
    expect(round.worksheets.map((w) => w.name)).toEqual(names);
  });

  it("escapes CSV commas and quotes", () => {
    const csv = apiCatalogCsv(project());
    expect(csv.split("\n")[1]).toContain('"Get ""quoted"""');
  });

  it("produces tab-separated matrix rows", () => {
    const p = project();
    p.experience!.bindings = [
      { id: "b1", screenId: "s1", componentId: undefined, operationId: "o1", usage: "read", trigger: "screen-load", requestRequirementIds: [], responseRequirementIds: [], stateIds: [], status: "proposed", createdAt: "t", updatedAt: "t" },
    ];
    const { text, count } = screenApiMatrixTsv(p);
    expect(count).toBe(1);
    expect(text.split("\n")[1].split("\t")).toHaveLength(9);
    expect(screenApiMatrixCsv(p).split("\n")).toHaveLength(2);
  });
});
