import { afterEach, describe, expect, it } from "vitest";
import { newDecision, type Decision } from "@/lib/decisions/model";
import { skillForPath } from "./skills";
import { DECISION_TOOLS, setDecisionsBackend } from "./toolsDecisions";
import { toolsForSkill } from "./toolsSystem";

let items: Decision[];

function seed() {
  items = [
    { ...newDecision("Middleware owns orchestration", "ADR-001", 100), status: "accepted" as const },
    newDecision("Events for downstream notify", "ADR-002", 200),
  ];
  setDecisionsBackend({
    list: async () => [...items],
    save: async (d) => {
      items = items.map((x) => (x.id === d.id ? d : x));
      if (!items.some((x) => x.id === d.id)) items.push(d);
    },
  });
}

afterEach(() => setDecisionsBackend(null));

function tool(name: string) {
  return DECISION_TOOLS.find((t) => t.name === name)!;
}

async function run(name: string, args: unknown = {}) {
  const t = tool(name);
  const parsed = t.schema.safeParse(args);
  if (!parsed.success) throw new Error(`bad test args for ${name}`);
  return t.execute(parsed.data);
}

describe("decisions skill + tool set", () => {
  it("routes /decisions to a tooled decisions pack", () => {
    expect(skillForPath("/decisions").name).toBe("decisions");
    expect(skillForPath("/decisions").tooled).toBe(true);
    expect(toolsForSkill("decisions")).toHaveLength(4);
    expect(toolsForSkill("decisions").every((t) => t.name.startsWith("decision_"))).toBe(true);
  });

  it("marks mutates approval-gated", () => {
    expect(tool("decision_describe").needsApproval).toBe(false);
    for (const name of ["decision_propose", "decision_link", "decision_move"]) {
      expect(tool(name).needsApproval).toBe(true);
    }
  });
});

describe("decisions tools", () => {
  it("describes, proposes, links and moves", async () => {
    seed();
    const d = await run("decision_describe");
    expect(d.ok).toBe(true);
    expect(d.result).toMatchObject({ decisionCount: 2 });

    const added = await run("decision_propose", { title: "REST sync for order create" });
    expect(added.ok).toBe(true);
    expect(items).toHaveLength(3);
    expect(items[2].number).toBe("ADR-003");

    const linked = await run("decision_link", {
      decision: "ADR-003",
      surface: "system",
      recordId: "p1",
      label: "Ordering topology",
    });
    expect(linked.ok).toBe(true);
    expect(items[2].links).toHaveLength(1);
    expect((await run("decision_link", {
      decision: "ADR-003",
      surface: "system",
      recordId: "p1",
      label: "Ordering topology",
    })).ok).toBe(false);

    const moved = await run("decision_move", { decision: "ADR-003", to: "in-review" });
    expect(moved.ok).toBe(true);
    expect(items[2].status).toBe("in-review");
  });

  it("answers honestly on misses, ambiguity and illegal jumps", async () => {
    seed();
    expect((await run("decision_move", { decision: "nope", to: "accepted" })).ok).toBe(false);
    expect(await run("decision_move", { decision: "ADR-00", to: "accepted" })).toMatchObject({ ok: false });
    // accepted → in-review is an illegal jump.
    expect((await run("decision_move", { decision: "ADR-001", to: "in-review" })).ok).toBe(false);
  });
});
