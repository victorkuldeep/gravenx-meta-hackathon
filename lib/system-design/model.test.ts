"use client";

import { describe, it, expect } from "vitest";
import {
  newProject,
  validateProject,
  exportProject,
  importProject,
  projectFileName,
  connectionReadiness,
  noteToSystemNotes,
  systemNotesToNote,
  SYSTEM_TEMPLATES,
  SYSTEM_DESIGN_SCHEMA_VERSION,
} from "./model";
import { noteBodyFromHtml, noteBodyFromMd } from "@/lib/notes/notebody";
import { buildDemoProject } from "./demo";

describe("system design model", () => {
  it("creates a versioned empty project", () => {
    const p = newProject("Acme");
    expect(p.name).toBe("Acme");
    expect(p.schemaVersion).toBe(SYSTEM_DESIGN_SCHEMA_VERSION);
    expect(p.systems).toEqual([]);
    expect(p.connections).toEqual([]);
    expect(p.interfaces).toEqual([]);
    expect(p.operations).toEqual([]);
    expect(p.environments).toHaveLength(1);
  });

  it("ships templates with icon keys", () => {
    expect(SYSTEM_TEMPLATES.length).toBeGreaterThanOrEqual(19);
    for (const t of SYSTEM_TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.iconKey.length).toBeGreaterThan(0);
    }
  });

  it("rejects dangling connection references", () => {
    const p = newProject();
    const sys = { id: "s1", name: "A", systemType: "rest" as const, description: "", position: { x: 0, y: 0 }, iconKey: "bolt" };
    const { project, issues } = validateProject({
      ...p,
      systems: [sys],
      connections: [{ id: "c1", sourceId: "s1", targetId: "ghost", label: "", status: "draft" }],
    });
    expect(project).toBeNull();
    expect(issues.some((i) => i.path === "$.connections[0].targetId")).toBe(true);
  });

  it("rejects duplicate system ids and bad positions", () => {    const p = newProject();
    const base = { name: "A", systemType: "rest" as const, description: "", iconKey: "bolt" };
    const { issues } = validateProject({
      ...p,
      systems: [
        { ...base, id: "s1", position: { x: 0, y: 0 } },
        { ...base, id: "s1", position: { x: "far", y: 0 } },
      ],
      connections: [],
    });
    expect(issues.some((i) => i.message.includes("Duplicate"))).toBe(true);
    expect(issues.some((i) => i.path.includes("position"))).toBe(true);
  });

  it("round-trips export/import and forces draft status", () => {
    const p = buildDemoProject();
    const file = exportProject(p);
    expect(file.kind).toBe("gravenx-system-design");
    const back = importProject(JSON.parse(JSON.stringify(file)));
    expect(back.issues).toEqual([]);
    expect(back.project?.systems).toHaveLength(5);
    expect(back.project?.connections).toHaveLength(4);
    // The demo's echo leg ships fully bound (ready edge on load).
    expect(back.project?.connections.find((c) => c.id === "conn_demo_4")?.sourceOperationId).toBe("op_demo_forward");
    expect(back.project?.connections.every((c) => c.status === "draft")).toBe(true);
  });

  it("rejects foreign files and version drift", () => {
    expect(importProject({ kind: "nope" }).project).toBeNull();
    expect(importProject(null).project).toBeNull();
    const file = exportProject(buildDemoProject());
    expect(importProject({ ...file, version: 999, project: { ...file.project, schemaVersion: 999 } }).project).toBeNull();
  });

  it("demo topology is internally consistent", () => {
    const demo = buildDemoProject();
    const { project, issues } = validateProject(JSON.parse(JSON.stringify(demo)));
    expect(issues).toEqual([]);
    expect(project?.systems.length).toBeGreaterThanOrEqual(3);
  });

  it("loads vintage slice-1 records by defaulting registries", () => {
    const { project, issues } = validateProject({
      id: "p1",
      name: "Old",
      schemaVersion: 1,
      updatedAt: 1,
      systems: [{ id: "s1", name: "A", systemType: "rest", description: "", position: { x: 0, y: 0 }, iconKey: "bolt" }],
      connections: [{ id: "c1", sourceId: "s1", targetId: "s1", label: "", status: "draft" }],
    });
    expect(issues).toEqual([]);
    expect(project?.interfaces).toEqual([]);
    expect(project?.operations).toEqual([]);
    expect(project?.notes).toBe("");
    expect(project?.todos).toEqual([]);
  });

  it("validates project TODOs and rejects bad ones", () => {
    const good = {
      id: "t1", title: "Verify", body: "x", assignee: "Asha",
      dueDate: "2026-10-05", status: "in-progress", createdAt: 1, updatedAt: 2,
    };
    const base = {
      id: "p1", name: "P", schemaVersion: 1, updatedAt: 1,
      systems: [], connections: [], notes: "# Plan",
      todos: [good, { id: "t1", title: "dup", status: "open" }],
    };
    const dup = validateProject(base);
    expect(dup.project).toBeNull();
    expect(dup.issues.some((i) => i.message.includes("Duplicate TODO"))).toBe(true);
    const bad = validateProject({ ...base, todos: [{ id: "t2", title: 42, status: "open" }, { id: "t3", title: "x", status: "eventually" }] });
    expect(bad.project).toBeNull();
    expect(bad.issues.length).toBeGreaterThanOrEqual(2);
    const ok = validateProject({ ...base, todos: [good] });
    expect(ok.issues).toEqual([]);
    expect(ok.project?.notes).toBe("# Plan");
    expect(ok.project?.todos[0].assignee).toBe("Asha");
  });

  it("carries the dual-format notes triple and migrates vintage notes", () => {
    const base = { id: "p1", name: "P", schemaVersion: 1, updatedAt: 1, systems: [], connections: [], todos: [] };
    // Vintage markdown-only notes validate and migrate on first touch.
    const vintage = validateProject({ ...base, notes: "# Plan" });
    expect(vintage.issues).toEqual([]);
    expect(vintage.project?.notesFormat).toBeUndefined();
    expect(systemNotesToNote(vintage.project!).format).toBe("md");
    expect(systemNotesToNote(vintage.project!).html).toContain("<h1>Plan</h1>");
    // Rich triple validates, round-trips, and rejects junk formats.
    const triple = noteToSystemNotes(noteBodyFromHtml("<p>Hi <strong>there</strong></p>"));
    const rich = validateProject({ ...base, notes: triple.notes, notesFormat: triple.notesFormat, notesHtml: triple.notesHtml });
    expect(rich.issues).toEqual([]);
    expect(systemNotesToNote(rich.project!).format).toBe("rich");
    const junk = validateProject({ ...base, notes: "", notesFormat: "quill", notesHtml: 42 });
    expect(junk.issues).toEqual([]);
    expect(junk.project?.notesFormat).toBeUndefined();
    expect(junk.project?.notesHtml).toBeUndefined();
    // Empty drafts clear the triple.
    expect(noteToSystemNotes(noteBodyFromMd("  "))).toEqual({ notes: "", notesFormat: undefined, notesHtml: undefined });
  });

  it("derives readiness from live bindings, never stored status", () => {
    const demo = buildDemoProject();
    const byId = (id: string) => demo.connections.find((c) => c.id === id)!;
    // conn_demo_1: source op bound (belongs to source) -> partial
    expect(connectionReadiness(byId("conn_demo_1"), demo)).toBe("partial");
    // conn_demo_2: nothing bound -> draft
    expect(connectionReadiness(byId("conn_demo_2"), demo)).toBe("draft");
    // both ends bound correctly -> ready
    const ready = { ...byId("conn_demo_1"), targetOperationId: "op_demo_incident" };
    expect(connectionReadiness(ready, demo)).toBe("ready");
    // binding to an op on the WRONG end reads as unbound
    const swapped = { ...byId("conn_demo_1"), sourceOperationId: "op_demo_incident", targetOperationId: undefined };
    expect(connectionReadiness(swapped, demo)).toBe("draft");
    // binding to a deleted operation reads as unbound
    const gone = { ...byId("conn_demo_1"), sourceOperationId: "op_missing" };
    expect(connectionReadiness(gone, demo)).toBe("draft");
  });

  it("rejects bindings to foreign operations on import", () => {
    const demo = buildDemoProject();
    const file = exportProject(demo);
    const tampered = JSON.parse(JSON.stringify(file)) as typeof file;
    (tampered.project.connections[0] as { targetOperationId: string }).targetOperationId = "op_demo_lead";
    const { project, issues } = importProject(tampered);
    expect(project).toBeNull();
    expect(issues.some((i) => i.path.includes("targetOperationId"))).toBe(true);
  });

  it("validates edge mappings and system base URLs", () => {
    const demo = buildDemoProject();
    const file = exportProject(demo);
    const tampered = JSON.parse(JSON.stringify(file)) as typeof file;
    const conn = tampered.project.connections[0] as unknown as Record<string, unknown>;
    conn.mapping = { mode: "sideways", template: "x".repeat(20000) };
    const bad = importProject(tampered);
    expect(bad.project).toBeNull();
    expect(bad.issues.some((i) => i.path.includes("mapping.mode"))).toBe(true);
    const sys = tampered.project.systems[0] as unknown as Record<string, unknown>;
    sys.baseUrl = 42;
    const bad2 = importProject(tampered);
    expect(bad2.project).toBeNull();
    expect(bad2.issues.some((i) => i.path.includes("baseUrl"))).toBe(true);
  });

  it("rejects bad methods and dangling interface refs", () => {    const demo = buildDemoProject();
    const file = exportProject(demo);
    const tampered = JSON.parse(JSON.stringify(file)) as typeof file;
    tampered.project.operations.push({
      id: "op_bad", interfaceId: "nope", name: "X", method: "FROBNICATE", path: "/", version: "v1",
    } as never);
    const { issues } = importProject(tampered);
    expect(issues.some((i) => i.path.includes("interfaceId"))).toBe(true);
    expect(issues.some((i) => i.path.includes("method"))).toBe(true);
  });

  it("slugifies file names", () => {
    expect(projectFileName("Lead Triage Flow!")).toBe("lead-triage-flow.sobject-system.json");
    expect(projectFileName("  ")).toBe("architecture.sobject-system.json");
  });

  it("validates operation headers", () => {
    const demo = buildDemoProject();
    const file = exportProject(demo);
    const tampered = JSON.parse(JSON.stringify(file)) as typeof file;
    const op = tampered.project.operations[0] as unknown as Record<string, unknown>;
    op.headers = [
      { key: "Authorization", value: "Bearer $env.K" },
      { key: "", value: "x" },
    ];
    const bad = importProject(tampered);
    expect(bad.project).toBeNull();
    expect(bad.issues.some((i) => i.path.includes("headers[1].key"))).toBe(true);
    op.headers = [{ key: "Authorization", value: "Bearer $env.K" }];
    const good = importProject(tampered);
    expect(good.issues).toEqual([]);
    expect(good.project?.operations[0].headers).toEqual([{ key: "Authorization", value: "Bearer $env.K" }]);
  });
});
