import { z } from "zod";
import { noteBodyFromMd, type NoteBody, type NoteFormat } from "@/lib/notes/notebody";
import type { InboxItemKind } from "@/lib/inbox/types";

/**
 * Console domain model - the architect's personal task console.
 *
 * ConsoleTask is the writable personal layer. Canvas records (System project
 * TODOs/notes) are addressed through links, never duplicated: the sync engine
 * (lib/console/sync.ts) pulls them into linked views and pushes Console edits
 * back to the owning record. Last-write-wins on updatedAt; every cross-write
 * appends history on both sides.
 */

export const CONSOLE_STATUSES = ["open", "in-progress", "blocked", "awaiting-feedback", "resolved"] as const;
export type ConsoleStatus = (typeof CONSOLE_STATUSES)[number];

export const CONSOLE_STATUS_LABELS: Record<ConsoleStatus, string> = {
  open: "Open",
  "in-progress": "In Progress",
  blocked: "Blocked",
  "awaiting-feedback": "Awaiting Feedback",
  resolved: "Resolved",
};

/** Short queue key, e.g. CX-9K2Q - stable per task, JIRA-style. */
export function consoleTaskKey(task: Pick<ConsoleTask, "id" | "createdAt">): string {
  return `CX-${task.createdAt.toString(36).toUpperCase().slice(-4)}`;
}

export const CONSOLE_PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type ConsolePriority = (typeof CONSOLE_PRIORITIES)[number];

/** Address of a canvas record this task tracks. */
export interface ConsoleLink {
  /** Owning surface. Only "system" syncs two-way in v1; others are jump links. */
  surface: "system" | "wireframe" | "sequence" | "draw" | "schema" | "decision" | "requirement" | "notes";
  /** Owning record id (e.g. System project id). */
  recordId: string;
  /** Canvas TODO id when tracking one TODO; absent when tracking the whole record. */
  todoId?: string;
  /** Display label captured at link time - refreshed on pull. */
  label: string;
}

/**
 * Minimal canvas-view shape for grouping (mirrors CanvasLinkView without
 * importing the sync engine - model stays cycle-free).
 */
export interface CanvasViewRef {
  surface: string;
  recordId: string;
  recordName: string;
  todoId?: string;
  updatedAt: number;
}

export interface CanvasViewGroup<T extends CanvasViewRef> {
  surface: string;
  recordId: string;
  recordName: string;
  items: T[];
}

const CANVAS_SURFACE_ORDER = ["system", "schema", "notes"];

/**
 * Group live canvas views by owning canvas: one section per record, notes
 * (whole-record) before TODOs, newest first. Surfaces follow studio order.
 */
export function groupCanvasViews<T extends CanvasViewRef>(views: T[]): CanvasViewGroup<T>[] {
  const map = new Map<string, CanvasViewGroup<T>>();
  for (const v of views) {
    const key = `${v.surface}::${v.recordId}`;
    let g = map.get(key);
    if (!g) {
      g = { surface: v.surface, recordId: v.recordId, recordName: v.recordName, items: [] };
      map.set(key, g);
    }
    g.items.push(v);
  }
  for (const g of map.values()) {
    g.items.sort((a, b) => (a.todoId ? 1 : -1) - (b.todoId ? 1 : -1) || b.updatedAt - a.updatedAt);
  }
  return [...map.values()].sort(
    (a, b) =>
      CANVAS_SURFACE_ORDER.indexOf(a.surface) - CANVAS_SURFACE_ORDER.indexOf(b.surface) ||
      a.recordName.localeCompare(b.recordName),
  );
}

/** Studio tab route for each linkable surface - Console links jump, never copy. */
export const CONSOLE_SURFACE_ROUTES: Record<ConsoleLink["surface"], string> = {
  system: "/system",
  wireframe: "/wireframe",
  sequence: "/sequence",
  draw: "/draw",
  schema: "/",
  decision: "/decisions",
  requirement: "/requirements",
  notes: "/notes",
};

/**
 * Where a Console link opens: the exact record when addressable, else the
 * owning studio tab. Canvas TODO granularity stays project-level - the
 * designer has no todo selection to land on.
 */
export function consoleLinkHref(link: Pick<ConsoleLink, "surface"> & Partial<Pick<ConsoleLink, "recordId">>): string {
  const id = (link.recordId ?? "").trim();
  const q = id ? encodeURIComponent(id) : "";
  switch (link.surface) {
    case "decision":
      return q ? `/decisions?id=${q}` : "/decisions";
    case "requirement":
      return q ? `/requirements?id=${q}` : "/requirements";
    case "sequence":
      return q ? `/sequence?id=${q}` : "/sequence";
    case "wireframe":
      return q ? `/wireframe?exp=${q}` : "/wireframe";
    case "system":
      return q ? `/system?project=${q}` : "/system";
    case "schema":
      return q ? `/?mode=schema&canvas=${q}` : "/?mode=schema";
    case "draw":
      return "/draw";
    case "notes":
      return q ? `/notes?id=${q}` : "/notes";
    default:
      return CONSOLE_SURFACE_ROUTES[link.surface] ?? "/console";
  }
}

export interface ConsoleNote {
  id: string;
  at: number;
  text: string;
}

/** Screenshot/file pinned to a task. Bytes live in the console-attachments IDB store, never in the task record. */
export interface ConsoleAttachment {
  id: string;
  taskId: string;
  name: string;
  mime: string;
  size: number;
  dataUrl: string;
  at: number;
}

