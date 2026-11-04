import { describe, expect, it } from "vitest";
import { buildImpactWorkbook } from "./impactExcel";

describe("impact export", () => {
  it("flattens groups and dangling refs into sheets", async () => {
    const wb = await buildImpactWorkbook({
      target: { key: "schema:Account", kind: "schema-object", surface: "schema", name: "Account" },
      groups: [
        {
          surface: "system", label: "System", href: "/system",
          hits: [
            { node: { key: "system:p1", kind: "project", surface: "system", name: "Middleware" }, via: { from: "system:p1", to: "schema:Account", kind: "links", resolution: "id" } },
          ],
        },
      ],
      total: 1,
      dangling: [{ from: "x", surface: "sequence", raw: "Account", name: "Old Account ref" }],
    });
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "References", "Dangling"]);
    const refs = wb.getWorksheet("References")!;
    expect(refs.getRow(2).values).toEqual([undefined, "System", "Middleware", "links", "id"]);
    const dang = wb.getWorksheet("Dangling")!;
    expect(dang.getRow(2).values).toEqual([undefined, "Old Account ref", "sequence", "Account"]);
  });
});
