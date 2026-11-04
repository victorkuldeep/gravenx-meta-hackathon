import { describe, expect, it } from "vitest";
import { buildRiskRegisterWorkbook } from "./register";
import { findingKey } from "./proof";

describe("risk register", () => {
  it("lists findings with cited records and proof state", async () => {
    const findings = [
      { rule: "no-timeout", severity: "high" as const, message: "No timeout on ServiceNow call", refs: [{ surface: "system" as const, id: "o1", name: "POST /fulfillment" }] },
      { rule: "chain", severity: "low" as const, message: "Chain of 2", refs: [] },
    ];
    const wb = await buildRiskRegisterWorkbook("Demo", findings, new Map([[findingKey(findings[0]), "proven-live"]]));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Risk Register", "NFR Checklist"]);
    const reg = wb.getWorksheet("Risk Register")!;
    expect(reg.getRow(2).values).toEqual([
      undefined, "high", "no-timeout", "No timeout on ServiceNow call", "POST /fulfillment (system)", "proven live",
    ]);
    expect(reg.getRow(3).getCell(5).value).toBe("unproven");
    const sum = wb.getWorksheet("Summary")!;
    expect(sum.getRow(5).values).toEqual([undefined, "High / Medium / Low", "1 / 0 / 1"]);
  });
});
