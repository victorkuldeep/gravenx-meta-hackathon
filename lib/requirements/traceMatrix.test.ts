import { describe, expect, it } from "vitest";
import { buildTraceabilityWorkbook } from "./traceMatrix";
import { newRequirement } from "./model";

describe("traceability matrix", () => {
  it("lays requirements against per-surface links and derived coverage", async () => {
    const a = newRequirement("Order confirmation", "REQ-102", 1);
    a.links = [
      { surface: "wireframe", recordId: "w1", label: "Customer Detail" },
      { surface: "sequence", recordId: "s1", label: "Order Create" },
    ];
    const b = newRequirement("Orphaned intent", "REQ-103", 2);
    const wb = await buildTraceabilityWorkbook(
      [a, b],
      new Map([
        [a.id, { id: a.id, number: a.number, covered: true, liveLinks: 2, danglingLinks: 0 }],
        [b.id, { id: b.id, number: b.number, covered: false, liveLinks: 0, danglingLinks: 0 }],
      ]),
    );
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Traceability"]);
    const t = wb.getWorksheet("Traceability")!;
    expect(t.getRow(2).values).toEqual([
      undefined, "REQ-102", "Order confirmation", "open", "yes", 2, 0,
      "", "Customer Detail", "Order Create", "", "", "",
    ]);
    expect(t.getRow(3).getCell(4).value).toBe("no");
    const s = wb.getWorksheet("Summary")!;
    expect(s.getRow(4).values).toEqual([undefined, "Covered", 1]);
  });
});
