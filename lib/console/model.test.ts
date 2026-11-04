import { describe, expect, it } from "vitest";
import {
  addNote,
  canTransition,
  consoleBodyToNote,
  consoleTaskKey,
  consoleTaskSchema,
  groupCanvasViews,
  moveTask,
  newConsoleTask,
  nextStatuses,
  noteToConsoleBody,
  type CanvasViewRef,
} from "./model";
import { noteBodyFromHtml, noteBodyFromMd } from "@/lib/notes/notebody";

describe("console model", () => {
  it("creates open tasks with creation history", () => {
    const t = newConsoleTask("ERD the Order object", 1000);
    expect(t.status).toBe("open");
    expect(t.priority).toBe("normal");
    expect(t.history).toEqual([{ at: 1000, what: "Logged in Console." }]);
    expect(consoleTaskSchema.safeParse(t).success).toBe(true);
  });

  it("carries synced kind and owner from canvas entries", () => {
    const t = { ...newConsoleTask("Verify lookup", 1), kind: "question" as const, owner: "kul" };
    expect(consoleTaskSchema.safeParse(t).success).toBe(true);
    expect(consoleTaskSchema.safeParse({ ...t, kind: "epic" }).success).toBe(false);
    const bare = newConsoleTask("Plain", 2);
    expect(bare.kind).toBeUndefined();
    expect(bare.owner).toBeUndefined();
    expect(consoleTaskSchema.safeParse(bare).success).toBe(true);
  });

  it("walks the lifecycle and rejects jumps", () => {
    expect(canTransition("open", "in-progress")).toBe(true);
    expect(canTransition("open", "blocked")).toBe(true);
    expect(canTransition("in-progress", "awaiting-feedback")).toBe(true);
    expect(canTransition("awaiting-feedback", "in-progress")).toBe(true);
    expect(canTransition("blocked", "resolved")).toBe(false);
    expect(canTransition("resolved", "open")).toBe(true);
    expect(canTransition("resolved", "in-progress")).toBe(false);
    const moved = moveTask(newConsoleTask("X", 1), "resolved", 2);
    expect(moved.status).toBe("resolved");
    expect(moved.history).toHaveLength(2);
    const stuck = moveTask(moved, "in-progress", 3);
    expect(stuck.status).toBe("resolved");
  });

  it("offers reachable statuses and stable queue keys", () => {
    expect(nextStatuses("in-progress")).toEqual(["open", "blocked", "awaiting-feedback", "resolved"]);
    expect(nextStatuses("resolved")).toEqual(["open"]);
    const a = newConsoleTask("Alpha", 1000);
    const b = newConsoleTask("Beta", 1000);
    expect(consoleTaskKey(a)).toMatch(/^CX-/);
    expect(consoleTaskKey(a)).toBe(consoleTaskKey(b));
  });

  it("adds notes with history and trims empties", () => {
    const t = addNote(newConsoleTask("X", 1), "  check TLS  ", 2);
    expect(t.notes).toHaveLength(1);
    expect(t.notes[0].text).toBe("check TLS");
    expect(addNote(t, "   ", 3).notes).toHaveLength(1);
  });

  it("rejects bad payloads", () => {
    const t = newConsoleTask("X", 1);
    expect(consoleTaskSchema.safeParse({ ...t, status: "archived" }).success).toBe(false);
    expect(consoleTaskSchema.safeParse({ ...t, links: [{ surface: "figma", recordId: "1", label: "x" }] }).success).toBe(false);
  });

  it("round-trips the dual-format description triple", () => {
    // Vintage markdown-only task migrates on first touch.
    const legacy = { ...newConsoleTask("X", 1), body: "## Goal\n\n- [ ] ship" };
    const migrated = consoleBodyToNote(legacy);
    expect(migrated.format).toBe("md");
    expect(migrated.md).toBe(legacy.body);
    expect(migrated.html).toContain("<h2>Goal</h2>");
    // Rich task keeps its side and editor memory.
    const rich = { ...newConsoleTask("Y", 2), ...noteToConsoleBody(noteBodyFromHtml("<p>Hi <strong>there</strong></p>")) };
    expect(consoleTaskSchema.safeParse(rich).success).toBe(true);
    expect(consoleBodyToNote(rich).format).toBe("rich");
    expect(consoleBodyToNote(rich).html).toContain("<strong>there</strong>");
    // Empty drafts clear all three sides; md commits validate.
    expect(noteToConsoleBody(noteBodyFromMd("   "))).toEqual({ body: undefined, bodyFormat: undefined, bodyHtml: undefined });
    const md = { ...newConsoleTask("Z", 3), ...noteToConsoleBody(noteBodyFromMd("plain")) };
    expect(consoleTaskSchema.safeParse(md).success).toBe(true);
    expect(consoleTaskSchema.safeParse({ ...md, bodyFormat: "quill" }).success).toBe(false);
  });
});

describe("groupCanvasViews", () => {
  const v = (over: Partial<CanvasViewRef> & { recordId: string }): CanvasViewRef => ({
    surface: "schema",
    recordName: "Orders ERD",
    updatedAt: 1,
    ...over,
  });

  it("groups by canvas, notes before TODOs, newest first", () => {
    const groups = groupCanvasViews([
      v({ recordId: "a", todoId: "t1", updatedAt: 5 }),
      v({ recordId: "a", updatedAt: 9 }),
      v({ recordId: "a", todoId: "t2", updatedAt: 7 }),
      v({ recordId: "b", updatedAt: 3 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((i) => i.todoId ?? "notes")).toEqual(["notes", "t2", "t1"]);
    expect(groups[1].recordId).toBe("b");
  });

  it("orders surfaces system, schema, notes and canvases alphabetically", () => {
    const groups = groupCanvasViews([
      v({ surface: "notes", recordId: "n", recordName: "Zebra" }),
      v({ surface: "system", recordId: "s", recordName: "Zulu" }),
      v({ surface: "schema", recordId: "b", recordName: "Beta" }),
      v({ surface: "schema", recordId: "a", recordName: "Alpha" }),
    ]);
    expect(groups.map((g) => g.recordId)).toEqual(["s", "a", "b", "n"]);
  });

  it("returns empty for empty", () => {
    expect(groupCanvasViews([])).toEqual([]);
  });
});
