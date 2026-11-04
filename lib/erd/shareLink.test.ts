"use client";

import { describe, it, expect } from "vitest";
import {
  validateShareStructure,
  shareStructureBytes,
  newShareId,
  SHARE_LINK_VERSION,
  type ShareStructure,
} from "./shareLink";

const shape = (over: Partial<ShareStructure> = {}): ShareStructure => ({
  v: SHARE_LINK_VERSION,
  name: "Lead map",
  root: "Lead",
  nodes: ["Lead", "Account"],
  positions: { Lead: { x: 0, y: 0 }, Account: { x: 400, y: 0 } },
  ...over,
});

describe("share link structure", () => {
  it("accepts a well-formed structure", () => {
    const p = validateShareStructure(shape());
    expect(p?.root).toBe("Lead");
    expect(p?.nodes).toHaveLength(2);
  });

  it("rejects wrong version, empty nodes, bad positions", () => {
    expect(validateShareStructure(null)).toBeNull();
    expect(validateShareStructure({ ...shape(), v: 99 })).toBeNull();
    expect(validateShareStructure({ ...shape(), nodes: [] })).toBeNull();
    expect(validateShareStructure({ ...shape(), nodes: ["Lead", 42] })).toBeNull();
    expect(validateShareStructure({ ...shape(), positions: { Lead: { x: NaN, y: 0 } } })).toBeNull();
    expect(validateShareStructure({ ...shape(), view: "sideways" })).toBeNull();
  });

  it("round-trips canvas TODOs, sanitizing status", () => {
    const p = validateShareStructure(shape({
      todos: [
        { id: "t1", title: "Verify", body: "x", assignee: "Asha", dueDate: "2026-10-05", status: "in-progress", createdAt: 1, updatedAt: 2 },
        { id: "t2", title: "Bad", status: "weird" as "open", createdAt: 1, updatedAt: 2 },
      ],
    }));
    expect(p?.todos).toHaveLength(2);
    expect(p?.todos?.[0].status).toBe("in-progress");
    expect(p?.todos?.[0].assignee).toBe("Asha");
    expect(p?.todos?.[1].status).toBe("open");
  });

  it("keeps the shared lifecycle states across a share", () => {
    const p = validateShareStructure(shape({
      todos: [
        { id: "t1", title: "Stuck", status: "blocked", createdAt: 1, updatedAt: 2 },
        { id: "t2", title: "Waiting", status: "awaiting-feedback", createdAt: 1, updatedAt: 2 },
      ],
    }));
    expect(p?.todos?.map((t) => t.status)).toEqual(["blocked", "awaiting-feedback"]);
  });

  it("rejects malformed todos", () => {
    expect(validateShareStructure(shape({ todos: "nope" as unknown as ShareStructure["todos"] }))).toBeNull();
    expect(validateShareStructure(shape({ todos: [{ title: "no id" }] as unknown as ShareStructure["todos"] }))).toBeNull();
  });

  it("preserves entry kind/owner metadata on shared todos", () => {
    const p = validateShareStructure(shape({
      todos: [
        { id: "t1", title: "Why?", kind: "question", owner: "kul", team: "core", priority: "high", status: "open", createdAt: 1, updatedAt: 2 },
        { id: "t2", title: "Plain", kind: "epic", status: "open", createdAt: 1, updatedAt: 2 } as unknown as { id: string; title: string; status: "open"; createdAt: number; updatedAt: number },
      ],
    }));
    expect(p?.todos?.[0]).toMatchObject({ kind: "question", owner: "kul", team: "core", priority: "high" });
    expect(p?.todos?.[1].kind).toBeUndefined();
  });

  it("accepts log-row arrays and legacy singles for entity notes", () => {
    const p = validateShareStructure(shape({
      entityNotes: {
        Account: [
          { title: "Verify", text: "Checkea", kind: "task", status: "in-progress", updatedAt: 5 },
          { text: "x", kind: "epic" } as unknown as { text: string },
          { nope: 1 } as unknown as { text: string },
        ],
        Lead: { text: "Old note", todo: true, done: false, updatedAt: 6 },
      },
    }));
    const rows = p?.entityNotes?.Account;
    expect(Array.isArray(rows) && rows).toHaveLength(2);
    expect(Array.isArray(rows) && rows[0]).toMatchObject({ kind: "task", status: "in-progress" });
    expect(Array.isArray(rows) && rows[1].kind).toBeUndefined();
    expect(p?.entityNotes?.Lead).toMatchObject({ text: "Old note", todo: true });
    expect(validateShareStructure(shape({ entityNotes: { Bad: { nope: 1 } } as unknown as ShareStructure["entityNotes"] }))).toBeNull();
  });

  it("fills sane defaults for optional fields", () => {
    const p = validateShareStructure({ v: 1, root: "Lead", nodes: ["Lead"], positions: {} });
    expect(p?.name).toBe("Shared canvas");
    expect(p?.notes).toBeUndefined();
  });

  it("measures byte size", () => {
    expect(shareStructureBytes(shape())).toBeGreaterThan(50);
  });

  it("mints unguessable ids", () => {
    const a = newShareId();
    const b = newShareId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(16);
  });
});
