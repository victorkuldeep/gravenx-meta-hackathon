import { describe, expect, it } from "vitest";
import { BLOCK_GAP, blockTitle, layoutSequence } from "./layout";
import type { SeqNode } from "./model";

const participants = [
  { id: "p1", name: "Salesforce", kind: "system" as const },
  { id: "p2", name: "Middleware", kind: "system" as const },
  { id: "p3", name: "ServiceNow", kind: "system" as const },
];

function msg(id: string, from: string, to: string, label: string, kind: "sync" | "response" | "async" = "sync"): SeqNode {
  return { nodeType: "message", id, from, to, label, kind };
}

describe("layoutSequence", () => {
  it("columns participants and rows messages", () => {
    const l = layoutSequence(participants, [msg("m1", "p1", "p2", "Create Order"), msg("m2", "p2", "p1", "Accepted", "response")]);
    expect(l.columns.map((c) => c.x)).toEqual([150, 370, 590]);
    expect(l.rows.map((r) => r.kind)).toEqual(["message", "message"]);
    expect(l.rows[1].y).toBeGreaterThan(l.rows[0].y);
    expect(l.height).toBeGreaterThan(l.rows[1].y);
  });

  it("frames loops and nests depth", () => {
    const l = layoutSequence(participants, [
      {
        nodeType: "block", id: "b1", type: "loop", title: "", iterator: "order.lines",
        children: [msg("m1", "p2", "p3", "Create Line"), {
          nodeType: "block", id: "b2", type: "retry", title: "", attempts: 3,
          children: [msg("m2", "p2", "p3", "Retry Line")],
        }],
      },
    ]);
    const kinds = l.rows.map((r) => r.kind);
    expect(kinds).toEqual(["block-start", "message", "block-start", "message", "block-end", "block-end"]);
    const outer = l.frames.find((f) => f.id === "b1")!;
    const inner = l.frames.find((f) => f.id === "b2")!;
    expect(inner.depth).toBe(1);
    expect(outer.y0).toBeLessThan(inner.y0);
    expect(outer.y1).toBeGreaterThan(inner.y1);
  });

  it("lays out condition else-branches", () => {
    const l = layoutSequence(participants, [
      {
        nodeType: "block", id: "b1", type: "condition", title: "", condition: "Serviceable",
        children: [msg("m1", "p2", "p3", "Create Fulfillment")],
        elseChildren: [msg("m2", "p2", "p1", "Mark Exception")],
      },
    ]);
    expect(l.rows.map((r) => r.kind)).toEqual(["block-start", "message", "block-else", "message", "block-end"]);
  });

  it("handles an empty document", () => {
    const l = layoutSequence([], []);
    expect(l.rows).toEqual([]);
    expect(l.height).toBeGreaterThan(0);
  });

  it("leaves breathing room between sibling blocks and flags empties", () => {
    const empty = (id: string): SeqNode => ({ nodeType: "block", id, type: "parallel", title: "", children: [] });
    const l = layoutSequence(participants, [empty("b1"), empty("b2")]);
    const [f1, f2] = l.frames;
    expect(f1.empty).toBe(true);
    expect(f2.empty).toBe(true);
    expect(f2.y0 - f1.y1).toBe(BLOCK_GAP);
    const full = layoutSequence(participants, [
      { nodeType: "block", id: "b3", type: "loop", title: "", iterator: "lines", children: [msg("m1", "p1", "p2", "Hi")] },
    ]);
    expect(full.frames[0].empty).toBe(false);
  });
});

describe("blockTitle", () => {
  it("labels each block type", () => {
    expect(blockTitle({ nodeType: "block", id: "x", type: "loop", title: "", iterator: "lines", children: [] })).toBe("LOOP: lines");
    expect(blockTitle({ nodeType: "block", id: "x", type: "loop", title: "retry failed", iterator: "lines", children: [] })).toBe(
      "LOOP: lines - retry failed",
    );
    expect(blockTitle({ nodeType: "block", id: "x", type: "retry", title: "", attempts: 3, children: [] })).toBe("RETRY 3×");
    expect(blockTitle({ nodeType: "block", id: "x", type: "parallel", title: "", children: [] })).toBe("PARALLEL");
  });
});
