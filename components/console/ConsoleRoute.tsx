"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addNote,
  CONSOLE_STATUS_LABELS,
  CONSOLE_STATUSES,
  consoleTaskKey,
  moveTask,
  newConsoleTask,
  noteToConsoleBody,
  type ConsoleLink,
  type ConsoleStatus,
  type ConsoleTask,
} from "@/lib/console/model";
import { exportConsoleTasks, importConsoleTasks, deleteConsoleTask, listConsoleTasks, saveConsoleTask } from "@/lib/console/store";
import { countAttachments, deleteTaskAttachments, listAllAttachments, saveAttachment } from "@/lib/console/attachments";
import { downloadTaskList } from "@/lib/console/taskExport";
import { CONSOLE_SAMPLES } from "@/lib/console/samples";
import { findDeepRecord, syncDeepParam, useDeepParam } from "@/lib/deep/deep";
import { DeepLinkButton } from "../ui/DeepLinkButton";
import {
  consoleToCanvas,
  liveSchemaFns,
  liveSystemFns,
  pullSchema,
  pullSystem,
  pushSchemaEntryNote,
  pushSchemaEntryStatus,
  pushTodoNote,
  pushTodoStatus,
  type CanvasLinkView,
} from "@/lib/console/sync";
import { pullNotes } from "@/lib/notes/standalone";
import { getCachedConnection } from "@/lib/session/cache";
import { TaskDetail, fmtDate } from "./TaskDetail";
import { NewTaskDialog, type NewTaskDraft } from "./NewTaskDialog";
import { CanvasViews } from "./CanvasViews";

const PRIORITY_DOT: Record<string, string> = {
  low: "bg-[#A39B8E]",
  normal: "bg-[#C9A86A]",
  high: "bg-[#C26A2E]",
  critical: "bg-red-700",
};

const STATUS_PILL: Record<ConsoleStatus, string> = {
  open: "border-[#D8D0C0] bg-white text-[#777168]",
  "in-progress": "border-[#E5C98F] bg-[#F5EEDF] text-[#8A6A2F]",
  blocked: "border-[#E5AFAF] bg-[#F9E9E9] text-[#A02C2C]",
  "awaiting-feedback": "border-[#C3BCE0] bg-[#ECEAF6] text-[#4E4494]",
  resolved: "border-[#B5CFA8] bg-[#EBF2E6] text-[#3E6B34]",
};

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const KIND_PILL: Record<string, string> = {
  note: "bg-[#F0EBE0] text-[#777168]",
  task: "bg-[#F5EEDF] text-[#8A6A2F]",
  question: "bg-[#EBF2E6] text-[#3E6B34]",
  decision: "bg-[#ECEAF6] text-[#4E4494]",
};

function KindPill({ kind }: { kind: ConsoleTask["kind"] }) {
  return (
    <span
      title={`Kind: ${kind ?? "task"}`}
      className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${KIND_PILL[kind ?? "task"]}`}
    >
      {(kind ?? "task").slice(0, 4)}
    </span>
  );
}

function DueBadge({ task }: { task: ConsoleTask }) {
  if (!task.dueDate) return null;
  const overdue = task.status !== "resolved" && task.dueDate < todayKey();
  return (
    <span
      title={overdue ? "Overdue" : "Due date"}
      className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold ${overdue ? "bg-[#F9E9E9] text-[#A02C2C]" : "bg-[#F0EBE0] text-[#777168]"}`}
    >
      {overdue ? `overdue ${task.dueDate}` : `due ${task.dueDate}`}
    </span>
  );
}

