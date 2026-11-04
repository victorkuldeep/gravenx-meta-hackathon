import { describe, expect, it } from "vitest";
import { buildGovernanceWorkbook } from "./adrLog";
import { newDecision } from "./model";

describe("governance pack", () => {
  it("flattens decisions to plain text with fill-in checklists", async () => {
    const d = newDecision("Middleware owns orchestration", "ADR-042", 1);
    d.status = "accepted";
    d.context = "<p>Two buses compete.</p>";
    d.decision = "<p>Middleware wins.</p>";
    d.alternatives = [{ title: "Point to point", note: "Spaghetti" }];
    d.links = [{ surface: "system", recordId: "s1", label: "Middleware" }];
    const wb = await buildGovernanceWorkbook([d]);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["ADR Log", "NFR Checklist", "Deployment Checklist"]);
    const log = wb.getWorksheet("ADR Log")!;
    expect(log.getRow(2).values).toEqual([
      undefined, "ADR-042", "Middleware owns orchestration", "accepted",
      "Two buses compete.", "Middleware wins.", "Point to point — Spaghetti",
      "", "system: Middleware", "", new Date(1).toISOString(),
    ]);
    expect(wb.getWorksheet("NFR Checklist")!.rowCount).toBe(13);
    expect(wb.getWorksheet("Deployment Checklist")!.rowCount).toBe(9);
  });
});
