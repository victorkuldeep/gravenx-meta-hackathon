"use client";

import { describe, it, expect } from "vitest";
import {
  normalizeLiveNotes,
  normalizeSnapshotNotes,
  resolveStale,
  queryInbox,
  countInbox,
} from "./normalize";
import { CANVAS_LOG_API, EMPTY_QUERY, type CanvasTodo } from "./types";
import type { ErdSnapshot } from "@/lib/erd/snapshotDb";

const labels = new Map([
  ["Lead", "Lead"],
  ["Quote__c", "Quote"],
]);

const liveInput = {
  orgScopeId: "org:00Dxx",
  text: "# Plan\n- [ ] Verify junction",
  updatedAt: 1000,
  entries: [
    { id: "e1", title: "Check conversion", body: "Check conversion", kind: "task", status: "open", entityApi: "Lead", createdAt: 100, updatedAt: 2000 },
    { id: "e2", title: "Pricing review", body: "Pricing review", kind: "task", status: "done", entityApi: "Quote__c", createdAt: 100, updatedAt: 3000 },
    { id: "e3", title: "Just observing", body: "Just observing", kind: "note", status: "open", entityApi: "Account", createdAt: 100, updatedAt: 4000 },
  ] as CanvasTodo[],
  labels,
};

const snap = (over: Partial<ErdSnapshot> = {}): ErdSnapshot => ({
  id: "s1",
  orgDomain: "x",
  name: "Lead map",
  createdAt: 500,
  root: "Lead",
  focus: "Lead",
  nodes: ["Lead"],
  positions: {},
  ...over,
});

