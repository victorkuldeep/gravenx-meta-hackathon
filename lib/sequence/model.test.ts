import { describe, expect, it } from "vitest";
import {
  canTransition,
  messageCount,
  newSequence,
  renameSequence,
  resolveParticipant,
  SequenceSchema,
  validateSequence,
  type SequenceDocument,
} from "./model";

function doc(): SequenceDocument {
  return {
    ...newSequence("Order flow"),
    participants: [
      { id: "p1", name: "Salesforce", kind: "system" },
      { id: "p2", name: "Middleware", kind: "system" },
    ],
    nodes: [
      { nodeType: "message", id: "m1", from: "p1", to: "p2", label: "Create Order", kind: "sync" },
      {
        nodeType: "block", id: "b1", type: "loop", title: "each line", iterator: "order.lines",
        children: [{ nodeType: "message", id: "m2", from: "p2", to: "p1", label: "Line Ack", kind: "response" }],
      },
    ],
  };
}

describe("sequence model", () => {
  it("round-trips through the zod schema", () => {
    expect(SequenceSchema.parse(doc()).name).toBe("Order flow");
  });

  it("renames and transitions like the studio pattern", () => {
    const d = doc();
    expect(renameSequence(d, "  ") ).toBeNull();
    expect(renameSequence(d, "Order flow")).toBeNull();
    expect(renameSequence(d, "Billing flow")?.name).toBe("Billing flow");
    expect(canTransition("draft", "in-review")).toBe(true);
    expect(canTransition("draft", "approved")).toBe(false);
  });

  it("resolves participants by id or name", () => {
    const d = doc();
    expect(resolveParticipant(d, "p1")?.name).toBe("Salesforce");
    expect(resolveParticipant(d, "middleware")?.id).toBe("p2");
    expect(resolveParticipant(d, "Nope")).toBeNull();
  });

  it("counts messages recursively and validates structure", () => {
    const d = doc();
    expect(messageCount(d.nodes)).toBe(2);
    expect(validateSequence(d)).toEqual([]);
    const bad: SequenceDocument = {
      ...d,
      participants: [...d.participants, { id: "p3", name: "middleware", kind: "service" }],
      nodes: [
        { nodeType: "message", id: "m9", from: "ghost", to: "p1", label: "", kind: "async" },
        { nodeType: "block", id: "b9", type: "retry", title: "", children: [] },
      ],
    };
    const problems = validateSequence(bad);
    expect(problems.join("\n")).toMatch(/Duplicate participant/);
    expect(problems.join("\n")).toMatch(/unknown source/);
    expect(problems.join("\n")).toMatch(/no label/);
    expect(problems.join("\n")).toMatch(/is empty/);
  });
});
