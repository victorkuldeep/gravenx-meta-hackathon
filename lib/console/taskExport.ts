/**
 * Console task export - the status-report sheet: the visible queue with
 * keys, lifecycle, links, notes and screenshot counts. Descriptions stay
 * Markdown (plain text); screenshots stay in the browser by design.
 */

import type ExcelJS from "exceljs";
import { buildExcelWorkbook, downloadExcelWorkbook, type ExcelSheetDef } from "@/lib/excel/workbook";
import { CONSOLE_STATUSES, CONSOLE_STATUS_LABELS, consoleTaskKey, type ConsoleTask } from "./model";

export function buildTaskSheets(tasks: ConsoleTask[], attachCounts: Record<string, number> = {}): ExcelSheetDef[] {
  return [
    {
      name: "Summary",
      rows: [
        ["Console Tasks", ""],
        ["Exported", new Date().toISOString()],
        ["Tasks", tasks.length],
        ...CONSOLE_STATUSES.map((s) => [
          CONSOLE_STATUS_LABELS[s],
          tasks.filter((t) => t.status === s).length,
        ]),
      ],
      widths: [22, 90],
    },
    {
      name: "Tasks",
      header: [
        "Key", "Title", "Kind", "Owner", "Status", "Priority", "Due", "Description",
        "Links", "Notes", "Screenshots", "Created", "Updated",
      ],
      rows: tasks.map((t) => [
        consoleTaskKey(t),
        t.title,
        t.kind ?? "task",
        t.owner ?? "",
        CONSOLE_STATUS_LABELS[t.status],
        t.priority,
        t.dueDate ?? "",
        t.body ?? "",
        t.links.map((l) => `${l.surface}: ${l.label}`).join("; "),
        t.notes.map((n) => `${new Date(n.at).toLocaleDateString()}: ${n.text}`).join("\n"),
        attachCounts[t.id] ? `${attachCounts[t.id]} file${attachCounts[t.id] === 1 ? "" : "s"}` : "",
        new Date(t.createdAt).toISOString(),
        new Date(t.updatedAt).toISOString(),
      ]),
      widths: [10, 44, 12, 16, 16, 12, 14, 80, 40, 60, 12, 14, 14],
    },
  ];
}

export async function buildTaskWorkbook(tasks: ConsoleTask[], attachCounts: Record<string, number> = {}): Promise<ExcelJS.Workbook> {
  return buildExcelWorkbook(buildTaskSheets(tasks, attachCounts));
}

export async function downloadTaskList(
  tasks: ConsoleTask[],
  attachCounts: Record<string, number>,
  filename: string,
): Promise<void> {
  await downloadExcelWorkbook(await buildTaskWorkbook(tasks, attachCounts), filename);
}
