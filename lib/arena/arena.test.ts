import { describe, expect, it } from "vitest";
import { MAX_DOC_BYTES, newGroundingDoc, validateGrounding } from "./grounding";
import { addRound, composeSessionContext, newSession, sessionBrief } from "./session";

describe("arena grounding", () => {
  it("caps oversized docs and validates input", () => {
    expect(validateGrounding("", "x")).toBe("Give the context a name.");
    expect(validateGrounding("n", "  ")).toContain("empty");
    const big = "x".repeat(MAX_DOC_BYTES + 1);
    expect(newGroundingDoc("big", "doc", big).content).toHaveLength(MAX_DOC_BYTES);
  });

  it("composes built-in packs with custom docs, flagging overrides", () => {
    const s = {
      ...newSession("Order sync"),
      skillIds: ["system"],
      groundingIds: ["g1", "g2"],
    };
    const packs = [{ name: "system", label: "System Design", system: "SYS" }];
    const docs = [
      { id: "g1", name: "System", kind: "skill" as const, content: "OURS", enabled: true, createdAt: 0, updatedAt: 0 },
      { id: "g2", name: "Acme framework", kind: "framework" as const, content: "FW", enabled: true, createdAt: 0, updatedAt: 0 },
    ];
    const ctx = composeSessionContext(s, packs, docs);
    expect(ctx.sections).toHaveLength(3);
    expect(ctx.overrides).toEqual(["System"]);
    expect(ctx.totalBytes).toBeGreaterThan(0);
  });

  it("logs rounds and builds a handoff brief", () => {
    let s = newSession("Dup orders");
    s = addRound(s, "problem", "Duplicates on retry.");
    s = addRound(s, "decision", "Add idempotency key.");
    expect(s.status).toBe("discussing");
    expect(addRound(s, "note", "  ")).toBe(s);
    const brief = sessionBrief({ ...s, jiraRef: "JIRA-1", artifacts: [{ kind: "adr", ref: "ADR-3", label: "Idempotency" }] }, ["System Design"]);
    expect(brief).toContain("JIRA-1");
    expect(brief).toContain("ADR-3");
  });
});
