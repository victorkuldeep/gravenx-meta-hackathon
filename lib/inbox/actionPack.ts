"use client";

/**
 * Action Pack compiler: pure function from normalized inbox items to a
 * circulation-ready Markdown document. No React, no IndexedDB, no invented
 * content - absent fields are omitted or marked Unassigned, empty sections
 * are dropped, short refs are deterministic per compile.
 */

import type { ArchitectureInboxItem } from "./types";

export interface ActionPackOptions {
  /** "outstanding" drops resolved items; "all" keeps them. */
  scope: "outstanding" | "all";
  orgLabel: string;
  preparedBy?: string;
}

export interface ActionPackManifest {
  itemCount: number;
  openTasks: number;
  openQuestions: number;
  resolved: number;
  stale: number;
  warnings: string[];
}

export interface ActionPackResult {
  markdown: string;
  manifest: ActionPackManifest;
  fileName: string;
}

/** Escape table cells; block bodies keep paragraphs and code intact. */
export function escapeCell(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n+/g, " ").replace(/\|/g, "\\|").trim();
}

function shortRefs(items: ArchitectureInboxItem[]): Map<string, string> {
  // Deterministic per compile: kind order, then updatedAt, then id.
  const order = [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
    return a.id < b.id ? -1 : 1;
  });
  const prefix: Record<string, string> = { task: "A", question: "Q", decision: "D", note: "N" };
  const counters: Record<string, number> = {};
  const refs = new Map<string, string>();
  for (const item of order) {
    const p = prefix[item.kind] ?? "N";
    counters[p] = (counters[p] ?? 0) + 1;
    refs.set(item.id, `${p}-${String(counters[p]).padStart(3, "0")}`);
  }
  return refs;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function actionPackFileName(orgLabel: string, now = Date.now()): string {
  const slug = orgLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "org";
  return `architecture-action-pack-${slug}-${fmtDate(now)}.md`;
}

