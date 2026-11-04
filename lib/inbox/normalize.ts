"use client";

/**
 * Normalization adapters: existing records (autosave notes slice, manual
 * snapshots) become ArchitectureInboxItems without changing their storage.
 * Mapping preserves existing semantics:
 * - entry kind absent (vintage canvas TODO) -> kind "task"
 * - status "done" -> "resolved", else verbatim
 * - canvas markdown / snapshot notes -> kind "note" (never inferred as task)
 * - empty prose notes are skipped; actionable kinds always list
 */

import type {
  ArchitectureInboxItem,
  CanvasTodo,
  InboxMeta,
  InboxQuery,
  StaleState,
} from "./types";
import { isCanvasScope } from "./types";
import type { ErdSnapshot } from "@/lib/erd/snapshotDb";
import { fingerprintEntity, fingerprintField, type EntityFacts, type FieldFacts } from "./schemaReview";

export interface LiveNotesInput {
  orgScopeId: string;
  text: string;
  textFormat?: "md" | "rich";
  textHtml?: string;
  updatedAt: number | null;
  /** Unified log: entity entries + canvas-scope rows (one map now). */
  entries: CanvasTodo[];
  labels: Map<string, string>;
}

export interface SnapshotMetaInput {
  notes?: string;
  meta?: InboxMeta;
}

export interface SnapshotInput {
  snapshot: ErdSnapshot & { noteMeta?: InboxMeta };
  orgScopeId: string;
}

/** Live schema knowledge for staleness resolution. Pure data, no fetching. */
export interface StaleContext {
  knownApis: Set<string>;
  entities: Map<string, EntityFacts>;
  fields: Map<string, FieldFacts>;
}