export function ConsoleRoute() {
  const [tasks, setTasks] = useState<ConsoleTask[]>([]);
  const [xlsBusy, setXlsBusy] = useState(false);
  const [views, setViews] = useState<CanvasLinkView[]>([]);
  const [attachCounts, setAttachCounts] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<"queue" | "board" | "timeline" | "canvas">("queue");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ConsoleStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Last-seen canvas timestamps per linked TODO - the stale-write guard.
  const knownRef = useRef(new Map<string, number>());

  const refresh = useCallback(async () => {
    // Schema views need the connected org (notes slices are per-org); the
    // System surface is global. Offline simply yields no schema views.
    const orgKey = getCachedConnection()?.orgKey ?? "";
    const [t, sys, sch, nts] = await Promise.all([
      listConsoleTasks(),
      pullSystem(liveSystemFns),
      orgKey ? pullSchema(orgKey, liveSchemaFns) : Promise.resolve([] as CanvasLinkView[]),
      pullNotes(),
    ]);
    const v = [...sys, ...sch, ...nts];
    setTasks(t);
    setViews(v);
    for (const item of v) {
      if (item.todoId) knownRef.current.set(`${item.surface}:${item.recordId}:${item.todoId}`, item.updatedAt);
    }
    setAttachCounts(await countAttachments(t.map((x) => x.id)));
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Deep link: ?task= selects the exact task.
  const deepTask = useDeepParam("task");
  const deepDone = useRef(false);
  useEffect(() => {
    if (deepDone.current || !loaded || deepTask === null) return;
    const hit = findDeepRecord(tasks, deepTask);
    if (hit) {
      setSelectedId(hit.id);
      deepDone.current = true;
    }
  }, [loaded, deepTask, tasks]);

  // Keep the URL on the selected task so it survives reloads and pastes.
  useEffect(() => {
    if (!loaded) return;
    syncDeepParam("task", selectedId);
  }, [loaded, selectedId]);

  const persist = useCallback(async (task: ConsoleTask) => {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)).sort((a, b) => b.updatedAt - a.updatedAt));
    await saveConsoleTask(task);
  }, []);

  const create = useCallback(async (draft: NewTaskDraft) => {
    const task: ConsoleTask = {
      ...newConsoleTask(draft.title),
      ...(draft.body ? noteToConsoleBody(draft.body) : {}),
      status: draft.status,
      priority: draft.priority,
      ...(draft.kind && draft.kind !== "task" ? { kind: draft.kind } : {}),
      ...(draft.owner ? { owner: draft.owner } : {}),
      ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
    };
    setTasks((prev) => [task, ...prev]);
    await saveConsoleTask(task);
    setShowCreate(false);
    setSelectedId(task.id);
  }, []);

  /** Start tracking a canvas item as a Console task - kind/owner/due/status adopted. */
  const createFromView = useCallback(
    async (item: CanvasLinkView) => {
      const link: ConsoleLink = {
        surface: item.surface,
        recordId: item.recordId,
        ...(item.todoId ? { todoId: item.todoId } : {}),
        label: item.todoId ? `${item.recordName} · ${item.title}` : item.title,
      };
      const base = newConsoleTask(item.title);
      const task: ConsoleTask = {
        ...base,
        ...(item.kind ? { kind: item.kind } : {}),
        ...(item.owner ? { owner: item.owner } : {}),
        ...(item.dueDate ? { dueDate: item.dueDate } : {}),
        ...(item.status ? { status: item.status } : {}),
        links: [link],
        updatedAt: Date.now(),
        history: [...base.history, { at: Date.now(), what: `Tracked from canvas: ${link.label}.` }],
      };
      if (item.todoId) {
        knownRef.current.set(`${item.surface}:${item.recordId}:${item.todoId}`, item.updatedAt);
      }
      setTasks((prev) => [task, ...prev]);
      await saveConsoleTask(task);
      setSelectedId(task.id);
    },
    [],
  );

  /** Push a Console status move back onto every linked canvas entry. */
  const moveWithSync = useCallback(
    async (task: ConsoleTask, to: ConsoleStatus) => {
      const next = moveTask(task, to);
      if (next === task) return;
      const canvas = consoleToCanvas(to);
      let stale = false;
      let gone: string | null = null;
      for (const link of task.links) {
        if (!link.todoId) continue;
        const key = `${link.surface}:${link.recordId}:${link.todoId}`;
        const known = knownRef.current.get(key) ?? 0;
        if (link.surface === "system") {
          const r = await pushTodoStatus(liveSystemFns, link.recordId, link.todoId, canvas, known);
          if (!r.ok && r.stale) stale = true;
        } else if (link.surface === "schema") {
          const orgKey = getCachedConnection()?.orgKey ?? "";
          if (!orgKey) continue;
          const r = await pushSchemaEntryStatus(liveSchemaFns, orgKey, link.recordId, link.todoId, canvas, known);
          if (!r.ok && r.stale) stale = true;
          else if (!r.ok && r.error) gone = r.error;
        }
      }
      await persist(next);
      if (gone) setNotice(gone);
      if (stale) {
        setNotice("A linked canvas moved on — its side kept the newer state. Pull refreshed below.");
        void refresh();
      }
    },
    [persist, refresh],
  );

  const addNoteWithSync = useCallback(
    async (task: ConsoleTask, text: string) => {
      const next = addNote(task, text);
      if (next === task) return;
      for (const link of task.links) {
        if (!link.todoId) continue;
        const key = `${link.surface}:${link.recordId}:${link.todoId}`;
        const known = knownRef.current.get(key) ?? 0;
        if (link.surface === "system") {
          await pushTodoNote(liveSystemFns, link.recordId, link.todoId, text, known);
        } else if (link.surface === "schema") {
          const orgKey = getCachedConnection()?.orgKey ?? "";
          if (!orgKey) continue;
          await pushSchemaEntryNote(liveSchemaFns, orgKey, link.recordId, link.todoId, text, known);
        }
      }
      await persist(next);
    },
    [persist],
  );

  const linkView = useCallback(
    async (task: ConsoleTask, item: CanvasLinkView) => {
      if (task.links.some((l) => l.surface === item.surface && l.recordId === item.recordId && (l.todoId ?? "") === (item.todoId ?? ""))) return;
      const link: ConsoleLink = {
        surface: item.surface,
        recordId: item.recordId,
        ...(item.todoId ? { todoId: item.todoId } : {}),
        label: item.todoId ? `${item.recordName} · ${item.title}` : item.title,
      };
      // Adopt kind/owner/due from the canvas entry when the task has none.
      const adopted: Partial<ConsoleTask> =
        item.todoId
          ? {
              ...(task.kind || !item.kind ? {} : { kind: item.kind }),
              ...(task.owner || !item.owner ? {} : { owner: item.owner }),
              ...(task.dueDate || !item.dueDate ? {} : { dueDate: item.dueDate }),
            }
          : {};
      const next: ConsoleTask = {
        ...task,
        ...adopted,
        links: [...task.links, link],
        updatedAt: Date.now(),
        history: [...task.history, { at: Date.now(), what: `Linked canvas item: ${link.label}.` }],
      };
      if (item.todoId) {
        knownRef.current.set(`${item.surface}:${item.recordId}:${item.todoId}`, item.updatedAt);
        // Adopt the canvas status so both sides start agreed.
        if (item.status && item.status !== next.status) {
          await persist({ ...next, status: item.status });
          return;
        }
      }
      await persist(next);
    },
    [persist],
  );

  const deleteTask = useCallback(
    async (task: ConsoleTask) => {
      await deleteConsoleTask(task.id);
      await deleteTaskAttachments(task.id);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      setAttachCounts((prev) => {
        const next = { ...prev };
        delete next[task.id];
        return next;
      });
      setSelectedId(null);
    },
    [],
  );

  const doExport = useCallback(async () => {
    const atts = (await listAllAttachments()).filter((a) => tasks.some((t) => t.id === a.taskId));
    const blob = new Blob([exportConsoleTasks(tasks, atts)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gravenx-console.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setNotice(`Exported ${tasks.length} task${tasks.length === 1 ? "" : "s"} with ${atts.length} screenshot${atts.length === 1 ? "" : "s"}.`);
  }, [tasks]);

  const doImport = useCallback(
    async (text: string) => {
      const { tasks: incoming, attachments, error } = importConsoleTasks(text);
      if (error || incoming.length === 0) {
        setNotice(error ?? "Nothing to import.");
        return;
      }
      for (const t of incoming) await saveConsoleTask(t);
      for (const a of attachments) await saveAttachment(a);
      setTasks((prev) => [...incoming, ...prev].sort((a, b) => b.updatedAt - a.updatedAt));
      setAttachCounts(await countAttachments(incoming.map((x) => x.id)));
      setNotice(
        `Imported ${incoming.length} task${incoming.length === 1 ? "" : "s"}${attachments.length > 0 ? ` with ${attachments.length} screenshot${attachments.length === 1 ? "" : "s"}` : ""} (re-id, nothing overwritten).`,
      );
    },
    [],
  );

  const loadSamples = useCallback(async () => {
    const existing = new Set(tasks.map((t) => t.title));
    const fresh = CONSOLE_SAMPLES.filter((s) => !existing.has(s.title));
    if (fresh.length === 0) {
      setNotice("Samples already in the queue.");
      return;
    }
    const made: ConsoleTask[] = [];
    for (const s of fresh) {
      const task: ConsoleTask = {
        ...newConsoleTask(s.title),
        kind: s.kind,
        status: s.status,
        priority: s.priority,
        ...(s.owner ? { owner: s.owner } : {}),
        ...(s.body ? { body: s.body } : {}),
      };
      await saveConsoleTask(task);
      made.push(task);
    }
    setTasks((prev) => [...made, ...prev].sort((a, b) => b.updatedAt - a.updatedAt));
    setSelectedId(made[0].id);
    setNotice(`Loaded ${made.length} sample task${made.length === 1 ? "" : "s"} - edit or delete freely.`);
  }, [tasks]);

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter(
      (t) =>
        (statusFilter === "all" || t.status === statusFilter) &&
        (q === "" ||
          t.title.toLowerCase().includes(q) ||
          (t.body ?? "").toLowerCase().includes(q) ||
          (t.owner ?? "").toLowerCase().includes(q) ||
          (t.kind ?? "task").includes(q) ||
          consoleTaskKey(t).toLowerCase() === q),
    );
  }, [tasks, query, statusFilter]);

  const timeline = tasks
    .flatMap((t) => [
      ...t.history.map((h) => ({ at: h.at, task: t.title, what: h.what })),
      ...t.notes.map((n) => ({ at: n.at, task: t.title, what: `Note: ${n.text.slice(0, 140)}` })),
    ])
    .sort((a, b) => b.at - a.at)
    .slice(0, 120);

  const openCount = tasks.filter((t) => t.status === "open").length;
  const activeCount = tasks.filter((t) => t.status === "in-progress" || t.status === "blocked" || t.status === "awaiting-feedback").length;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-[#27241F]">Console</h2>
            <p className="font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
              {openCount} open · {activeCount} active · {views.length} canvas items linked live
            </p>
          </div>
          <span className="ml-auto flex flex-wrap items-center gap-1.5">
            <ViewToggle view={view} setView={setView} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title="Import a console package JSON from a fellow dev"
              className="cursor-pointer rounded-lg border border-[#E8E2D8] px-2.5 py-1.5 text-xs font-semibold text-[#27241F] transition-colors hover:border-[#C9A86A]"
            >
              Import
            </button>
            <button
              type="button"
              onClick={() => void doExport()}
              title="Export all tasks with screenshots as portable JSON"
              className="cursor-pointer rounded-lg border border-[#E8E2D8] px-2.5 py-1.5 text-xs font-semibold text-[#27241F] transition-colors hover:border-[#C9A86A]"
            >
              Export
            </button>
            <button
              type="button"
              disabled={xlsBusy || filtered.length === 0}
              onClick={() => {
                setXlsBusy(true);
                void downloadTaskList(filtered, attachCounts, "console-tasks.xlsx").finally(() => setXlsBusy(false));
              }}
              title="Download the visible queue as .xlsx (respects search + status filter)"
              className="cursor-pointer rounded-lg border border-[#E8E2D8] px-2.5 py-1.5 text-xs font-semibold text-[#27241F] transition-colors hover:border-[#C9A86A] disabled:opacity-50"
            >
              {xlsBusy ? "Building…" : "Excel (.xlsx)"}
            </button>
            {selected && <DeepLinkButton path="/console" param="task" value={selected.id} />}
            <button
              type="button"
              onClick={() => void loadSamples()}
              title="Load three training tasks - review, question, decision"
              className="cursor-pointer rounded-lg border border-[#E8E2D8] px-2.5 py-1.5 text-xs font-semibold text-[#27241F] transition-colors hover:border-[#C9A86A]"
            >
              Samples
            </button>
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="cursor-pointer rounded-lg bg-[#27241F] px-2.5 py-1.5 text-xs font-semibold text-[#F5F1E8] transition-colors hover:bg-[#3A352D]"
            >
              New task
            </button>
          </span>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, description or key (CX-…)"
            aria-label="Search tasks"
            spellCheck={false}
            className="min-w-40 flex-1 rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[12px] text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none sm:max-w-xs"
          />
          <span className="inline-flex flex-wrap gap-1" role="group" aria-label="Filter by status">
            {(["all", ...CONSOLE_STATUSES] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                aria-pressed={statusFilter === s}
                className={`cursor-pointer rounded-full border px-2 py-1 text-[11px] font-semibold ${
                  statusFilter === s
                    ? "border-[#27241F] bg-[#27241F] text-[#F5F1E8]"
                    : "border-[#E8E2D8] bg-white text-[#777168] hover:border-[#C9A86A]"
                }`}
              >
                {s === "all" ? "All" : CONSOLE_STATUS_LABELS[s]}
              </button>
            ))}
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Import console package"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            void f.text().then((text) => void doImport(text));
          }}
        />
      </div>

      {notice && (
        <p role="status" className="rounded-xl border border-[#E5C98F] bg-[#F5EEDF] px-4 py-2 text-[12px] text-[#5C4A23]">
          {notice} <button type="button" onClick={() => setNotice(null)} className="ml-2 cursor-pointer underline">Dismiss</button>
        </p>
      )}

      {view === "queue" && (
        <ol className="overflow-hidden rounded-xl border border-[#E8E2D8] bg-white">
          <li className="hidden grid-cols-[64px_1fr_150px_130px_120px] gap-2 border-b border-[#E8E2D8] bg-[#FBFAF7] px-4 py-1.5 font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E] md:grid">
            <span>Key</span><span>Summary</span><span>Status</span><span>Due</span><span className="text-right">Activity</span>
          </li>
          {filtered.map((t) => (
            <li key={t.id} className="border-b border-[#E8E2D8] last:border-0">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setSelectedId(t.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSelectedId(t.id);
                }}
                title="Open task panel"
                className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-2 px-4 py-2.5 transition-colors hover:bg-[#FBFAF7] md:grid-cols-[64px_1fr_150px_130px_120px]"
              >
                <span className="font-mono text-[11px] font-semibold text-[#777168]">{consoleTaskKey(t)}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[t.priority]}`} />
                    <KindPill kind={t.kind} />
                    <span className="truncate text-[13px] font-semibold text-[#27241F]">{t.title}</span>
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-[#A39B8E]">
                    {t.owner ? `${t.owner} · ` : ""}
                    {t.links.length > 0 ? `${t.links.length} link${t.links.length === 1 ? "" : "s"} · ` : ""}
                    {t.notes.length} note{t.notes.length === 1 ? "" : "s"} · {attachCounts[t.id] ?? 0} shot{(attachCounts[t.id] ?? 0) === 1 ? "" : "s"}
                  </span>
                </span>
                <select
                  value={t.status}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => void moveWithSync(t, e.target.value as ConsoleStatus)}
                  aria-label={`Status of ${t.title}`}
                  className={`cursor-pointer justify-self-start rounded-lg border px-1.5 py-1 text-[11px] font-semibold focus:outline-none ${STATUS_PILL[t.status]}`}
                >
                  {[t.status, ...CONSOLE_STATUSES.filter((s) => s !== t.status)].map((s) => (
                    <option key={s} value={s}>{CONSOLE_STATUS_LABELS[s]}</option>
                  ))}
                </select>
                <span className="hidden md:block"><DueBadge task={t} /></span>
                <span className="hidden text-right font-mono text-[10px] text-[#A39B8E] md:block">{fmtDate(t.updatedAt)}</span>
              </div>
            </li>
          ))}
          {loaded && filtered.length === 0 && (
            <li className="px-4 py-6 text-center">
              {tasks.length === 0 ? (
                <>
                  <p className="text-[13px] font-semibold text-[#27241F]">No tasks yet</p>
                  <ol className="mx-auto mt-2 max-w-[420px] space-y-1 text-left text-[11px] leading-relaxed text-[#777168]">
                    <li><span className="font-mono font-bold text-[#A98450]">1 </span>Log anything - task, note, question, decision.</li>
                    <li><span className="font-mono font-bold text-[#A98450]">2 </span>Browse every canvas TODO and note under Canvas.</li>
                    <li><span className="font-mono font-bold text-[#A98450]">3 </span>Push to JIRA / ServiceNow or drop to a coding agent.</li>
                  </ol>
                </>
              ) : (
                <span className="text-[12px] text-[#A39B8E]">Nothing matches this filter.</span>
              )}
            </li>
          )}
        </ol>
      )}

      {view === "board" && (
        <div className="grid gap-2.5 md:grid-cols-3 xl:grid-cols-5">
          {CONSOLE_STATUSES.map((status) => (
            <div key={status} className="rounded-xl border border-[#E8E2D8] bg-[#FBFAF7] p-2">
              <p className="px-1.5 pb-1.5 font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
                {CONSOLE_STATUS_LABELS[status]} · {filtered.filter((t) => t.status === status).length}
              </p>
              <div className="space-y-1.5">
                {filtered
                  .filter((t) => t.status === status)
                  .map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className="block w-full cursor-pointer rounded-xl border border-[#E8E2D8] bg-white px-3 py-2 text-left transition-colors hover:border-[#C9A86A]"
                    >
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_DOT[t.priority]}`} />
                        <KindPill kind={t.kind} />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#27241F]">{t.title}</span>
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-[#A39B8E]">
                        <span>{consoleTaskKey(t)}</span>
                        {t.owner ? <span>· {t.owner}</span> : null}
                        {t.dueDate ? <span>· {t.dueDate}</span> : null}
                        <span className="ml-auto">{attachCounts[t.id] ?? 0}⧉ {t.notes.length}✎</span>
                      </span>
                      {t.body && <span className="mt-1 line-clamp-2 block text-[11px] leading-snug text-[#777168]">{t.body.slice(0, 140)}</span>}
                    </button>
                  ))}
                {loaded && filtered.filter((t) => t.status === status).length === 0 && (
                  <p className="px-1.5 py-3 text-center text-[11px] text-[#A39B8E]">Nothing here.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === "timeline" && (
        <ol className="relative ml-2 space-y-0 rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
          {timeline.map((e, i) => (
            <li key={`${e.at}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
              <span aria-hidden="true" className="absolute bottom-0 left-[4px] top-4 w-px bg-[#E8E2D8]" />
              <span aria-hidden="true" className="mt-1.5 h-[9px] w-[9px] shrink-0 rounded-full border-2 border-[#C9A86A] bg-white" />
              <div className="min-w-0">
                <p className="text-[12px] text-[#3A352D]">
                  <span className="font-semibold text-[#27241F]">{e.task}</span> — {e.what}
                </p>
                <p className="font-mono text-[10px] text-[#A39B8E]">{fmtDate(e.at)}</p>
              </div>
            </li>
          ))}
          {timeline.length === 0 && <p className="py-3 text-center text-[12px] text-[#A39B8E]">Log a task to start the timeline.</p>}
        </ol>
      )}

      {view === "canvas" && (
        <CanvasViews views={views} query={query} onNewTask={(item) => void createFromView(item)} />
      )}

      {showCreate && <NewTaskDialog onClose={() => setShowCreate(false)} onCreate={(d) => void create(d)} />}

      {selected && (
        <TaskDetail
          task={selected}
          views={views}
          onClose={() => setSelectedId(null)}
          onMove={(to) => void moveWithSync(selected, to)}
          onNote={(text) => void addNoteWithSync(selected, text)}
          onLink={(item) => void linkView(selected, item)}
          onUnlink={(idx) => {
            const next = { ...selected, links: selected.links.filter((_, i) => i !== idx), updatedAt: Date.now() };
            void persist(next);
          }}
          onPatch={(patch) => {
            void persist({ ...selected, ...patch, updatedAt: Date.now() });
          }}
          onDelete={() => void deleteTask(selected)}
        />
      )}
    </div>
  );
}

function ViewToggle({ view, setView }: { view: "queue" | "board" | "timeline" | "canvas"; setView: (v: "queue" | "board" | "timeline" | "canvas") => void }) {
  return (
    <span className="inline-flex overflow-hidden rounded-lg border border-[#E8E2D8]" role="group" aria-label="Console view">
      {(["queue", "board", "timeline", "canvas"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => setView(v)}
          aria-pressed={view === v}
          className={`cursor-pointer px-2.5 py-1.5 text-xs font-semibold capitalize transition-colors ${
            view === v ? "bg-[#27241F] text-[#F5F1E8]" : "bg-white text-[#777168] hover:text-[#27241F]"
          }`}
        >
          {v}
        </button>
      ))}
    </span>
  );
}
