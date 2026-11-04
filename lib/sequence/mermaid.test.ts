import { describe, expect, it } from "vitest";
import { parseStatements } from "./dsl";
import { newSequence } from "./model";
import { mermaidToDsl, toMermaid } from "./mermaid";

const TEXT = `Salesforce -> Middleware: Create Order
Middleware ->> EventBus: OrderCreated
ServiceNow --> Middleware: 201 Created
loop each order.lines
Middleware -> ServiceNow: Create Line
end
if Serviceable
Middleware -> ServiceNow: Start
else
Middleware -> Salesforce: Fail
end
retry 3 times wait 5s
Middleware -> ServiceNow: Again
end
note Workshop cut
`;

describe("toMermaid", () => {
  it("projects messages, blocks and notes into sequenceDiagram text", () => {
    const r = parseStatements(TEXT);
    expect(r.errors).toEqual([]);
    const doc = { ...newSequence("Shop"), participants: r.participants, nodes: r.nodes };
    const mm = toMermaid(doc);
    expect(mm).toContain("sequenceDiagram");
    expect(mm).toContain("participant Salesforce");
    expect(mm).toContain("Salesforce->Middleware: Create Order");
    expect(mm).toContain("Middleware->>EventBus: OrderCreated");
    expect(mm).toContain("ServiceNow-->Middleware: 201 Created");
    expect(mm).toContain("loop order.lines");
    expect(mm).toContain("alt Serviceable");
    expect(mm).toContain("else");
    expect(mm).toContain("rect rgba");
    expect(mm).toContain("Note over");
  });
});

describe("mermaidToDsl", () => {
  it("round-trips our own export without errors", () => {
    const r = parseStatements(TEXT);
    expect(r.errors).toEqual([]);
    const doc = { ...newSequence("Shop"), participants: r.participants, nodes: r.nodes };
    const back = parseStatements(mermaidToDsl(toMermaid(doc)));
    expect(back.errors).toEqual([]);
    expect(back.participants.map((p) => p.name).sort()).toEqual(r.participants.map((p) => p.name).sort());
    const flat = (ns: typeof back.nodes): string[] => ns.flatMap((n) => n.nodeType === "message" ? [`${n.kind}:${n.label}`] : flat(n.children ?? []));
    expect(flat(back.nodes).sort()).toEqual(flat(r.nodes).sort());
  });

  it("maps arrows, blocks, aliases and retry comments", () => {
    const dsl = mermaidToDsl([
      "sequenceDiagram",
      "participant A as Alice",
      "A -> B: hi",
      "B -->> A: ok",
      "A ->> B: ping",
      "alt good",
      "A -> B: x",
      "else bad",
      "A -> B: y",
      "end",
      "loop items",
      "A -> B: z",
      "end",
      "par work",
      "A -> B: w",
      "end",
      "rect rgba(0,0,0,0.1)",
      "%% retry 3x wait 5s - flaky",
      "A -> B: r",
      "end",
      "Note over A,B: hello",
      "activate A",
    ].join("\n"));
    const r = parseStatements(dsl);
    expect(r.errors).toEqual([]);
    expect(r.participants.map((p) => p.name)).toContain("Alice");
    expect(dsl).toContain("B --> A: ok");
    expect(dsl).toContain("retry 3 times wait 5s flaky");
    expect(dsl).toContain("note hello");
    expect(dsl).toContain("# mermaid skipped: activate A");
  });

  it("imports .mmd through the package seam", async () => {
    const { importSequenceFile } = await import("./packageIo");
    const ok = importSequenceFile("sequenceDiagram\nA -> B: hi\n", "x.mmd");
    expect(ok.ok).toBe(true);
    expect(ok.document!.participants.map((p) => p.name).sort()).toEqual(["A", "B"]);
    const bad = importSequenceFile("sequenceDiagram\nend\n", "x.mmd");
    expect(bad.ok).toBe(false);
  });
});
