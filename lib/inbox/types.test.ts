import { describe, expect, it } from "vitest";
import {
  entityNoteToEntries,
  inboxBodyToNote,
  migrateEntityLogValue,
  noteToTodoBody,
  shareRowsToEntries,
  todoBodyToNote,
  todayIso,
} from "./types";
import { noteBodyFromHtml, noteBodyFromMd } from "@/lib/notes/notebody";

describe("inbox note triples", () => {
  it("migrates vintage TODO bodies and round-trips rich ones", () => {
    const migrated = todoBodyToNote({ body: "## Goal\n\n- [ ] ship" });
    expect(migrated.format).toBe("md");
    expect(migrated.html).toContain("<h2>Goal</h2>");
    const rich = noteToTodoBody(noteBodyFromHtml("<p>Hi <strong>there</strong></p>"));
    expect(rich).toMatchObject({ bodyFormat: "rich" });
    expect(rich.bodyHtml).toContain("<strong>there</strong>");
    expect(todoBodyToNote(rich).format).toBe("rich");
    expect(noteToTodoBody(noteBodyFromMd("   "))).toEqual({
      body: undefined,
      bodyFormat: undefined,
      bodyHtml: undefined,
    });
  });

  it("floors Due at the local today so past dates are not pickable", () => {
    const d = new Date();
    const pad = (v: number) => String(v).padStart(2, "0");
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    expect(todayIso()).toBe(expected);
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("reads inbox item triples with the same rule", () => {
    expect(inboxBodyToNote({ body: "plain" }).format).toBe("md");
    expect(
      inboxBodyToNote({ body: "Hi", bodyFormat: "rich", bodyHtml: "<p>Hi</p>" }).html,
    ).toBe("<p>Hi</p>");
    // A rich flag without html falls back to the markdown side.
    expect(inboxBodyToNote({ body: "plain", bodyFormat: "rich" }).format).toBe("md");
  });
});

describe("entity log migration", () => {
  it("drops empty legacy notes to zero rows", () => {
    expect(
      entityNoteToEntries("Account", { text: "  ", todo: false, done: false, updatedAt: 7 }, "Acct", 9),
    ).toEqual([]);
  });

  it("maps flags, meta and title from a legacy task note", () => {
    const [row] = entityNoteToEntries(
      "Account",
      {
        text: "## Verify lookup\nbefore demo",
        todo: true,
        done: false,
        updatedAt: 42,
        meta: { kind: "task", status: "in-progress", owner: "kul", team: "core", priority: "high", dueDate: "2026-10-01" },
      },
      "Acct",
      100
    );
    expect(row).toMatchObject({
      entityApi: "Account",
      kind: "task",
      status: "in-progress",
      title: "Verify lookup",
      owner: "kul",
      team: "core",
      priority: "high",
      dueDate: "2026-10-01",
      assignee: "kul",
      updatedAt: 42,
    });
    expect(row.id).toBe("ent-Account-2s");
  });

  it("maps done and resolved onto the done terminal", () => {
    const [a] = entityNoteToEntries("A", { text: "x", todo: true, done: true, updatedAt: 1 }, undefined, 1);
    expect(a.status).toBe("done");
    const [b] = entityNoteToEntries(
      "B",
      { text: "x", todo: false, done: false, updatedAt: 1, meta: { kind: "question", status: "resolved" } },
      undefined,
      1
    );
    expect(b.status).toBe("done");
    expect(b.kind).toBe("question");
  });

  it("imports shared Markdown rows as entries with fresh ids", () => {
    const rows = shareRowsToEntries(
      "Account",
      [
        { title: "Verify", text: "Checkea", kind: "task", status: "in-progress", updatedAt: 40 },
        { text: "## Observe\nthings", kind: "epic", status: "weird" },
        { text: "   " },
        null as unknown as { text: string },
      ],
      100
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ entityApi: "Account", kind: "task", status: "in-progress", title: "Verify", updatedAt: 40 });
    expect(rows[0].id).toBe("shr-Account-0-2s");
    expect(rows[1]).toMatchObject({ kind: "note", status: "open", title: "Observe", updatedAt: 100 });
  });

  it("accepts arrays, legacy singles and junk", () => {
    const rows = [
      { id: "e1", title: "t", status: "open", createdAt: 1, updatedAt: 2 },
      { id: 7, updatedAt: 2 },
      null,
    ];
    expect(migrateEntityLogValue("Account", rows)).toEqual([rows[0]]);
    expect(
      migrateEntityLogValue("Account", { text: "hi", todo: false, done: false, updatedAt: 3 }, "Acct", 4),
    ).toHaveLength(1);
    expect(migrateEntityLogValue("Account", { nope: 1 })).toEqual([]);
    expect(migrateEntityLogValue("Account", null)).toEqual([]);
  });
});
