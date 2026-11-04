import { describe, expect, it } from "vitest";
import { newProject, type SystemProject } from "@/lib/system-design/model";
import {
  canvasToConsole,
  consoleToCanvas,
  pullSchema,
  pullSystem,
  pushSchemaEntryNote,
  pushSchemaEntryStatus,
  pushTodoNote,
  pushTodoStatus,
  type SchemaNotesDoc,
  type SchemaNotesStoreFns,
  type SystemStoreFns,
} from "./sync";

function seedStore(): { fns: SystemStoreFns; projects: Map<string, SystemProject> } {
  const projects = new Map<string, SystemProject>();
  const base = newProject("Hub rollout");
  projects.set("p1", {
    ...base,
    id: "p1",
    updatedAt: 100,
    notes: "Ship the 688 path first.",
    todos: [
      { id: "t1", title: "Mock the hub", status: "open", createdAt: 1, updatedAt: 50 },
      { id: "t2", title: "Replay scenario", status: "done", createdAt: 1, updatedAt: 90 },
    ],
  });
  return {
    projects,
    fns: {
      list: async () => [{ id: "p1", name: "Hub rollout", updatedAt: projects.get("p1")!.updatedAt }],
      load: async (id) => projects.get(id) ?? null,
      save: async (p) => {
        projects.set(p.id, p);
      },
    },
  };
}

describe("console sync", () => {
  it("maps one lifecycle both ways - only the terminal differs", () => {
    expect(canvasToConsole("done")).toBe("resolved");
    expect(canvasToConsole("in-progress")).toBe("in-progress");
    expect(canvasToConsole("blocked")).toBe("blocked");
    expect(canvasToConsole("awaiting-feedback")).toBe("awaiting-feedback");
    expect(consoleToCanvas("resolved")).toBe("done");
    expect(consoleToCanvas("open")).toBe("open");
    expect(consoleToCanvas("in-progress")).toBe("in-progress");
    expect(consoleToCanvas("blocked")).toBe("blocked");
    expect(consoleToCanvas("awaiting-feedback")).toBe("awaiting-feedback");
  });

  it("pulls TODOs and notes as link views", async () => {
    const { fns } = seedStore();
    const views = await pullSystem(fns);
    expect(views).toHaveLength(3);
    const todo = views.find((v) => v.todoId === "t1")!;
    expect(todo).toMatchObject({ recordName: "Hub rollout", title: "Mock the hub", status: "open" });
    const note = views.find((v) => !v.todoId)!;
    expect(note.excerpt).toContain("688 path");
  });

  it("pushes status and refuses stale writes", async () => {
    const { fns, projects } = seedStore();
    expect((await pushTodoStatus(fns, "p1", "t1", "in-progress", 50, 200)).ok).toBe(true);
    expect(projects.get("p1")!.todos[0].status).toBe("in-progress");
    // Canvas moved on past our snapshot - refuse instead of clobbering.
    const stale = await pushTodoStatus(fns, "p1", "t1", "done", 50, 300);
    expect(stale).toMatchObject({ ok: false, stale: true });
    expect(projects.get("p1")!.todos[0].status).toBe("in-progress");
  });

  it("appends notes to the canvas body and reports gone records", async () => {
    const { fns, projects } = seedStore();
    expect((await pushTodoNote(fns, "p1", "t1", "TLS verified", 50, 200)).ok).toBe(true);
    expect(projects.get("p1")!.todos[0].body).toContain("[Console");
    expect(projects.get("p1")!.todos[0].body).toContain("TLS verified");
    expect(await pushTodoStatus(fns, "nope", "t1", "done", 0)).toMatchObject({ ok: false });
    expect(await pushTodoStatus(fns, "p1", "gone", "done", 0)).toMatchObject({ ok: false });
  });

  it("dual-syncs pushed notes and preserves rich highlights", async () => {
    const { fns, projects } = seedStore();
    projects.get("p1")!.todos[0] = {
      ...projects.get("p1")!.todos[0],
      body: "Plan",
      bodyFormat: "rich",
      bodyHtml: '<p><mark data-color="#C6F6C6">Plan</mark></p>',
    };
    expect((await pushTodoNote(fns, "p1", "t1", "TLS verified", 50, 200)).ok).toBe(true);
    const t = projects.get("p1")!.todos[0];
    expect(t.body).toContain("TLS verified");
    expect(t.bodyFormat).toBe("rich");
    expect(t.bodyHtml).toContain('data-color="#C6F6C6"');
    expect(t.bodyHtml).toContain("TLS verified");
  });
});

