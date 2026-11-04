import { describe, expect, it } from "vitest";
import { exportDecisions, importDecisions } from "./store";
import { newDecision } from "./model";

describe("decisions packages", () => {
  it("round-trips and never overwrites on import", () => {
    const pkg = exportDecisions([newDecision("Middleware owns orchestration", "ADR-042", 1000)]);
    expect(pkg).toContain("gravenx-decisions-package");
    const { decisions, error } = importDecisions(pkg, [{ number: "ADR-042" }], 2000);
    expect(error).toBeUndefined();
    expect(decisions).toHaveLength(1);
    // Re-numbered past the taken ADR-042, re-id'd, history appended.
    expect(decisions[0].number).toBe("ADR-043");
    expect(decisions[0].history.at(-1)).toEqual({ at: 2000, what: "Imported into Decisions." });
  });

  it("rejects garbage packages", () => {
    expect(importDecisions("nope").error).toBe("Not valid JSON.");
    expect(importDecisions("{}").error).toBe("No decisions array in this package.");
    expect(importDecisions(JSON.stringify({ decisions: [{ nope: 1 }] })).error).toBe(
      "No valid decisions in this package.",
    );
  });
});
