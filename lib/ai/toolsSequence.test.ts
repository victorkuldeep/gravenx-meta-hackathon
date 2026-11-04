import { afterEach, describe, expect, it } from "vitest";
import { newSequence, type SequenceDocument } from "@/lib/sequence/model";
import { parseStatements } from "@/lib/sequence/dsl";
import { registerSeqBridge, seqSnapshotOf } from "./seqBridge";
import { skillForPath } from "./skills";
import { SEQUENCE_TOOLS } from "./toolsSequence";
import { toolsForSkill } from "./toolsSystem";

let doc: SequenceDocument;

function seed() {
  const r = parseStatements("Salesforce -> Middleware: Create Order\n");
  doc = { ...newSequence("Shop"), participants: r.participants, nodes: r.nodes };
  registerSeqBridge({
    getSnapshot: () => seqSnapshotOf(doc),
    getDocument: () => doc,
    apply: (fn) => {
      doc = fn(doc);
      return { ok: true };
    },
  });
}

afterEach(() => registerSeqBridge(null));

function tool(name: string) {
  return SEQUENCE_TOOLS.find((t) => t.name === name)!;
}

async function run(name: string, args: unknown = {}) {
  const t = tool(name);
  const parsed = t.schema.safeParse(args);
  if (!parsed.success) throw new Error(`bad test args for ${name}`);
  return t.execute(parsed.data);
}

describe("sequence skill + tool set", () => {
  it("routes /sequence to the sequence pack", () => {
    expect(skillForPath("/sequence").name).toBe("sequence");
    expect(toolsForSkill("sequence")).toHaveLength(3);
  });

  it("reports absence outside the canvas", async () => {
    expect((await run("seq_describe")).ok).toBe(false);
    expect((await run("seq_apply", { statements: "A -> B: x", mode: "append" })).ok).toBe(false);
  });
});

describe("sequence reads", () => {
  it("describes and flattens the live document", async () => {
    seed();
    const d = await run("seq_describe");
    expect(d.ok).toBe(true);
    expect(d.result).toMatchObject({ name: "Shop", messageCount: 1 });
    const m = await run("seq_messages");
    expect(m.ok).toBe(true);
    expect(m.result).toEqual([{ from: "Salesforce", to: "Middleware", label: "Create Order", kind: "sync" }]);
  });
});

describe("seq_apply", () => {
  it("appends statements, merging participants by name", async () => {
    seed();
    const before = doc.participants.map((p) => p.id);
    const r = await run("seq_apply", { statements: "Middleware -> ServiceNow: Create Fulfillment\n", mode: "append" });
    expect(r.ok).toBe(true);
    expect(doc.participants.map((p) => p.name)).toEqual(["Salesforce", "Middleware", "ServiceNow"]);
    // Middleware kept its id - no duplicate participant.
    expect(doc.participants.find((p) => p.name === "Middleware")!.id).toBe(before[1]);
    const msgs = await run("seq_messages");
    expect((msgs.result as unknown[])).toHaveLength(2);
  });

  it("replaces the whole interaction", async () => {
    seed();
    const r = await run("seq_apply", { statements: "A -> B: Only\n", mode: "replace" });
    expect(r.ok).toBe(true);
    expect(doc.participants.map((p) => p.name)).toEqual(["A", "B"]);
    expect(doc.nodes).toHaveLength(1);
  });

  it("rejects unparseable DSL with line errors", async () => {
    seed();
    const r = await run("seq_apply", { statements: "end\n", mode: "append" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/line 1/);
    expect(doc.nodes).toHaveLength(1);
  });
});