function seedSchema(): { fns: SchemaNotesStoreFns; docs: Map<string, SchemaNotesDoc> } {
  const docs = new Map<string, SchemaNotesDoc>();
  docs.set("tab1", {
    todos: [{ id: "t1", title: "Canvas fix", status: "open", createdAt: 1, updatedAt: 50 }],
    entities: {
      Account: [
        { id: "e1", title: "Verify lookup", body: "Check it", kind: "task", status: "in-progress", entityApi: "Account", owner: "kul", dueDate: "2026-10-01", createdAt: 1, updatedAt: 60 },
        { id: "e2", title: "Why junction?", body: "Ask", kind: "question", status: "open", entityApi: "Account", createdAt: 1, updatedAt: 70 },
      ],
    },
  });
  return {
    docs,
    fns: {
      listTabs: async () => [{ tabId: "tab1", name: "Canvas 1" }],
      loadNotes: async (_org, tabId) => docs.get(tabId) ?? null,
      saveNotes: async (_org, tabId, doc) => {
        docs.set(tabId, doc);
      },
    },
  };
}

describe("schema console sync", () => {
  it("pulls canvas TODOs and every entity-log kind as views", async () => {
    const { fns } = seedSchema();
    const views = await pullSchema("org1", fns, new Map([["Account", "Account"]]));
    expect(views).toHaveLength(3);
    expect(views.every((v) => v.surface === "schema" && v.recordId === "tab1")).toBe(true);
    const byId = new Map(views.map((v) => [v.todoId, v]));
    expect(byId.get("t1")).toMatchObject({ kind: "task", status: "open", title: "Canvas fix" });
    expect(byId.get("e1")).toMatchObject({ kind: "task", status: "in-progress", owner: "kul", dueDate: "2026-10-01" });
    expect(byId.get("e2")).toMatchObject({ kind: "question", status: "open" });
    expect(await pullSchema("", fns)).toEqual([]);
  });

  it("surfaces canvas prose as a read-only note view", async () => {
    const { fns, docs } = seedSchema();
    docs.get("tab1")!.canvasText = { md: "Discussed the junction model.", updatedAt: 80 };
    const views = await pullSchema("org1", fns);
    expect(views).toHaveLength(4);
    const prose = views.find((v) => v.todoId === undefined);
    expect(prose).toMatchObject({ kind: "note", status: null, title: "Canvas 1 · Canvas notes" });
    expect(prose?.excerpt).toContain("junction");
  });

  it("pushes entry status with the same stale guard", async () => {
    const { fns, docs } = seedSchema();
    expect((await pushSchemaEntryStatus(fns, "org1", "tab1", "e1", "blocked", 60, 200)).ok).toBe(true);
    expect(docs.get("tab1")!.entities.Account[0].status).toBe("blocked");
    const stale = await pushSchemaEntryStatus(fns, "org1", "tab1", "e1", "done", 60, 300);
    expect(stale).toMatchObject({ ok: false, stale: true });
    expect(await pushSchemaEntryStatus(fns, "org1", "tab1", "gone", "done", 0)).toMatchObject({ ok: false });
    expect(await pushSchemaEntryStatus(fns, "org1", "nope", "e1", "done", 0)).toMatchObject({ ok: false });
  });

  it("appends console notes to canvas TODOs and entity rows alike", async () => {
    const { fns, docs } = seedSchema();
    expect((await pushSchemaEntryNote(fns, "org1", "tab1", "t1", "TLS verified", 50, 200)).ok).toBe(true);
    expect(docs.get("tab1")!.todos[0].body).toContain("[Console");
    expect((await pushSchemaEntryNote(fns, "org1", "tab1", "e2", "Asked in review", 70, 200)).ok).toBe(true);
    expect(docs.get("tab1")!.entities.Account[1].body).toContain("Asked in review");
    expect(await pushSchemaEntryNote(fns, "org1", "tab1", "e2", "   ", 200)).toMatchObject({ ok: false });
  });
});