function firstLine(text: string, max = 90): string {
  const line = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const clean = line.replace(/^#{1,3}\s+|^[-*]\s+(\[[ xX]\]\s+)?|^\d+[.)]\s+|^\d+(?:\.\d+)+[.)]\s+/, "");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function normalizeLiveNotes(input: LiveNotesInput): ArchitectureInboxItem[] {
  const items: ArchitectureInboxItem[] = [];
  const { orgScopeId, text, textFormat, textHtml, updatedAt, entries, labels } = input;
  if (text.trim()) {
    items.push({
      id: "live-canvas",
      orgScopeId,
      canvasId: "live",
      canvasName: "Live canvas",
      kind: "note",
      status: "open",
      title: "Canvas design notes",
      body: text,
      bodyFormat: textFormat,
      bodyHtml: textHtml,
      anchor: { type: "canvas", id: "live" },
      createdAt: updatedAt ?? Date.now(),
      updatedAt: updatedAt ?? Date.now(),
      stale: "ok",
      history: [],
      provenance: { source: "live-canvas" },
    });
  }
  for (const t of entries) {
    const kind = t.kind ?? "task";
    const body = t.body ?? "";
    // Empty prose notes carry nothing; actionable kinds always list.
    if (!body.trim() && !t.title.trim() && kind === "note") continue;
    // Canvas-scope rows unify onto live-entry ids; the scope (not the id)
    // keeps them canvas-anchored and stale-clean below.
    const api = t.entityApi && !isCanvasScope(t.entityApi) ? t.entityApi : undefined;
    items.push({
      id: `live-entry-${t.id}`,
      orgScopeId,
      canvasId: "live",
      canvasName: "Live canvas",
      kind,
      status: t.status === "done" ? "resolved" : t.status,
      title: t.title.trim() || (api ? (labels.get(api) ?? api) : "Untitled entry"),
      body,
      bodyFormat: t.bodyFormat,
      bodyHtml: t.bodyHtml,
      anchor: t.anchor ?? (api ? { type: "entity", id: api, labelAtCreation: labels.get(api) } : { type: "canvas", id: "live" }),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      stale: api ? "unknown" : "ok",
      owner: t.owner ?? t.assignee,
      team: t.team,
      priority: t.priority,
      dueDate: t.dueDate,
      resolution: t.resolution,
      decisionState: t.decisionState,
      fingerprint: t.fingerprint,
      anchorFacts: t.anchorFacts,
      history: t.history ?? [],
      provenance: { source: api ? "live-entry" : "live-canvas" },
    });
  }
  return items;
}

export function normalizeSnapshotNotes(input: SnapshotInput): ArchitectureInboxItem[] {
  const { snapshot, orgScopeId } = input;
  if (!snapshot.notes?.trim()) return [];
  const meta = snapshot.noteMeta ?? {};
  return [
    {
      id: `snap-${snapshot.id}`,
      orgScopeId,
      canvasId: snapshot.id,
      canvasName: snapshot.name,
      kind: meta.kind ?? "note",
      status: meta.status ?? "open",
      title: `Snapshot notes - ${snapshot.name}`,
      body: snapshot.notes,
      bodyFormat: snapshot.notesFormat,
      bodyHtml: snapshot.notesHtml,
      anchor: meta.anchor ?? { type: "canvas", id: snapshot.id, labelAtCreation: snapshot.name },
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.createdAt,
      stale: "unknown",
      owner: meta.owner,
      team: meta.team,
      priority: meta.priority,
      dueDate: meta.dueDate,
      resolution: meta.resolution,
      decisionState: meta.decisionState,
      fingerprint: meta.fingerprint,
      anchorFacts: meta.anchorFacts,
      history: meta.history ?? [],
      provenance: { source: "snapshot", snapshotId: snapshot.id },
    },
  ];
}

/** Resolve "unknown" staleness against live schema knowledge. Pure. */
export function resolveStale(
  items: ArchitectureInboxItem[],
  ctx: StaleContext
): ArchitectureInboxItem[] {
  return items.map((item) => {
    if (item.stale !== "unknown") return item;
    const anchor = item.anchor;
    if (anchor.type === "entity") {
      if (!ctx.knownApis.has(anchor.id)) return { ...item, stale: "missing" as StaleState };
      if (item.fingerprint) {
        const live = ctx.entities.get(anchor.id);
        if (live && fingerprintEntity(live) !== item.fingerprint.value) {
          return { ...item, stale: "changed" as StaleState };
        }
      }
      return { ...item, stale: "ok" as StaleState };
    }
    if (anchor.type === "field" || anchor.type === "relationship") {
      const live = ctx.fields.get(anchor.id);
      if (!live) return { ...item, stale: "missing" as StaleState };
      if (item.fingerprint && fingerprintField(live) !== item.fingerprint.value) {
        return { ...item, stale: "changed" as StaleState };
      }
      return { ...item, stale: "ok" as StaleState };
    }
    return { ...item, stale: "ok" as StaleState };
  });
}

function matchesQuery(item: ArchitectureInboxItem, q: InboxQuery): boolean {
  if (q.kinds.length > 0 && !q.kinds.includes(item.kind)) return false;
  if (q.statuses.length > 0 && !q.statuses.includes(item.status)) return false;
  if (q.canvases.length > 0 && !q.canvases.includes(item.canvasId)) return false;
  if (q.staleOnly && item.stale !== "missing" && item.stale !== "changed") return false;
  const t = q.text.trim().toLowerCase();
  if (t) {
    const hay = `${item.title}\n${item.body}\n${item.anchor.id}\n${item.anchor.labelAtCreation ?? ""}\n${item.canvasName}`.toLowerCase();
    // All tokens must match somewhere (AND semantics), whitespace-normalized.
    const tokens = t.split(/\s+/).filter(Boolean);
    if (!tokens.every((tok) => hay.includes(tok))) return false;
  }
  return true;
}

/** Deterministic workflow sort: open tasks/questions first, then by recency. */
const KIND_RANK: Record<string, number> = { task: 0, question: 1, decision: 2, note: 3 };
const STATUS_RANK: Record<string, number> = { open: 0, "in-progress": 1, blocked: 2, "awaiting-feedback": 2, resolved: 3 };

export function queryInbox(items: ArchitectureInboxItem[], q: InboxQuery): ArchitectureInboxItem[] {
  return items
    .filter((item) => matchesQuery(item, q))
    .sort((a, b) => {
      const openA = a.status === "open" ? 0 : 1;
      const openB = b.status === "open" ? 0 : 1;
      if (openA !== openB) return openA - openB;
      const ka = KIND_RANK[a.kind] ?? 9;
      const kb = KIND_RANK[b.kind] ?? 9;
      if (ka !== kb) return ka - kb;
      const sa = STATUS_RANK[a.status] ?? 9;
      const sb = STATUS_RANK[b.status] ?? 9;
      if (sa !== sb) return sa - sb;
      if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
      return a.id < b.id ? -1 : 1;
    });
}

export interface InboxCounts {
  total: number;
  open: number;
  tasks: number;
  openTasks: number;
  questions: number;
  decisions: number;
  stale: number;
  resolved: number;
}

export function countInbox(items: ArchitectureInboxItem[]): InboxCounts {
  const counts: InboxCounts = {
    total: items.length,
    open: 0,
    tasks: 0,
    openTasks: 0,
    questions: 0,
    decisions: 0,
    stale: 0,
    resolved: 0,
  };
  for (const item of items) {
    if (item.status === "open") counts.open++;
    if (item.status === "resolved") counts.resolved++;
    if (item.kind === "task") {
      counts.tasks++;
      if (item.status === "open") counts.openTasks++;
    }
    if (item.kind === "question") counts.questions++;
    if (item.kind === "decision") counts.decisions++;
    if (item.stale === "missing" || item.stale === "changed") counts.stale++;
  }
  return counts;
}

export { firstLine };