describe("inbox normalization", () => {
  it("maps canvas markdown to a single open note", () => {
    const items = normalizeLiveNotes({ ...liveInput, text: "hello", entries: [] });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("live-canvas");
    expect(items[0].kind).toBe("note");
    expect(items[0].status).toBe("open");
  });

  it("maps canvas-scope rows to entry items with lifecycle", () => {
    const items = normalizeLiveNotes({
      ...liveInput,
      text: "",
      entries: [
        { id: "t1", title: "Verify junction", body: "Checkea", assignee: "Asha", dueDate: "2026-10-05", status: "in-progress", entityApi: CANVAS_LOG_API, createdAt: 100, updatedAt: 200 },
        { id: "t2", title: "Old thing", status: "done", entityApi: CANVAS_LOG_API, createdAt: 50, updatedAt: 60 },
      ] as CanvasTodo[],
    });
    expect(items).toHaveLength(2);
    const byId = new Map(items.map((i) => [i.id, i]));
    const t1 = byId.get("live-entry-t1")!;
    expect(t1.kind).toBe("task");
    expect(t1.status).toBe("in-progress");
    expect(t1.owner).toBe("Asha");
    expect(t1.dueDate).toBe("2026-10-05");
    expect(t1.body).toBe("Checkea");
    expect(t1.anchor).toMatchObject({ type: "canvas" });
    expect(t1.stale).toBe("ok");
    expect(byId.get("live-entry-t2")?.status).toBe("resolved");
    expect(byId.get("live-entry-t2")?.title).toBe("Old thing");
  });

  it("skips blank canvas text and empty prose notes, keeps actionable kinds", () => {
    const items = normalizeLiveNotes({
      ...liveInput,
      text: "  ",
      entries: [
        { id: "x1", title: "", body: "  ", kind: "note", status: "open", entityApi: "X", createdAt: 1, updatedAt: 1 },
        { id: "x2", title: "", body: "", kind: "task", status: "open", entityApi: "X", createdAt: 1, updatedAt: 1 },
      ] as CanvasTodo[],
    });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("live-entry-x2");
  });

  it("passes the rich triple through from every source", () => {
    const html = "<p>Hi <strong>there</strong></p>";
    const items = normalizeLiveNotes({
      ...liveInput,
      text: "Hi **there**",
      textFormat: "rich",
      textHtml: html,
      entries: [
        { id: "t1", title: "T", body: "Hi", bodyFormat: "rich", bodyHtml: html, status: "open", createdAt: 1, updatedAt: 2 },
        { id: "e1", title: "E", body: "Hi", bodyFormat: "rich", bodyHtml: html, kind: "note", status: "open", entityApi: "Lead", createdAt: 1, updatedAt: 1 },
      ] as CanvasTodo[],
    });
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get("live-canvas")).toMatchObject({ bodyFormat: "rich", bodyHtml: html });
    expect(byId.get("live-entry-t1")).toMatchObject({ bodyFormat: "rich", bodyHtml: html });
    expect(byId.get("live-entry-e1")).toMatchObject({ bodyFormat: "rich", bodyHtml: html });
    const snapItems = normalizeSnapshotNotes({
      snapshot: snap({ notes: "Hi", notesFormat: "rich", notesHtml: html }),
      orgScopeId: "o",
    });
    expect(snapItems[0]).toMatchObject({ bodyFormat: "rich", bodyHtml: html });
    // Vintage records stay markdown-only.
    expect(normalizeLiveNotes(liveInput)[0].bodyFormat).toBeUndefined();
  });

  it("maps entry kind and done to resolved - never invents kinds", () => {
    const items = normalizeLiveNotes(liveInput);
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get("live-entry-e1")?.kind).toBe("task");
    expect(byId.get("live-entry-e1")?.status).toBe("open");
    expect(byId.get("live-entry-e2")?.kind).toBe("task");
    expect(byId.get("live-entry-e2")?.status).toBe("resolved");
    expect(byId.get("live-entry-e3")?.kind).toBe("note");
    expect(byId.get("live-entry-e3")?.status).toBe("open");
  });

  it("keeps stable deterministic ids", () => {
    const a = normalizeLiveNotes(liveInput).map((i) => i.id).sort();
    const b = normalizeLiveNotes(liveInput).map((i) => i.id).sort();
    expect(a).toEqual(b);
    expect(a).toContain("live-entry-e1");
  });

  it("adapts snapshot notes with provenance, skips snapshots without notes", () => {
    expect(normalizeSnapshotNotes({ snapshot: snap(), orgScopeId: "o" })).toHaveLength(0);
    const items = normalizeSnapshotNotes({ snapshot: snap({ notes: "review this" }), orgScopeId: "o" });
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("snap-s1");
    expect(items[0].kind).toBe("note");
    expect(items[0].provenance).toEqual({ source: "snapshot", snapshotId: "s1" });
  });

  it("resolves entity staleness against known apis, never guesses", () => {
    const ctx = { knownApis: new Set(["Lead"]), entities: new Map(), fields: new Map() };
    const items = resolveStale(normalizeLiveNotes(liveInput), ctx);
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get("live-entry-e1")?.stale).toBe("ok");
    expect(byId.get("live-entry-e2")?.stale).toBe("missing");
    // canvas items stay as-is
    expect(byId.get("live-canvas")?.stale).toBe("ok");
  });

  it("marks changed when the stored fingerprint drifts from live facts", () => {
    const withFp = {
      ...liveInput,
      text: "",
      entries: [
        { id: "f1", title: "x", body: "x", kind: "note", status: "open", entityApi: "Lead", fingerprint: { value: "e:stale", at: 1 }, createdAt: 1, updatedAt: 1 },
      ] as CanvasTodo[],
    };
    const ctx = {
      knownApis: new Set(["Lead"]),
      entities: new Map([["Lead", { apiName: "Lead", fieldCount: 1, fieldNames: ["Id"], childNames: [] }]]),
      fields: new Map(),
    };
    const items = resolveStale(normalizeLiveNotes(withFp), ctx);
    expect(items[0].stale).toBe("changed");
  });

  it("honors explicit kind/status/owner metadata on entries", () => {
    const withMeta = {
      ...liveInput,
      text: "",
      entries: [
        { id: "q1", title: "Should we?", body: "Should we?", kind: "question", status: "open", entityApi: "Lead", owner: "Asha", team: "Integ", priority: "high", createdAt: 1, updatedAt: 1 },
      ] as CanvasTodo[],
    };
    const items = normalizeLiveNotes(withMeta);
    expect(items[0].kind).toBe("question");
    expect(items[0].status).toBe("open");
    expect(items[0].owner).toBe("Asha");
    expect(items[0].team).toBe("Integ");
    expect(items[0].history).toEqual([]);
  });

  it("filters with AND semantics, case-insensitive", () => {
    const ctx = {
      knownApis: new Set(["Lead", "Quote__c", "Account"]),
      entities: new Map(),
      fields: new Map(),
    };
    const items = resolveStale(normalizeLiveNotes(liveInput), ctx);
    expect(queryInbox(items, { ...EMPTY_QUERY, text: "lead conversion" })).toHaveLength(1);
    expect(queryInbox(items, { ...EMPTY_QUERY, kinds: ["task"] })).toHaveLength(2);
    expect(queryInbox(items, { ...EMPTY_QUERY, statuses: ["resolved"] })).toHaveLength(1);
    expect(queryInbox(items, { ...EMPTY_QUERY, text: "lead pricing" })).toHaveLength(0);
  });

  it("sorts open tasks before notes, then by recency, ties by id", () => {
    const ctx = {
      knownApis: new Set(["Lead", "Quote__c", "Account"]),
      entities: new Map(),
      fields: new Map(),
    };
    const items = resolveStale(normalizeLiveNotes(liveInput), ctx);
    const sorted = queryInbox(items, EMPTY_QUERY).map((i) => i.id);
    // open task first, then open notes (canvas note updatedAt 1000 < Account 4000)
    expect(sorted[0]).toBe("live-entry-e1");
    expect(sorted).toContain("live-entry-e2"); // resolved sorts last among its group
  });

  it("counts with the same semantics as the list", () => {
    const ctx = { knownApis: new Set(["Lead"]), entities: new Map(), fields: new Map() };
    const items = resolveStale(normalizeLiveNotes(liveInput), ctx);
    const c = countInbox(items);
    expect(c.total).toBe(4);
    expect(c.open).toBe(3);
    expect(c.tasks).toBe(2);
    expect(c.openTasks).toBe(1);
    expect(c.resolved).toBe(1);
    expect(c.stale).toBe(2); // Quote__c + Account missing from known set
  });
});
