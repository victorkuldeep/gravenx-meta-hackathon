"use client";

/**
 * Architecture Inbox domain model (Phase 1): a normalized, read-mostly view
 * over existing records - live canvas/entity notes (autosave slice) and
 * manual snapshots (erd-snapshots store). No duplicate editable copies: the
 * Inbox edits the canonical record through caller-supplied writers.
 */

import { noteBodyFromMd, type NoteBody, type NoteFormat } from "@/lib/notes/notebody";

export type InboxItemKind = "note" | "task" | "question" | "decision";

/** One lifecycle everywhere: Console, canvas TODOs and Inbox share it. */
export type InboxStatus = "open" | "in-progress" | "blocked" | "awaiting-feedback" | "resolved";

export type InboxPriority = "low" | "normal" | "high" | "critical";

export type DecisionState = "proposed" | "confirmed" | "rejected" | "superseded";

/** Canvas-level TODO status. Maps to InboxStatus (done → resolved); the working states are identical. */
export type CanvasTodoStatus = "open" | "in-progress" | "blocked" | "awaiting-feedback" | "done";

/**
 * One log entry: a canvas TODO or one row of an entity's log. Entity-level
 * entries carry entityApi (+ optional anchor); canvas-level entries leave it
 * absent. One type, two views: the entity log filters by api, the canvas
 * view shows everything grouped by entity. Canvas TODOs predate kinds and
 * read as tasks.
 */
export interface CanvasTodo {
  id: string;
  title: string;
  /** Markdown side of the details (previews, sync, share). */
  body?: string;
  /** Rich side of the details + the editor last used. Absent on vintage
   * TODOs - the Markdown side migrates them on first touch. */
  bodyFormat?: NoteFormat;
  bodyHtml?: string;
  assignee?: string;
  dueDate?: string;
  status: CanvasTodoStatus;
  createdAt: number;
  updatedAt: number;
  /** Entry kind - note, task, question or decision. Absent reads as task. */
  kind?: InboxItemKind;
  /** Entity API name when this entry belongs to an entity log. */
  entityApi?: string;
  owner?: string;
  team?: string;
  priority?: InboxPriority;
  resolution?: string;
  decisionState?: DecisionState;
  anchor?: InboxAnchor;
  fingerprint?: InboxFingerprint;
  anchorFacts?: AnchorFacts;
  history?: InboxHistoryEntry[];
}

export type AnchorType = "canvas" | "entity" | "field" | "relationship";

export type StaleState = "ok" | "missing" | "changed" | "unknown";

export interface InboxAnchor {
  type: AnchorType;
  /** Stable API name / canvas id - never a display label alone. */
  id: string;
  labelAtCreation?: string;
}

/** Meaningful-change log entry. Never keystrokes - explicit actions only. */
export interface InboxHistoryEntry {
  at: number;
  what: string;
}

/** Baseline schema facts captured when an anchor is created or reviewed. */
export type AnchorFacts =
  | { kind: "field"; type: string; required: boolean; referenceTo: string[]; label: string }
  | { kind: "entity"; fieldNames: string[]; childNames: string[] };

/** Stored hash + timestamp of the baseline facts. */
export interface InboxFingerprint {
  value: string;
  at: number;
}

/**
 * Optional lifecycle/anchor metadata layered onto existing records.
 * Everything optional - legacy records without meta keep working.
 */
export interface InboxMeta {
  kind?: InboxItemKind;
  status?: InboxStatus;
  owner?: string;
  team?: string;
  priority?: InboxPriority;
  dueDate?: string;
  resolution?: string;
  decisionState?: DecisionState;
  anchor?: InboxAnchor;
  fingerprint?: InboxFingerprint;
  anchorFacts?: AnchorFacts;
  history?: InboxHistoryEntry[];
}