export function compileActionPack(
  items: ArchitectureInboxItem[],
  options: ActionPackOptions,
  now = Date.now()
): ActionPackResult {
  const included =
    options.scope === "outstanding"
      ? items.filter((i) => i.status !== "resolved")
      : [...items];
  // Deterministic document order: open first, tasks before notes, recent first.
  const ordered = [...included].sort((a, b) => {
    const openA = a.status === "open" ? 0 : 1;
    const openB = b.status === "open" ? 0 : 1;
    if (openA !== openB) return openA - openB;
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return a.id < b.id ? -1 : 1;
  });
  const refs = shortRefs(ordered);
  const ref = (id: string) => refs.get(id) ?? id;

  const tasks = ordered.filter((i) => i.kind === "task" && i.status !== "resolved");
  const questions = ordered.filter((i) => i.kind === "question" && i.status !== "resolved");
  const decisions = ordered.filter((i) => i.kind === "decision");
  const resolved = ordered.filter((i) => i.status === "resolved");
  const stale = ordered.filter((i) => i.stale === "missing");
  const notes = ordered.filter((i) => i.kind === "note" && i.status !== "resolved");

  const warnings: string[] = [];
  if (stale.length > 0) {
    warnings.push(
      `${stale.length} item${stale.length === 1 ? " has" : "s have"} anchors missing from the current schema - review before acting: ${stale.map((i) => ref(i.id)).join(", ")}.`
    );
  }

  const canvases = [...new Set(ordered.map((i) => i.canvasName))];
  const lines: string[] = [];
  lines.push("# Architecture Action Pack");
  lines.push("");
  lines.push("> GRAVENX · Schema Explorer");
  lines.push("");
  lines.push("## Document Control");
  lines.push("");
  lines.push(`- Org: ${options.orgLabel}`);
  lines.push(`- Included canvases: ${canvases.length > 0 ? canvases.join(", ") : "none"}`);
  lines.push(`- Compiled: ${fmtDate(now)}`);
  lines.push(`- Scope: ${options.scope === "outstanding" ? "Outstanding items only" : "All items"}`);
  if (options.preparedBy) lines.push(`- Prepared by: ${options.preparedBy}`);
  lines.push("");
  lines.push("## Review Metrics");
  lines.push("");
  lines.push(`- Open tasks: ${ordered.filter((i) => i.kind === "task" && i.status === "open").length}`);
  lines.push(`- Open questions: ${questions.length}`);
  lines.push(`- Decisions: ${decisions.length}`);
  lines.push(`- Stale anchors: ${stale.length}`);
  lines.push("");

  if (tasks.length > 0) {
    lines.push("## Priority Actions");
    lines.push("");
    lines.push("| ID | Action | Anchor | Status |");
    lines.push("|---|---|---|---|");
    for (const t of tasks) {
      lines.push(
        `| ${ref(t.id)} | ${escapeCell(t.title)} | ${escapeCell(t.anchor.id)} | ${t.status} | <!-- ${t.id} -->`
      );
    }
    lines.push("");
    for (const t of tasks) {
      lines.push(`### ${ref(t.id)} — ${escapeCell(t.title)}`);
      lines.push("");
      lines.push(`- Canvas: ${t.canvasName}`);
      lines.push(`- Anchor: ${t.anchor.id}`);
      lines.push(`- Status: ${t.status}`);
      lines.push("");
      lines.push(t.body.trim());
      lines.push("");
    }
  }

  if (questions.length > 0) {
    lines.push("## Open Questions");
    lines.push("");
    for (const q of questions) {
      lines.push(`### ${ref(q.id)} — ${escapeCell(q.title)}`);
      lines.push("");
      lines.push(`- Canvas: ${q.canvasName}`);
      lines.push(`- Anchor: ${q.anchor.id}`);
      lines.push(`- Status: ${q.status}`);
      lines.push("");
      lines.push("**Question**");
      lines.push("");
      lines.push(q.body.trim());
      lines.push("");
    }
  }

  if (decisions.length > 0) {
    lines.push("## Decisions");
    lines.push("");
    for (const d of decisions) {
      lines.push(`### ${ref(d.id)} — ${escapeCell(d.title)}`);
      lines.push("");
      lines.push(`- Canvas: ${d.canvasName}`);
      lines.push(`- Anchor: ${d.anchor.id}`);
      lines.push(`- Status: ${d.status}`);
      lines.push("");
      lines.push(d.body.trim());
      lines.push("");
    }
  }

  if (notes.length > 0) {
    lines.push("## Design Notes");
    lines.push("");
    for (const n of notes) {
      lines.push(`### ${ref(n.id)} — ${escapeCell(n.title)}`);
      lines.push("");
      lines.push(`- Canvas: ${n.canvasName}`);
      lines.push(`- Anchor: ${n.anchor.id}`);
      lines.push("");
      lines.push(n.body.trim());
      lines.push("");
    }
  }

  if (resolved.length > 0) {
    lines.push("## Resolved Items");
    lines.push("");
    for (const r of resolved) {
      lines.push(`- ${ref(r.id)} ${escapeCell(r.title)} (${r.anchor.id}) <!-- ${r.id} -->`);
    }
    lines.push("");
  }

  if (stale.length > 0) {
    lines.push("## Schema Review");
    lines.push("");
    for (const s of stale) {
      lines.push(`- ${ref(s.id)} ${escapeCell(s.title)} - anchor \`${s.anchor.id}\` missing from current schema, review required <!-- ${s.id} -->`);
    }
    lines.push("");
  }

  lines.push("## Canvas Index");
  lines.push("");
  for (const c of canvases) {
    const count = ordered.filter((i) => i.canvasName === c).length;
    lines.push(`- ${c} (${count} item${count === 1 ? "" : "s"})`);
  }
  lines.push("");
  lines.push("## Notes on Interpretation");
  lines.push("");
  lines.push("- Proposed decisions are not approvals.");
  lines.push("- Missing owners and due dates are intentionally left unassigned.");
  lines.push("- Stale anchors require architect review.");
  lines.push("- This is a design-time artifact, not a runtime guarantee.");
  lines.push("");

  return {
    markdown: lines.join("\n"),
    manifest: {
      itemCount: ordered.length,
      openTasks: tasks.length,
      openQuestions: questions.length,
      resolved: resolved.length,
      stale: stale.length,
      warnings,
    },
    fileName: actionPackFileName(options.orgLabel, now),
  };
}
