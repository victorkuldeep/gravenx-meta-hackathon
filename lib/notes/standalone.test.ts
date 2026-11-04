import { describe, expect, it } from "vitest";
import { bodyToStdNote, newStdNote, stdNoteToBody, stdNotesToViews, stdNoteSchema } from "./standalone";

describe("standalone notes", () => {
  it("creates titled notes with an open lifecycle", () => {
    const n = newStdNote("  Retro  ", 1000);
    expect(n.title).toBe("Retro");
    expect(n.status).toBe("open");
    expect(n.id.startsWith("note_")).toBe(true);
    expect(newStdNote("   ").title).toBe("Untitled note");
  });

  it("cleans stored records through the schema", () => {
    const parsed = stdNoteSchema.parse({ id: "n1", createdAt: 1, updatedAt: 2 });
    expect(parsed).toMatchObject({ title: "Untitled note", status: "open" });
  });

  it("round-trips editor bodies both ways", () => {
    const rich = stdNoteToBody({ body: "md", bodyFormat: "rich", bodyHtml: "<p>Hi</p>" });
    expect(rich).toMatchObject({ format: "rich", html: "<p>Hi</p>" });
    const stored = bodyToStdNote({ format: "rich", md: "md", html: "<p>Hi</p>" });
    expect(stored).toMatchObject({ body: "md", bodyFormat: "rich", bodyHtml: "<p>Hi</p>" });
    expect(bodyToStdNote({ format: "md", md: "  ", html: "" })).toMatchObject({
      body: undefined,
      bodyFormat: undefined,
      bodyHtml: undefined,
    });
  });

  it("exposes notes as linkable console views without copying", () => {
    const views = stdNotesToViews([
      { id: "n1", title: "Retro", body: "Discussed velocity at length.", status: "in-progress", createdAt: 1, updatedAt: 80 },
    ]);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      surface: "notes",
      recordId: "n1",
      title: "Retro",
      kind: "note",
      status: "in-progress",
    });
    expect(views[0].todoId).toBeUndefined();
    expect(views[0].excerpt).toContain("velocity");
  });
});