export interface ArchitectureInboxItem {
  /** Stable canonical id: live-canvas | live-entry-<id> | snap-<snapshotId>. */
  id: string;
  orgScopeId: string;
  /** Source canvas: "live" or the snapshot id. Display name resolved by UI. */
  canvasId: string;
  canvasName: string;
  kind: InboxItemKind;
  status: InboxStatus;
  title: string;
  /** Markdown side of the body (search, Action Pack, default display). */
  body: string;
  /** Rich side + the editor last used, passed through from the canonical
   * record. Absent on vintage records - the Markdown side migrates them. */
  bodyFormat?: NoteFormat;
  bodyHtml?: string;
  anchor: InboxAnchor;
  createdAt: number;
  updatedAt: number;
  stale: StaleState;
  owner?: string;
  team?: string;
  priority?: InboxPriority;
  dueDate?: string;
  resolution?: string;
  decisionState?: DecisionState;
  fingerprint?: InboxFingerprint;
  anchorFacts?: AnchorFacts;
  history: InboxHistoryEntry[];
  provenance: {
    source: "live-canvas" | "live-entity" | "live-entry" | "snapshot";
    snapshotId?: string;
  };
}

export interface InboxQuery {
  text: string;
  kinds: InboxItemKind[];
  statuses: InboxStatus[];
  /** Canvas ids to include; empty = all. */
  canvases: string[];
  staleOnly: boolean;
}

export const EMPTY_QUERY: InboxQuery = {
  text: "",
  kinds: [],
  statuses: [],
  canvases: [],
  staleOnly: false,
};

/**
 * Stored TODO details triple → editor-ready dual body. Vintage TODOs carry
 * Markdown only and migrate on first touch.
 */
export function todoBodyToNote(t: Pick<CanvasTodo, "body" | "bodyFormat" | "bodyHtml">): NoteBody {
  if (t.bodyFormat === "rich" && t.bodyHtml?.trim()) {
    return { format: "rich", md: t.body ?? "", html: t.bodyHtml };
  }
  return noteBodyFromMd(t.body ?? "");
}

/**
 * Canvas-level log scope: canvas TODOs live in the same per-scope log map
 * as entity entries, keyed here. The key can never collide with a real
 * Salesforce api name, and surfaces label it "Canvas".
 */
export const CANVAS_LOG_API = "__canvas__";

/** True for rows of the canvas-level log (no Salesforce anchor). */
export function isCanvasScope(api: string | undefined): boolean {
  return api === CANVAS_LOG_API;
}

