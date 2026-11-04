import { describe, expect, it } from "vitest";
import {
  canTransition,
  decisionSchema,
  linkDecision,
  newDecision,
  nextDecisionNumber,
  transitionDecision,
  unlinkDecision,
} from "./model";

describe("decisions model", () => {
  it("creates proposed decisions with history", () => {
    const d = newDecision("Middleware owns orchestration", "ADR-042", 1000);
    expect(d.status).toBe("proposed");
    expect(d.number).toBe("ADR-042");
    expect(d.history).toEqual([{ at: 1000, what: "Proposed." }]);
    expect(decisionSchema.safeParse(d).success).toBe(true);
  });

  it("walks the lifecycle and rejects jumps", () => {
    expect(canTransition("proposed", "in-review")).toBe(true);
    expect(canTransition("proposed", "accepted")).toBe(false);
    expect(canTransition("in-review", "accepted")).toBe(true);
    expect(canTransition("in-review", "proposed")).toBe(true);
    expect(canTransition("accepted", "superseded")).toBe(true);
    expect(canTransition("superseded", "proposed")).toBe(false);
    const moved = transitionDecision(newDecision("X", "ADR-001", 1), "in-review", 2);
    expect(moved.status).toBe("in-review");
    expect(moved.history).toHaveLength(2);
    const stuck = transitionDecision(moved, "superseded", 3);
    expect(stuck.status).toBe("in-review");
  });

  it("links records once and unlinks cleanly", () => {
    const d = newDecision("X", "ADR-001", 1);
    const link = { surface: "system" as const, recordId: "p1", label: "Ordering topology" };
    const linked = linkDecision(d, link, 2);
    expect(linked.links).toHaveLength(1);
    expect(linkDecision(linked, link, 3).links).toHaveLength(1);
    expect(linkDecision(linked, link, 3).history).toHaveLength(2);
    const unlinked = unlinkDecision(linked, "system", "p1", 4);
    expect(unlinked.links).toHaveLength(0);
    expect(unlinkDecision(unlinked, "system", "p1", 5).history).toHaveLength(3);
  });

  it("numbers sequentially and rejects bad payloads", () => {
    expect(nextDecisionNumber([])).toBe("ADR-001");
    expect(nextDecisionNumber([{ number: "ADR-007" }, { number: "ADR-042" }])).toBe("ADR-043");
    const d = newDecision("X", "ADR-001", 1);
    expect(decisionSchema.safeParse({ ...d, status: "archived" }).success).toBe(false);
    expect(decisionSchema.safeParse({ ...d, number: "42" }).success).toBe(false);
    expect(
      decisionSchema.safeParse({ ...d, links: [{ surface: "figma", recordId: "1", label: "x" }] }).success,
    ).toBe(false);
  });

  it("keeps every model output inside the save gate", () => {
    // saveDecision runs decisionSchema.parse before put: anything the model
    // hands it must validate, or the write is silently dropped (blank on reload).
    const fresh = newDecision("Middleware owns orchestration", nextDecisionNumber([]), 1000);
    expect(decisionSchema.safeParse(fresh).success).toBe(true);
    const moved = transitionDecision(fresh, "in-review", 1001);
    expect(decisionSchema.safeParse(moved).success).toBe(true);
    const linked = linkDecision(
      moved,
      { surface: "system", recordId: "p1", label: "Ordering topology" },
      1002,
    );
    expect(decisionSchema.safeParse(linked).success).toBe(true);
    expect(decisionSchema.safeParse(unlinkDecision(linked, "system", "p1", 1003)).success).toBe(true);
    // Rich-text HTML at the route's slice caps must still validate.
    const html = `<p>${"Decision text. ".repeat(1200)}</p>`;
    const edited: typeof fresh = {
      ...linked,
      context: "<p>Why.</p>".slice(0, 8000),
      decision: html.slice(0, 20000),
      consequences: "<ul><li>Trade-off.</li></ul>",
    };
    expect(decisionSchema.safeParse(edited).success).toBe(true);
    expect(decisionSchema.safeParse({ ...edited, decision: `${html}X${html}` }).success).toBe(false);
  });
});
