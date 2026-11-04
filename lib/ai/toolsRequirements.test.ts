import { afterEach, describe, expect, it } from "vitest";
import { newRequirement, type Requirement } from "@/lib/requirements/model";
import { skillForPath } from "./skills";
import { REQUIREMENT_TOOLS, setRequirementsBackend } from "./toolsRequirements";
import { toolsForSkill } from "./toolsSystem";

let items: Requirement[];

function seed() {
  items = [
    { ...newRequirement("Customer receives confirmation", "REQ-001", 100), status: "covered" as const },
    newRequirement("Duplicates are rejected", "REQ-002", 200),
  ];
  setRequirementsBackend({
    list: async () => [...items],
    save: async (r) => {
      items = items.map((x) => (x.id === r.id ? r : x));
      if (!items.some((x) => x.id === r.id)) items.push(r);
    },
  });
}

afterEach(() => setRequirementsBackend(null));

function tool(name: string) {
  return REQUIREMENT_TOOLS.find((t) => t.name === name)!;
}

async function run(name: string, args: unknown = {}) {
  const t = tool(name);
  const parsed = t.schema.safeParse(args);
  if (!parsed.success) throw new Error(`bad test args for ${name}`);
  return t.execute(parsed.data);
}

describe("requirements skill + tool set", () => {
  it("routes /requirements to a tooled pack", () => {
    expect(skillForPath("/requirements").name).toBe("requirements");
    expect(skillForPath("/requirements").tooled).toBe(true);
    expect(toolsForSkill("requirements")).toHaveLength(4);
    expect(tool("req_describe").needsApproval).toBe(false);
    for (const name of ["req_log", "req_link", "req_move"]) {
      expect(tool(name).needsApproval).toBe(true);
    }
  });
});

describe("requirements tools", () => {
  it("describes, logs, links and moves", async () => {
    seed();
    expect((await run("req_describe")).ok).toBe(true);
    const added = await run("req_log", { title: "Refunds settle in 3 days" });
    expect(added.ok).toBe(true);
    expect(items[2].number).toBe("REQ-003");
    expect((await run("req_link", {
      requirement: "REQ-003",
      surface: "sequence",
      recordId: "q1",
      label: "Refund flow",
    })).ok).toBe(true);
    expect(items[2].links).toHaveLength(1);
    expect((await run("req_move", { requirement: "REQ-003", to: "covered" })).ok).toBe(true);
    expect(items[2].status).toBe("covered");
  });

  it("answers honestly on misses and illegal jumps", async () => {
    seed();
    expect((await run("req_move", { requirement: "nope", to: "covered" })).ok).toBe(false);
    expect((await run("req_move", { requirement: "REQ-002", to: "verified" })).ok).toBe(false);
  });
});