/** Local YYYY-MM-DD for Due floors - past dates are not pickable. */
export function todayIso(): string {
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Editor draft → storable triple. Empty drafts clear all three sides. */
export function noteToTodoBody(b: NoteBody): Pick<CanvasTodo, "body" | "bodyFormat" | "bodyHtml"> {
  if (!b.md.trim() && !b.html.trim()) return { body: undefined, bodyFormat: undefined, bodyHtml: undefined };
  return { body: b.md, bodyFormat: b.format, bodyHtml: b.html };
}

/** Inbox item body triple → editor-ready dual body (same migration rule). */
export function inboxBodyToNote(t: Pick<ArchitectureInboxItem, "body" | "bodyFormat" | "bodyHtml">): NoteBody {
  if (t.bodyFormat === "rich" && t.bodyHtml?.trim()) {
    return { format: "rich", md: t.body ?? "", html: t.bodyHtml };
  }
  return noteBodyFromMd(t.body ?? "");
}

/** Legacy single-note-per-entity shape (pre-log). */
export interface LegacyEntityNoteInput {
  text: string;
  textFormat?: NoteFormat;
  textHtml?: string;
  todo: boolean;
  done: boolean;
  updatedAt: number;
  meta?: InboxMeta;
}

function entryTitleFromText(text: string, fallback: string, max = 80): string {
  const line = text
    .split("\n")
    .map((l) => l.trim().replace(/^#{1,3}\s+|^[-*]\s+(\[[ xX]\]\s+)?|^\d+[.)]\s+|^\d+(?:\.\d+)+[.)]\s+/, ""))
    .find((l) => l.length > 0) ?? "";
  if (!line) return fallback;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * One-time migration: a legacy single entity note becomes a one-row log.
 * Empty notes (no text, no TODO, no meta) migrate to zero rows. Legacy
 * todo/done flags map onto kind/status; assignee mirrors owner so both the
 * TODO card ("Who") and the entity meta ("Owner") keep working.
 */
export function entityNoteToEntries(
  api: string,
  note: LegacyEntityNoteInput,
  label?: string,
  now = Date.now()
): CanvasTodo[] {
  if (!note.text.trim() && !note.todo && !note.meta) return [];
  const meta = note.meta ?? {};
  const kind: InboxItemKind = meta.kind ?? (note.todo ? "task" : "note");
  const status: CanvasTodoStatus =
    note.done || meta.status === "resolved" ? "done" : (meta.status ?? "open");
  const createdAt = meta.history?.[0]?.at ?? note.updatedAt;
  return [
    {
      id: `ent-${api}-${now.toString(36)}`,
      title: entryTitleFromText(note.text, label ?? api),
      body: note.text || undefined,
      bodyFormat: note.textFormat,
      bodyHtml: note.textHtml,
      assignee: meta.owner,
      dueDate: meta.dueDate,
      status,
      createdAt,
      updatedAt: note.updatedAt,
      kind,
      entityApi: api,
      owner: meta.owner,
      team: meta.team,
      priority: meta.priority,
      resolution: meta.resolution,
      decisionState: meta.decisionState,
      anchor: meta.anchor,
      fingerprint: meta.fingerprint,
      anchorFacts: meta.anchorFacts,
      history: meta.history,
    },
  ];
}

const SHARE_KINDS: InboxItemKind[] = ["note", "task", "question", "decision"];
const SHARE_STATUSES: CanvasTodoStatus[] = ["open", "in-progress", "blocked", "awaiting-feedback", "done"];

/**
 * Shared entity-log rows (Markdown-only) become entries with fresh ids.
 * Junk rows are dropped; an empty result means nothing to import.
 */
export function shareRowsToEntries(
  api: string,
  rows: { title?: unknown; text?: unknown; kind?: unknown; status?: unknown; updatedAt?: unknown }[],
  now = Date.now()
): CanvasTodo[] {
  const out: CanvasTodo[] = [];
  rows.forEach((row, i) => {
    if (!row || typeof row.text !== "string" || !row.text.trim()) return;
    const kind: InboxItemKind =
      typeof row.kind === "string" && (SHARE_KINDS as string[]).includes(row.kind) ? (row.kind as InboxItemKind) : "note";
    const status: CanvasTodoStatus =
      typeof row.status === "string" && (SHARE_STATUSES as string[]).includes(row.status)
        ? (row.status as CanvasTodoStatus)
        : "open";
    const at = typeof row.updatedAt === "number" ? row.updatedAt : now;
    out.push({
      id: `shr-${api}-${i.toString(36)}-${now.toString(36)}`,
      title: (typeof row.title === "string" && row.title.trim() ? row.title.trim() : entryTitleFromText(row.text, api)).slice(0, 160),
      body: row.text,
      kind,
      status,
      entityApi: api,
      createdAt: at,
      updatedAt: at,
    });
  });
  return out;
}

/**
 * Accept one persisted entity-log value in any known shape: the current
 * entry array, a legacy single note object, or junk (→ []). Never throws.
 */
export function migrateEntityLogValue(api: string, value: unknown, label?: string, now = Date.now()): CanvasTodo[] {
  if (Array.isArray(value)) {
    return (value as CanvasTodo[]).filter(
      (e) => e && typeof e.id === "string" && typeof e.updatedAt === "number"
    );
  }
  if (value && typeof value === "object") {
    const v = value as Partial<LegacyEntityNoteInput>;
    if (typeof v.text === "string" && typeof v.todo === "boolean") {
      return entityNoteToEntries(
        api,
        {
          text: v.text,
          textFormat: v.textFormat,
          textHtml: v.textHtml,
          todo: v.todo,
          done: v.done === true,
          updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : now,
          meta: v.meta,
        },
        label,
        now
      );
    }
  }
  return [];
}
