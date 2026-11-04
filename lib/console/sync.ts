import { isCanvasScope, noteToTodoBody, todoBodyToNote, type CanvasTodo, type CanvasTodoStatus, type InboxItemKind } from "@/lib/inbox/types";
import { appendNoteLine } from "@/lib/notes/notebody";
import type { SystemProject } from "@/lib/system-design/model";
import { listSystemProjects, loadSystemProject, saveSystemProject } from "@/lib/system-design/store";
import type { ConsoleStatus } from "./model";

/**
 * Two-way console sync. Surfaces plug in as adapters; System and Schema
 * (ERD canvas TODOs + entity log entries, every kind) sync in v1.
 *
 * Pull: canvas TODOs/notes become linked view models (never copies).
 * Push: Console edits write back through the surface's own store writers.
 * Guard: a push is refused as stale when the canvas record moved on
 * (updatedAt newer than the pulled snapshot) instead of clobbering.
 */

export type SyncSurface = "system" | "schema" | "notes";

export interface CanvasLinkView {
  surface: SyncSurface;
  recordId: string;
  recordName: string;
  todoId?: string;
  title: string;
  /** Entry kind for schema views (every kind syncs) - absent reads as task. */
  kind?: InboxItemKind;
  owner?: string;
  dueDate?: string;
  status: ConsoleStatus | null;
  updatedAt: number;
  excerpt?: string;
}

export interface PushResult {
  ok: boolean;
  stale?: boolean;
  error?: string;
}

/**
 * One lifecycle everywhere: only the terminal differs (done ↔ resolved).
 * Every working state - open, in-progress, blocked, awaiting-feedback -
 * syncs verbatim in both directions, canvas TODOs included.
 */
export function canvasToConsole(status: CanvasTodoStatus): ConsoleStatus {
  return status === "done" ? "resolved" : status;
}

export function consoleToCanvas(status: ConsoleStatus): CanvasTodoStatus {
  return status === "resolved" ? "done" : status;
}

export interface SystemStoreFns {
  list: () => Promise<{ id: string; name: string; updatedAt: number }[]>;
  load: (id: string) => Promise<SystemProject | null>;
  save: (p: SystemProject) => Promise<unknown>;
}

const liveFns: SystemStoreFns = { list: listSystemProjects, load: loadSystemProject, save: saveSystemProject };

