import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { governanceTools } from "./governance";

let dir = "";

function tool(name: string) {
  const t = governanceTools.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return (args: Record<string, unknown>) => t.run(dir, args);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gx-epic7-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("epic 7: decision reasoning + jira drafts", () => {
  it("creates, transitions, links and summarizes a decision", async () => {
    const created = await tool("decision_create")({ title: "Middleware owns orchestration" });
    expect(created.ok).toBe(true);
    const number = (created.data as { number: string }).number;
    // Illegal jump proposed -> accepted is rejected.
    const bad = await tool("decision_update")({ ref: number, status: "accepted" });
    expect(bad.ok).toBe(false);
    const moved = await tool("decision_update")({ ref: number, status: "in-review", decision: "Middleware orchestrates all order flows." });
    expect(moved.ok).toBe(true);
    const linked = await tool("decision_link")({ ref: number, surface: "system", recordId: "sys-1", label: "Order hub" });
    expect(linked.ok).toBe(true);
    const again = await tool("decision_link")({ ref: number, surface: "system", recordId: "sys-1", label: "Order hub" });
    expect(again.ok).toBe(true);
    expect(again.summary).toMatch(/Already linked/);
    const digest = await tool("decision_summarize")({});
    expect(digest.ok).toBe(true);
    expect((digest.data as { markdown: string }).markdown).toContain(number);
  });

  it("moves requirements, links them to decisions, and drafts JIRA stories", async () => {
    await tool("requirement_create")({ title: "Order confirmation email" });
    const reqs = await tool("requirement_list")({});
    const number = ((reqs.data as { items: { number: string }[] }).items[0]).number;
    const bad = await tool("requirement_update")({ ref: number, status: "verified" });
    expect(bad.ok).toBe(false);
    expect((await tool("requirement_update")({ ref: number, status: "covered" })).ok).toBe(true);
    await tool("decision_create")({ title: "Use middleware" });
    const decs = await tool("decision_list")({});
    const decNumber = ((decs.data as { items: { number: string }[] }).items[0]).number;
    const linked = await tool("requirement_link")({ ref: number, surface: "decision", recordId: decNumber, label: "Use middleware" });
    expect(linked.ok).toBe(true);
    const draft = await tool("jira_draft")({ title: "Order notifications" });
    expect(draft.ok).toBe(true);
    expect((draft.data as { markdown: string }).markdown).toMatch(/Acceptance criteria/);
  });
});
