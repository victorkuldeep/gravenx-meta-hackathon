import { afterEach, describe, expect, it } from "vitest";
import { newConsoleTask, type ConsoleTask } from "@/lib/console/model";
import { skillForPath } from "./skills";
import { CONSOLE_TOOLS, setConsoleBackend } from "./toolsConsole";
import { toolsForSkill } from "./toolsSystem";

let tasks: ConsoleTask[];

function seed() {
  tasks = [newConsoleTask("ERD the Order object", 100), newConsoleTask("Sequence the retry path", 200)];
  setConsoleBackend({
    list: async () => [...tasks],
    save: async (t) => {
      tasks = tasks.map((x) => (x.id === t.id ? t : x));
      if (!tasks.some((x) => x.id === t.id)) tasks.push(t);
    },
  });
}

afterEach(() => setConsoleBackend(null));

function tool(name: string) {
  return CONSOLE_TOOLS.find((t) => t.name === name)!;
}

async function run(name: string, args: unknown = {}) {
  const t = tool(name);
  const parsed = t.schema.safeParse(args);
  if (!parsed.success) throw new Error(`bad test args for ${name}`);
  return t.execute(parsed.data);
}

describe("console skill + tool set", () => {
  it("routes /console to a tooled console pack", () => {
    expect(skillForPath("/console").name).toBe("console");
    expect(skillForPath("/console").tooled).toBe(true);
    // 4 console tools + 6 PMO (jira + snow) tools.
    expect(toolsForSkill("console")).toHaveLength(10);
    expect(toolsForSkill("console").every((t) => t.name.startsWith("console_") || t.name.startsWith("jira_") || t.name.startsWith("snow_"))).toBe(true);
  });

  it("marks mutates approval-gated", () => {
    expect(tool("console_describe").needsApproval).toBe(false);
    for (const name of ["console_add", "console_note", "console_move"]) {
      expect(tool(name).needsApproval).toBe(true);
    }
  });
});

describe("console tools", () => {
  it("describes, logs, notes and moves", async () => {
    seed();
    const d = await run("console_describe");
    expect(d.ok).toBe(true);
    expect(d.result).toMatchObject({ taskCount: 2 });

    const added = await run("console_add", { title: "Draw the hub", priority: "high" });
    expect(added.ok).toBe(true);
    expect(tasks).toHaveLength(3);

    const noted = await run("console_note", { task: "hub", text: "ports first" });
    expect(noted.ok).toBe(true);
    expect(tasks.find((t) => t.title === "Draw the hub")!.notes).toHaveLength(1);

    const moved = await run("console_move", { task: "hub", to: "in-progress" });
    expect(moved.ok).toBe(true);
    expect(tasks.find((t) => t.title === "Draw the hub")!.status).toBe("in-progress");
  });

  it("moves through the full lifecycle, blocked included", async () => {
    seed();
    const moved = await run("console_move", { task: "ERD the Order object", to: "blocked" });
    expect(moved.ok).toBe(true);
    expect(tasks.find((t) => t.title === "ERD the Order object")!.status).toBe("blocked");
    const back = await run("console_move", { task: "ERD the Order object", to: "in-progress" });
    expect(back.ok).toBe(true);
  });

  it("answers honestly on misses and ambiguity", async () => {
    seed();
    expect((await run("console_note", { task: "nope", text: "x" })).ok).toBe(false);
    expect(await run("console_move", { task: "the", to: "resolved" })).toMatchObject({ ok: false });
    // resolved → in-progress is an illegal jump.
    await run("console_move", { task: "ERD the Order object", to: "resolved" });
    expect((await run("console_move", { task: "ERD the Order object", to: "in-progress" })).ok).toBe(false);
  });
});
