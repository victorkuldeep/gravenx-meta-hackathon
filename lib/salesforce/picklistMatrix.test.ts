import { describe, expect, it } from "vitest";
import { buildPicklistMatrixWorkbook } from "./picklistMatrix";

describe("picklist matrix", () => {
  it("marks per-RT availability with master showing everything", async () => {
    const wb = await buildPicklistMatrixWorkbook(
      "Account",
      [{ label: "Industry", apiName: "Industry", values: [{ label: "Tech", value: "Tech" }, { label: "Bank", value: "Bank" }] }],
      [
        { id: "012000000000000AAA", name: "Master", developerName: "Master", master: true, available: new Map() },
        { id: "012xx", name: "Customer", developerName: "Customer", master: false, available: new Map([["industry", ["Tech"]]]) },
      ],
    );
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Account Matrix", "Record Types"]);
    const m = wb.getWorksheet("Account Matrix")!;
    expect(m.getRow(1).values).toEqual([undefined, "Field Label", "Field API", "Label", "Value", "Master", "Customer"]);
    expect(m.getRow(2).values).toEqual([undefined, "Industry", "Industry", "Tech", "Tech", "✓", "✓"]);
    expect(m.getRow(3).values).toEqual([undefined, "Industry", "Industry", "Bank", "Bank", "✓", ""]);
    const r = wb.getWorksheet("Record Types")!;
    expect(r.getRow(2).values).toEqual([undefined, "Master", "Master", "012000000000000AAA", "yes"]);
  });
});
