import { STORES, withStore } from "@/lib/db";
import { consoleAttachmentSchema } from "./attachments";
import type { ConsoleAttachment, ConsoleTask } from "./model";
import { consoleTaskSchema } from "./model";

/**
 * Console persistence: tasks live in their own `console-tasks` store
 * (DB v19). Canvas records are never copied here - tasks only carry links.
 * Degrades to safe empties off-browser.
 */

function clean(task: ConsoleTask): ConsoleTask {
  return consoleTaskSchema.parse(task);
}

export async function listConsoleTasks(): Promise<ConsoleTask[]> {
  try {
    const all = await withStore<ConsoleTask[]>(STORES.consoleTasks, "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveConsoleTask(task: ConsoleTask): Promise<boolean> {
  try {
    await withStore(STORES.consoleTasks, "readwrite", (s) => s.put(clean({ ...task, updatedAt: Date.now() })));
    return true;
  } catch {
    return false;
  }
}

export async function deleteConsoleTask(id: string): Promise<boolean> {
  try {
    await withStore(STORES.consoleTasks, "readwrite", (s) => s.delete(id));
    return true;
  } catch {
    return false;
  }
}

export function exportConsoleTasks(tasks: ConsoleTask[], attachments: ConsoleAttachment[] = []): string {
  return JSON.stringify(
    { version: 2, type: "gravenx-console-package", exportedAt: new Date().toISOString(), tasks, attachments },
    null,
    2,
  );
}

/**
 * Import a package: re-ids every task so imports never overwrite, and
 * remaps attachment taskIds onto the new ids so screenshots travel along.
 * v1 packages (tasks only) still import - attachments default to none.
 */
export function importConsoleTasks(
  json: string,
  now = Date.now(),
): { tasks: ConsoleTask[]; attachments: ConsoleAttachment[]; error?: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { tasks: [], attachments: [], error: "Not valid JSON." };
  }
  const list = (raw as { tasks?: unknown }).tasks;
  if (!Array.isArray(list)) return { tasks: [], attachments: [], error: "No tasks array in this package." };
  const tasks: ConsoleTask[] = [];
  const idMap = new Map<string, string>();
  for (const item of list) {
    const parsed = consoleTaskSchema.safeParse(item);
    if (!parsed.success) continue;
    const t = parsed.data;
    const nextId = `task_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
    idMap.set(t.id, nextId);
    tasks.push({
      ...t,
      id: nextId,
      history: [...t.history, { at: now, what: "Imported into Console." }],
    });
    now++;
  }
  if (tasks.length === 0) return { tasks: [], attachments: [], error: "No valid tasks in this package." };
  const attachments: ConsoleAttachment[] = [];
  const rawAtts = (raw as { attachments?: unknown }).attachments;
  if (Array.isArray(rawAtts)) {
    for (const item of rawAtts) {
      const parsed = consoleAttachmentSchema.safeParse(item);
      if (!parsed.success) continue;
      const targetId = idMap.get(parsed.data.taskId);
      if (!targetId) continue;
      attachments.push({
        ...parsed.data,
        id: `att_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
        taskId: targetId,
      });
      now++;
    }
  }
  return { tasks, attachments };
}