/** Pull every System TODO + project note as linkable views. */
export async function pullSystem(fns: SystemStoreFns = liveFns): Promise<CanvasLinkView[]> {
  const metas = await fns.list().catch(() => []);
  const views: CanvasLinkView[] = [];
  for (const m of metas) {
    const project = await fns.load(m.id).catch(() => null);
    if (!project) continue;
    for (const todo of project.todos ?? []) {
      views.push({
        surface: "system",
        recordId: project.id,
        recordName: project.name,
        todoId: todo.id,
        title: todo.title,
        status: canvasToConsole(todo.status),
        updatedAt: todo.updatedAt ?? project.updatedAt,
        excerpt: todo.body?.slice(0, 120),
      });
    }
    if (project.notes && project.notes.trim()) {
      views.push({
        surface: "system",
        recordId: project.id,
        recordName: project.name,
        title: `Design notes — ${project.name}`,
        status: null,
        updatedAt: project.updatedAt,
        excerpt: project.notes.trim().slice(0, 120),
      });
    }
  }
  return views.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Push a Console status move back onto a canvas TODO. */
export async function pushTodoStatus(
  fns: SystemStoreFns,
  recordId: string,
  todoId: string,
  to: CanvasTodoStatus,
  knownUpdatedAt: number,
  now = Date.now(),
): Promise<PushResult> {
  const project = await fns.load(recordId).catch(() => null);
  if (!project) return { ok: false, error: "Canvas project is gone." };
  const todos = [...(project.todos ?? [])];
  const i = todos.findIndex((t) => t.id === todoId);
  if (i < 0) return { ok: false, error: "Canvas TODO is gone." };
  const current = todos[i];
  if ((current.updatedAt ?? 0) > knownUpdatedAt) return { ok: false, stale: true };
  const next: CanvasTodo = { ...current, status: to, updatedAt: now };
  todos[i] = next;
  await fns.save({ ...project, todos, updatedAt: now });
  return { ok: true };
}

/** Push a Console note into a canvas TODO body (appended, never replaced). */
export async function pushTodoNote(
  fns: SystemStoreFns,
  recordId: string,
  todoId: string,
  text: string,
  knownUpdatedAt: number,
  now = Date.now(),
): Promise<PushResult> {
  const clean = text.trim().slice(0, 2000);
  if (!clean) return { ok: false, error: "Empty note." };
  const project = await fns.load(recordId).catch(() => null);
  if (!project) return { ok: false, error: "Canvas project is gone." };
  const todos = [...(project.todos ?? [])];
  const i = todos.findIndex((t) => t.id === todoId);
  if (i < 0) return { ok: false, error: "Canvas TODO is gone." };
  const current = todos[i];
  if ((current.updatedAt ?? 0) > knownUpdatedAt) return { ok: false, stale: true };
  const stamp = new Date(now).toLocaleString();
  const next = appendNoteLine(todoBodyToNote(current), `[Console ${stamp}] ${clean}`);
  todos[i] = { ...current, ...noteToTodoBody(next), updatedAt: now };
  await fns.save({ ...project, todos, updatedAt: now });
  return { ok: true };
}

/** Schema (ERD) notes slice: canvas prose + canvas TODOs + per-entity log entries. */
export interface SchemaNotesDoc {
  todos: CanvasTodo[];
  entities: Record<string, CanvasTodo[]>;
  /** Free canvas prose (the Design Notes text) - surfaces in Console as a read-only note view. */
  canvasText?: { md: string; updatedAt: number };
}

export interface SchemaNotesStoreFns {
  listTabs: (orgKey: string) => Promise<{ tabId: string; name: string }[]>;
  loadNotes: (orgKey: string, tabId: string) => Promise<SchemaNotesDoc | null>;
  saveNotes: (orgKey: string, tabId: string, doc: SchemaNotesDoc) => Promise<unknown>;
}

function schemaEntryLists(doc: SchemaNotesDoc): CanvasTodo[] {
  return [...(doc.todos ?? []), ...Object.values(doc.entities ?? {}).flat()];
}

function schemaView(
  tabId: string,
  tabName: string,
  entry: CanvasTodo,
  labels: Map<string, string>
): CanvasLinkView {
  const api = entry.entityApi && !isCanvasScope(entry.entityApi) ? entry.entityApi : undefined;
  return {
    surface: "schema",
    recordId: tabId,
    recordName: tabName,
    todoId: entry.id,
    title: entry.title.trim() || (api ? (labels.get(api) ?? api) : "Untitled entry"),
    kind: entry.kind ?? "task",
    owner: entry.owner ?? entry.assignee,
    dueDate: entry.dueDate,
    status: canvasToConsole(entry.status),
    updatedAt: entry.updatedAt,
    excerpt: (entry.body ?? "").slice(0, 120),
  };
}

/** Pull every schema canvas TODO + entity log entry as linkable views. */
export async function pullSchema(
  orgKey: string,
  fns: SchemaNotesStoreFns,
  labels: Map<string, string> = new Map()
): Promise<CanvasLinkView[]> {
  if (!orgKey) return [];
  const tabs = await fns.listTabs(orgKey).catch(() => []);
  const views: CanvasLinkView[] = [];
  for (const tab of tabs) {
    const doc = await fns.loadNotes(orgKey, tab.tabId).catch(() => null);
    if (!doc) continue;
    for (const entry of schemaEntryLists(doc)) {
      views.push(schemaView(tab.tabId, tab.name, entry, labels));
    }
    // Canvas prose is not a task and never pushes - but it must be visible
    // and linkable, otherwise notes taken on canvas vanish from Console.
    if (doc.canvasText) {
      views.push({
        surface: "schema",
        recordId: tab.tabId,
        recordName: tab.name,
        title: `${tab.name} · Canvas notes`,
        kind: "note",
        status: null,
        updatedAt: doc.canvasText.updatedAt,
        excerpt: doc.canvasText.md.slice(0, 120),
      });
    }
  }
  return views.sort((a, b) => b.updatedAt - a.updatedAt);
}

function findSchemaEntry(doc: SchemaNotesDoc, entryId: string): { entry: CanvasTodo; save: (next: CanvasTodo) => SchemaNotesDoc } | null {
  const ti = (doc.todos ?? []).findIndex((t) => t.id === entryId);
  if (ti >= 0) {
    return {
      entry: doc.todos[ti],
      save: (next) => ({ ...doc, todos: doc.todos.map((t) => (t.id === entryId ? next : t)) }),
    };
  }
  for (const [api, rows] of Object.entries(doc.entities ?? {})) {
    if (rows.some((r) => r.id === entryId)) {
      return {
        entry: rows.find((r) => r.id === entryId)!,
        save: (next) => ({ ...doc, entities: { ...doc.entities, [api]: rows.map((r) => (r.id === entryId ? next : r)) } }),
      };
    }
  }
  return null;
}

/** Push a Console status move back onto a schema entry (TODO or log row). */
export async function pushSchemaEntryStatus(
  fns: SchemaNotesStoreFns,
  orgKey: string,
  tabId: string,
  entryId: string,
  to: CanvasTodoStatus,
  knownUpdatedAt: number,
  now = Date.now()
): Promise<PushResult> {
  const doc = await fns.loadNotes(orgKey, tabId).catch(() => null);
  if (!doc) return { ok: false, error: "Schema canvas is gone." };
  const found = findSchemaEntry(doc, entryId);
  if (!found) return { ok: false, error: "Schema entry is gone." };
  if ((found.entry.updatedAt ?? 0) > knownUpdatedAt) return { ok: false, stale: true };
  await fns.saveNotes(orgKey, tabId, found.save({ ...found.entry, status: to, updatedAt: now }));
  return { ok: true };
}

/** Push a Console note into a schema entry body (appended, never replaced). */
export async function pushSchemaEntryNote(
  fns: SchemaNotesStoreFns,
  orgKey: string,
  tabId: string,
  entryId: string,
  text: string,
  knownUpdatedAt: number,
  now = Date.now()
): Promise<PushResult> {
  const clean = text.trim().slice(0, 2000);
  if (!clean) return { ok: false, error: "Empty note." };
  const doc = await fns.loadNotes(orgKey, tabId).catch(() => null);
  if (!doc) return { ok: false, error: "Schema canvas is gone." };
  const found = findSchemaEntry(doc, entryId);
  if (!found) return { ok: false, error: "Schema entry is gone." };
  if ((found.entry.updatedAt ?? 0) > knownUpdatedAt) return { ok: false, stale: true };
  const stamp = new Date(now).toLocaleString();
  const next = appendNoteLine(todoBodyToNote(found.entry), `[Console ${stamp}] ${clean}`);
  await fns.saveNotes(orgKey, tabId, found.save({ ...found.entry, ...noteToTodoBody(next), updatedAt: now }));
  return { ok: true };
}

export const liveSystemFns: SystemStoreFns = liveFns;

/**
 * Live schema fns over the workspace autosave: tab list from the org meta
 * slice, notes docs from per-tab notes slices. Legacy single-note entity
 * values migrate on read; the canvas prose note is preserved untouched on
 * every write.
 *
 * Cross-route race note: Schema and Console never mount together, so the
 * only overlap is Schema's trailing debounce (<=800ms) firing after a
 * navigate-away. Pushes carry the entry updatedAt snapshot and refuse as
 * stale when the canvas moved on - same guard as the System surface.
 */
export const liveSchemaFns: SchemaNotesStoreFns = {
  listTabs: async (orgKey: string) => {
    const { loadAutosave } = await import("@/lib/workspace/autosave");
    const meta = await loadAutosave<{ schemaTabs?: { tabId: string; name: string }[] }>(orgKey, "meta").catch(() => null);
    return (meta?.data.schemaTabs ?? []).filter((t) => t.tabId && t.name);
  },
  loadNotes: async (orgKey: string, tabId: string) => {
    const { loadAutosave } = await import("@/lib/workspace/autosave");
    const { migrateEntityLogValue } = await import("@/lib/inbox/types");
    const rec = await loadAutosave<{ todos?: CanvasTodo[]; entities?: Record<string, unknown>; text?: unknown; updatedAt?: unknown }>(orgKey, "notes", tabId).catch(() => null);
    if (!rec) return null;
    const entities: Record<string, CanvasTodo[]> = {};
    for (const [api, value] of Object.entries(rec.data.entities ?? {})) {
      const rows = migrateEntityLogValue(api, value);
      if (rows.length > 0) entities[api] = rows;
    }
    const doc: SchemaNotesDoc = { todos: Array.isArray(rec.data.todos) ? rec.data.todos : [], entities };
    const prose = typeof rec.data.text === "string" ? rec.data.text.trim() : "";
    if (prose) {
      doc.canvasText = {
        md: prose,
        updatedAt: typeof rec.data.updatedAt === "number" ? rec.data.updatedAt : Date.now(),
      };
    }
    return doc;
  },
  saveNotes: async (orgKey: string, tabId: string, doc: SchemaNotesDoc) => {
    const { loadAutosave, writeAutosave } = await import("@/lib/workspace/autosave");
    const rec = await loadAutosave<Record<string, unknown>>(orgKey, "notes", tabId).catch(() => null);
    const base = (rec?.data ?? {}) as Record<string, unknown>;
    await writeAutosave(orgKey, "notes", { ...base, todos: doc.todos, entities: doc.entities }, tabId);
  },
};
