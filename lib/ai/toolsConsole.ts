import { z } from "zod";
import type { AgentTool } from "./tools";
import {
  addNote,
  CONSOLE_PRIORITIES,
  CONSOLE_STATUSES,
  moveTask,
  newConsoleTask,
  type ConsoleStatus,
  type ConsoleTask,
} from "@/lib/console/model";
import { listConsoleTasks, saveConsoleTask } from "@/lib/console/store";
import { consoleToCanvas, liveSystemFns, pushTodoNote, pushTodoStatus } from "@/lib/console/sync";

/**
 * Console tool pack - the architect's task manager behind tools.
 *
 * Reads run free; log/note/move pause for human Apply. Linked canvas TODOs
 * sync both ways on apply (status moves + notes push through the sync
 * engine; stale canvas state refuses instead of clobbering).
 */

export interface ConsoleBackend {
  list: () => Promise<ConsoleTask[]>;
  save: (t: ConsoleTask) => Promise<unknown>;
}

let backend: ConsoleBackend = { list: listConsoleTasks, save: saveConsoleTask };

/** Tests inject an in-memory backend; the app uses IndexedDB. */
export function setConsoleBackend(b: ConsoleBackend | null): void {
  backend = b ?? { list: listConsoleTasks, save: saveConsoleTask };
}

function summarize(t: ConsoleTask) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    ...(t.dueDate ? { dueDate: t.dueDate } : {}),
    ...(t.pmo ? { pmo: `${t.pmo.system}:${t.pmo.key}` } : {}),
    links: t.links.map((l) => l.label),
    notes: t.notes.length,
    updatedAt: t.updatedAt,
  };
}

async function findTask(ref: string): Promise<{ task: ConsoleTask } | { candidates: string[] } | null> {
  const tasks = await backend.list();
  const exact = tasks.find((t) => t.id === ref);
  if (exact) return { task: exact };
  const q = ref.trim().toLowerCase();
  const hits = tasks.filter((t) => t.title.toLowerCase().includes(q));
  if (hits.length === 1) return { task: hits[0] };
  if (hits.length > 1) return { candidates: hits.slice(0, 8).map((t) => t.title) };
  return null;
}

/**
 * Push with the Console task's own updatedAt as baseline: refuse when the
 * canvas moved on after the Console last touched the task, instead of
 * clobbering. Our own pushes stamp both sides, so agreement is the norm.
 */
async function pushStatus(task: ConsoleTask, baseline: number, to: ConsoleStatus): Promise<boolean> {
  const canvas = consoleToCanvas(to);
  let stale = false;
  for (const link of task.links) {
    if (link.surface !== "system" || !link.todoId) continue;
    const r = await pushTodoStatus(liveSystemFns, link.recordId, link.todoId, canvas, baseline);
    if (!r.ok && r.stale) stale = true;
  }
  return stale;
}

async function pushNote(task: ConsoleTask, baseline: number, text: string): Promise<void> {
  for (const link of task.links) {
    if (link.surface !== "system" || !link.todoId) continue;
    await pushTodoNote(liveSystemFns, link.recordId, link.todoId, text, baseline);
  }
}

const describeConsole: AgentTool = {
  name: "console_describe",
  description: "List Console tasks: title, status, priority, due dates, links, note counts.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "Describe console",
  schema: z.object({}),
  execute: async () => {
    const tasks = await backend.list();
    return { ok: true, result: { taskCount: tasks.length, tasks: tasks.slice(0, 60).map(summarize) } };
  },
};

const addArgs = z.object({
  title: z.string().min(1).max(160).describe("Task title, e.g. ERD the Order object"),
  body: z.string().max(2000).optional().describe("Detail for the task"),
  priority: z.enum(CONSOLE_PRIORITIES).optional().describe("Defaults to normal"),
});

const addConsoleTask: AgentTool = {
  name: "console_add",
  description: "Log a task in the architect's Console. Only new tasks - never edit or delete.",
  parameters: {
    type: "object",
    properties: { title: { type: "string" }, body: { type: "string" }, priority: { type: "string" } },
    required: ["title"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => `Log task "${((a as { title?: string }).title ?? "").slice(0, 60)}"`,
  schema: addArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof addArgs>;
    const task: ConsoleTask = {
      ...newConsoleTask(args.title),
      ...(args.body ? { body: args.body.slice(0, 2000) } : {}),
      priority: args.priority ?? "normal",
    };
    await backend.save(task);
    return { ok: true, result: `Logged "${task.title}" (${task.id}). Open: /console?task=${task.id}` };
  },
};

const noteArgs = z.object({
  task: z.string().min(1).describe("Task id or title fragment"),
  text: z.string().min(1).max(2000).describe("Note text - also pushes to linked canvas TODOs"),
});

const addConsoleNote: AgentTool = {
  name: "console_note",
  description: "Add a note to a Console task; pushes through to linked canvas TODOs. Only additive - never rewrites.",
  parameters: {
    type: "object",
    properties: { task: { type: "string" }, text: { type: "string" } },
    required: ["task", "text"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => `Note on "${((a as { task?: string }).task ?? "").slice(0, 50)}"`,
  schema: noteArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof noteArgs>;
    const found = await findTask(args.task);
    if (!found) return { ok: false, error: `No task matches "${args.task}". See console_describe.` };
    if ("candidates" in found) return { ok: false, error: `Ambiguous - did you mean: ${found.candidates.join(" | ")}?` };
    const next = addNote(found.task, args.text);
    await pushNote(found.task, found.task.updatedAt, args.text);
    await backend.save(next);
    return { ok: true, result: `Noted on "${next.title}".` };
  },
};

const moveArgs = z.object({
  task: z.string().min(1).describe("Task id or title fragment"),
  to: z.enum(CONSOLE_STATUSES).describe("Target lifecycle state"),
});

const moveConsoleTask: AgentTool = {
  name: "console_move",
  description: "Move a Console task through open → in-progress → blocked / awaiting-feedback → resolved (reopen to open). Syncs linked canvas TODOs both ways.",
  parameters: {
    type: "object",
    properties: { task: { type: "string" }, to: { type: "string" } },
    required: ["task", "to"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => {
    const v = a as { task?: string; to?: string };
    return `Move "${(v.task ?? "").slice(0, 40)}" to ${v.to ?? ""}`;
  },
  schema: moveArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof moveArgs>;
    const found = await findTask(args.task);
    if (!found) return { ok: false, error: `No task matches "${args.task}". See console_describe.` };
    if ("candidates" in found) return { ok: false, error: `Ambiguous - did you mean: ${found.candidates.join(" | ")}?` };
    const next = moveTask(found.task, args.to);
    if (next === found.task) return { ok: false, error: `Cannot move ${found.task.status} → ${args.to}.` };
    const stale = await pushStatus(next, found.task.updatedAt, args.to);
    await backend.save(next);
    return { ok: true, result: `Moved "${next.title}" to ${args.to}.${stale ? " A linked canvas was newer and kept its state." : ""}` };
  },
};

export const CONSOLE_TOOLS: AgentTool[] = [describeConsole, addConsoleTask, addConsoleNote, moveConsoleTask];
