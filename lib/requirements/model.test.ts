import { describe, expect, it } from "vitest";
import {
  canTransition,
  linkRequirement,
  newRequirement,
  nextRequirementNumber,
  requirementSchema,
  transitionRequirement,
  unlinkRequirement,
} from "./model";

describe("requirements model", () => {
  it("creates open requirements with history", () => {
    const r = newRequirement("Customer receives order confirmation", "REQ-102", 1000);
    expect(r.status).toBe("open");
    expect(r.number).toBe("REQ-102");
    expect(r.history).toEqual([{ at: 1000, what: "Logged." }]);
    expect(requirementSchema.safeParse(r).success).toBe(true);
  });

  it("walks the lifecycle and rejects jumps", () => {
    expect(canTransition("open", "covered")).toBe(true);
    expect(canTransition("open", "verified")).toBe(false);
    expect(canTransition("covered", "verified")).toBe(true);
    expect(canTransition("covered", "open")).toBe(true);
    expect(canTransition("verified", "covered")).toBe(false);
    const moved = transitionRequirement(newRequirement("X", "REQ-001", 1), "covered", 2);
    expect(moved.status).toBe("covered");
    const stuck = transitionRequirement(moved, "open", 3);
    expect(stuck.status).toBe("open");
    const stuck2 = transitionRequirement(newRequirement("Y", "REQ-002", 1), "verified", 2);
    expect(stuck2.status).toBe("open");
  });

  it("links records once and unlinks cleanly", () => {
    const r = newRequirement("X", "REQ-001", 1);
    const link = { surface: "sequence" as const, recordId: "q1", label: "Order flow" };
    const linked = linkRequirement(r, link, 2);
    expect(linked.links).toHaveLength(1);
    expect(linkRequirement(linked, link, 3)).toBe(linked);
    expect(unlinkRequirement(linked, "sequence", "q1", 4).links).toHaveLength(0);
  });

  it("numbers sequentially and rejects bad payloads", () => {
    expect(nextRequirementNumber([])).toBe("REQ-001");
    expect(nextRequirementNumber([{ number: "REQ-009" }])).toBe("REQ-010");
    const r = newRequirement("X", "REQ-001", 1);
    expect(requirementSchema.safeParse({ ...r, status: "done" }).success).toBe(false);
    expect(requirementSchema.safeParse({ ...r, number: "102" }).success).toBe(false);
  });
});
