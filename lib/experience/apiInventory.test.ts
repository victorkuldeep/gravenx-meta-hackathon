import { describe, expect, it } from "vitest";
import { buildApiInventoryWorkbook } from "./apiInventory";
import { blankApiCatalog } from "./types";

describe("api inventory", () => {
  it("lists operations with dependencies resolved to names", async () => {
    const cat = blankApiCatalog("a", "2026-01-01");
    cat.operations = [
      { id: "o1", operationKey: "GET /x", name: "Get X", method: "GET", path: "/x", layer: "bff", owner: "Poe", version: "v2", errorContractIds: [], dependencyIds: [], lifecycle: "existing", status: "confirmed", tags: [], createdAt: "t", updatedAt: "t" },
    ];
    cat.dependencies = [
      { id: "d1", operationId: "o1", kind: "salesforce-field", reference: { objectApiName: "Account", fieldApiName: "Name" }, label: "Account name", status: "confirmed" },
    ];
    const wb = await buildApiInventoryWorkbook("Demo", cat);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Operations", "Dependencies"]);
    const ops = wb.getWorksheet("Operations")!;
    expect(ops.getRow(2).values).toEqual([
      undefined, "Get X", "GET", "/x", "bff", "Poe", "v2", "existing", "confirmed", "", "", "GET /x", "t",
    ]);
    const deps = wb.getWorksheet("Dependencies")!;
    expect(deps.getRow(2).values).toEqual([undefined, "Get X", "Account name", "salesforce-field", "Account.Name", "confirmed", ""]);
  });
});
