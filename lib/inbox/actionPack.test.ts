"use client";

import { describe, it, expect } from "vitest";
import { compileActionPack, escapeCell, actionPackFileName } from "./actionPack";
import type { ArchitectureInboxItem } from "./types";

const item = (over: Partial<ArchitectureInboxItem> = {}): ArchitectureInboxItem => ({
  id: "live-entity-Lead",
  orgScopeId: "org:1",
  canvasId: "live",
  canvasName: "Live canvas",
  kind: "task",
  status: "open",
  title: "Verify junction | on Quote",
  body: "Check the lookup\nsecond line",
  anchor: { type: "entity", id: "Lead" },
  createdAt: 1000,
  updatedAt: 2000,
  stale: "ok",
  history: [],
  provenance: { source: "live-entity" },
  ...over,
});

describe("action pack compiler", () => {
  it("compiles deterministically for the same inputs", () => {
    const items = [item(), item({ id: "live-canvas", kind: "note", title: "Notes", status: "open", anchor: { type: "canvas", id: "live" } })];
    const a = compileActionPack(items, { scope: "all", orgLabel: "Acme" }, 999);
    const b = compileActionPack(items, { scope: "all", orgLabel: "Acme" }, 999);
    expect(a.markdown).toBe(b.markdown);
    expect(a.fileName).toBe(b.fileName);
  });

  it("assigns stable short refs with canonical ids in comments", () => {
    const r = compileActionPack([item()], { scope: "all", orgLabel: "Acme" }, 999);
    expect(r.markdown).toContain("A-001");
    expect(r.markdown).toContain("<!-- live-entity-Lead -->");
  });

  it("escapes pipes so tables never break, keeps bodies intact", () => {
    expect(escapeCell("a | b\nc")).toBe("a \\| b c");
    const r = compileActionPack([item()], { scope: "all", orgLabel: "Acme" }, 999);
    expect(r.markdown).toContain("Verify junction \\| on Quote");
    expect(r.markdown).toContain("Check the lookup\nsecond line");
  });

  it("outstanding scope drops resolved items, all scope keeps them", () => {
    const items = [item(), item({ id: "x", status: "resolved", title: "Done thing" })];
    const out = compileActionPack(items, { scope: "outstanding", orgLabel: "O" }, 1);
    expect(out.markdown).not.toContain("Done thing");
    expect(out.manifest.resolved).toBe(0);
    const all = compileActionPack(items, { scope: "all", orgLabel: "O" }, 1);
    expect(all.markdown).toContain("Done thing");
    expect(all.manifest.resolved).toBe(1);
  });

  it("omits empty sections and warns on stale anchors", () => {
    const r = compileActionPack(
      [item({ stale: "missing", anchor: { type: "entity", id: "Gone__c" } })],
      { scope: "all", orgLabel: "O" },
      1
    );
    expect(r.markdown).not.toContain("## Open Questions");
    expect(r.markdown).toContain("## Schema Review");
    expect(r.manifest.warnings).toHaveLength(1);
    expect(r.manifest.stale).toBe(1);
  });

  it("never invents owners, dates, or conclusions", () => {
    const r = compileActionPack([item()], { scope: "all", orgLabel: "O" }, 1);
    expect(r.markdown).not.toMatch(/Owner:|Due date:|Business impact|Risk:|Acceptance criteria|Conclusion:/i);
  });

  it("sanitizes file names", () => {
    expect(actionPackFileName("Acme Corp!", 0)).toMatch(/^architecture-action-pack-acme-corp-\d{4}-\d{2}-\d{2}\.md$/);
  });
});