export const CONSOLE_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;
export const CONSOLE_ATTACHMENT_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export interface ConsoleHistoryEntry {
  at: number;
  what: string;
}

/** Push-only PMO backlink: where this entry was pushed, for the ↗ chip. */
export interface ConsolePmoLink {
  system: "jira" | "snow";
  key: string;
  url: string;
  at: number;
}

export interface ConsoleTask {
  id: string;
  title: string;
  /** Work kind synced from canvas entries - note, task, question, decision. Absent reads as task. */
  kind?: InboxItemKind;
  /** Work owner synced from canvas entries (entry owner, else assignee). */
  owner?: string;
  /** Markdown side of the description (previews, search, queue, AI). */
  body?: string;
  /** Rich side of the description + the editor last used. Absent on
   * vintage records - the Markdown side migrates them on first touch. */
  bodyFormat?: NoteFormat;
  bodyHtml?: string;
  status: ConsoleStatus;
  priority: ConsolePriority;
  dueDate?: string;
  /** Set on push - the issue key / incident number this entry became. */
  pmo?: ConsolePmoLink;
  links: ConsoleLink[];
  notes: ConsoleNote[];
  history: ConsoleHistoryEntry[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Stored description triple → editor-ready dual body. Vintage tasks carry
 * Markdown only and migrate on first touch; rich tasks keep their side.
 */
export function consoleBodyToNote(t: Pick<ConsoleTask, "body" | "bodyFormat" | "bodyHtml">): NoteBody {
  if (t.bodyFormat === "rich" && t.bodyHtml?.trim()) {
    return { format: "rich", md: t.body ?? "", html: t.bodyHtml };
  }
  return noteBodyFromMd(t.body ?? "");
}

/** Editor draft → storable triple. Empty drafts clear all three sides. */
export function noteToConsoleBody(b: NoteBody): Pick<ConsoleTask, "body" | "bodyFormat" | "bodyHtml"> {
  if (!b.md.trim() && !b.html.trim()) return { body: undefined, bodyFormat: undefined, bodyHtml: undefined };
  return { body: b.md, bodyFormat: b.format, bodyHtml: b.html };
}

export function newConsoleTask(title: string, now = Date.now()): ConsoleTask {
  const clean = title.trim().slice(0, 160);
  return {
    id: `task_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    title: clean,
    status: "open",
    priority: "normal",
    links: [],
    notes: [],
    history: [{ at: now, what: "Logged in Console." }],
    createdAt: now,
    updatedAt: now,
  };
}

const linkSchema = z.object({
  surface: z.enum(["system", "wireframe", "sequence", "draw", "schema", "decision", "requirement", "notes"]),
  recordId: z.string().min(1).max(160),
  todoId: z.string().min(1).max(160).optional(),
  label: z.string().max(200),
});

export const consoleTaskSchema: z.ZodType<ConsoleTask> = z.object({
  id: z.string().min(1).max(160),
  title: z.string().min(1).max(160),
  kind: z.enum(["note", "task", "question", "decision"]).optional(),
  owner: z.string().max(120).optional(),
  body: z.string().max(12000).optional(),
  bodyFormat: z.enum(["md", "rich"]).optional(),
  bodyHtml: z.string().max(30000).optional(),
  status: z.enum(CONSOLE_STATUSES),
  priority: z.enum(CONSOLE_PRIORITIES),
  dueDate: z.string().max(32).optional(),
  pmo: z
    .object({
      system: z.enum(["jira", "snow"]),
      key: z.string().min(1).max(32),
      url: z.string().min(1).max(500),
      at: z.number(),
    })
    .optional(),
  links: z.array(linkSchema).max(24),
  notes: z
    .array(z.object({ id: z.string().min(1), at: z.number(), text: z.string().min(1).max(4000) }))
    .max(200),
  history: z.array(z.object({ at: z.number(), what: z.string().min(1).max(500) })).max(500),
  createdAt: z.number(),
  updatedAt: z.number(),
});

/**
 * Status transitions. blocked and awaiting-feedback are working states that
 * return to the flow (reopen to open); resolved is terminal unless reopened.
 */
const TRANSITIONS: Record<ConsoleStatus, ConsoleStatus[]> = {
  open: ["in-progress", "blocked", "resolved"],
  "in-progress": ["open", "blocked", "awaiting-feedback", "resolved"],
  blocked: ["open", "in-progress"],
  "awaiting-feedback": ["open", "in-progress"],
  resolved: ["open"],
};

export function canTransition(from: ConsoleStatus, to: ConsoleStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

/** Targets offered in the status dropdown - everything reachable from here. */
export function nextStatuses(from: ConsoleStatus): ConsoleStatus[] {
  return [...TRANSITIONS[from]];
}

export function moveTask(task: ConsoleTask, to: ConsoleStatus, now = Date.now()): ConsoleTask {
  if (!canTransition(task.status, to)) return task;
  if (task.status === to) return task;
  return {
    ...task,
    status: to,
    updatedAt: now,
    history: [...task.history, { at: now, what: `Moved ${task.status} → ${to}.` }].slice(-500),
  };
}

export function addNote(task: ConsoleTask, text: string, now = Date.now()): ConsoleTask {
  const clean = text.trim().slice(0, 4000);
  if (!clean) return task;
  return {
    ...task,
    notes: [...task.notes, { id: `note_${now.toString(36)}`, at: now, text: clean }].slice(-200),
    updatedAt: now,
    history: [...task.history, { at: now, what: "Note added." }].slice(-500),
  };
}
