import { describe, expect, it } from "vitest";
import { buildQueryResultWorkbook } from "./export";

describe("query result export", () => {
  it("covers the run and the full grid", async () => {
    const wb = await buildQueryResultWorkbook({
      columns: ["Id", "Name"],
      rows: [["001x", "Acme"]],
      totalSize: 1,
      truncated: false,
      timeMs: 42,
      query: "SELECT Id, Name FROM Account",
      mode: "soql",
    });
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Run", "Results"]);
    expect(wb.getWorksheet("Results")!.getRow(2).values).toEqual([undefined, "001x", "Acme"]);
    expect(wb.getWorksheet("Run")!.getRow(3).values).toEqual([undefined, "Query", "SELECT Id, Name FROM Account"]);
  });
});
