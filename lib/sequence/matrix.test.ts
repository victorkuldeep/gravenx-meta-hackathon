import { describe, expect, it } from "vitest";
import { buildSequenceMatrixWorkbook, flattenSequence } from "./matrix";
import { newSequence } from "./model";

describe("sequence matrix", () => {
  const doc = () => {
    const d = newSequence("Order Create");
    d.participants = [
      { id: "p1", name: "Salesforce", kind: "system" },
      { id: "p2", name: "Middleware", kind: "system", systemRef: "ZSP" },
    ];
    d.nodes = [
      { nodeType: "message", id: "m1", from: "p1", to: "p2", label: "Create Order", kind: "sync", timeoutSecs: 30 },
      {
        nodeType: "block", id: "b1", type: "loop", title: "each line", children: [
          { nodeType: "message", id: "m2", from: "p2", to: "p1", label: "Line accepted", kind: "response", retry: { attempts: 3, waitSecs: 5 } },
        ],
      },
    ];
    return d;
  };

  it("flattens document order with block paths", () => {
    const flat = flattenSequence(doc());
    expect(flat.map((f) => [f.message.id, f.path])).toEqual([["m1", ""], ["m2", "loop: each line"]]);
  });

  it("resolves participant names with retry and timeout columns", async () => {
    const wb = await buildSequenceMatrixWorkbook(doc());
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Participants", "Messages"]);
    const msgs = wb.getWorksheet("Messages")!;
    expect(msgs.getRow(2).values).toEqual([undefined, 1, "Salesforce", "Middleware", "sync", "Create Order", "", 30, "", "", ""]);
    expect(msgs.getRow(3).values).toEqual([undefined, 2, "Middleware", "Salesforce", "response", "Line accepted", "3x / 5s", "", "", "loop: each line", ""]);
    const parts = wb.getWorksheet("Participants")!;
    expect(parts.getRow(3).values).toEqual([undefined, "Middleware", "system", "ZSP"]);
  });
});
