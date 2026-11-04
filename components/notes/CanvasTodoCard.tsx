"use client";

import { useMemo } from "react";
import { noteToTodoBody, todoBodyToNote, type CanvasTodo } from "@/lib/inbox/types";
import { renderMarkdownLite } from "@/components/erd/notesMd";
import { NoteEditor } from "./NoteEditor";

export function isTodoOverdue(t: { dueDate?: string; status: string }): boolean {
  if (!t.dueDate || t.status === "done") return false;
  const today = new Date();
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return t.dueDate < ymd;
}

// Details body: Rich/Markdown/Preview over the dual-format triple. Memoized
// so vintage Markdown only migrates when its sides actually change.
function TodoDetails({ todo, onPatch }: { todo: CanvasTodo; onPatch: (patch: Partial<CanvasTodo>) => void }) {
  const draft = useMemo(
    () => todoBodyToNote(todo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todo.body, todo.bodyFormat, todo.bodyHtml],
  );
  return (
    <NoteEditor
      draft={draft}
      onDraft={(b) => onPatch(noteToTodoBody(b))}
      label="Details"
      placeholder="Details, acceptance, links…"
      textareaRows={2}
      renderPreview={(md) => renderMarkdownLite(md)}
    />
  );
}

// One TODO: checkbox lifecycle, expandable editor (title, details,
// assignee, due date, status), individual delete. Shared by ERD canvas
// notes and System Design project notes - same behavior, both places.
export function CanvasTodoCard({
  todo,
  expanded,
  onToggleExpand,
  onPatch,
  onDelete,
  onExpand,
}: {
  todo: CanvasTodo;
  expanded: boolean;
  onToggleExpand: () => void;
  onPatch: (patch: Partial<CanvasTodo>) => void;
  onDelete: () => void;
  /** Open this TODO in the fullscreen editor (proper capture surface). */
  onExpand?: () => void;
}) {
  const done = todo.status === "done";
  const overdue = isTodoOverdue(todo);
  return (
    <li className={`rounded-xl border bg-[var(--color-canvas)] transition-colors ${done ? "border-[var(--color-line-soft)] opacity-70" : "border-[var(--color-line)]"}`}>
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={() => onPatch({ status: done ? "open" : "done" })}
          role="checkbox"
          aria-checked={done}
          aria-label={done ? `Reopen ${todo.title || "TODO"}` : `Complete ${todo.title || "TODO"}`}
          title={done ? "Reopen" : "Mark done"}
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer ${done ? "bg-green-600 border-green-600 text-white" : "border-ivory-400 bg-white hover:border-green-600"}`}
        >
          {done && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" aria-hidden="true">
              <path d="m4 12.5 5 5L20 6.5" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={onToggleExpand}
          className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-ivory-950 cursor-pointer"
        >
          <span className={done ? "line-through text-ivory-500" : ""}>{todo.title.trim() || "Untitled TODO"}</span>
        </button>
        {todo.status === "in-progress" && (
          <span className="shrink-0 rounded-full bg-amber-100 border border-amber-300 px-1.5 py-px text-[9px] font-bold text-amber-800">
            Active
          </span>
        )}
        {todo.status === "blocked" && (
          <span className="shrink-0 rounded-full bg-red-100 border border-red-300 px-1.5 py-px text-[9px] font-bold text-red-800">
            Blocked
          </span>
        )}
        {todo.status === "awaiting-feedback" && (
          <span className="shrink-0 rounded-full bg-violet-100 border border-violet-300 px-1.5 py-px text-[9px] font-bold text-violet-800">
            Waiting
          </span>
        )}
        {todo.dueDate && (
          <span className={`shrink-0 font-mono text-[10px] ${overdue ? "font-bold text-red-600" : "text-ivory-500"}`} title={overdue ? "Overdue" : `Due ${todo.dueDate}`}>
            {todo.dueDate.slice(5)}
          </span>
        )}
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete ${todo.title || "TODO"}`}
          title="Delete TODO"
          className="shrink-0 rounded p-1 text-ivory-400 hover:text-red-700 hover:bg-red-500/10 transition-colors cursor-pointer"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13h10l1-13" />
          </svg>
        </button>
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            aria-label={`Edit ${todo.title || "TODO"} fullscreen`}
            title="Edit fullscreen - state, owner, due and description with room"
            className="shrink-0 rounded p-1 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse TODO editor" : "Expand TODO editor"}
          className="shrink-0 rounded p-1 text-ivory-500 hover:text-ivory-950 transition-colors cursor-pointer"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className={`transition-transform ${expanded ? "rotate-180" : ""}`}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
      {expanded && (
        <div className="space-y-1.5 border-t border-[var(--color-line-soft)] p-2">
          <input
            value={todo.title}
            onChange={(e) => onPatch({ title: e.target.value })}
            placeholder="TODO title…"
            aria-label="TODO title"
            spellCheck={false}
            className="w-full rounded-lg border border-[var(--color-line)] bg-white px-2 py-1 text-xs font-semibold text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
          />
          <TodoDetails todo={todo} onPatch={onPatch} />
          <div className="grid grid-cols-3 gap-1.5">
            <label className="block text-[9px] font-semibold uppercase tracking-wider text-ivory-600">
              Who
              <input
                value={todo.assignee ?? ""}
                onChange={(e) => onPatch({ assignee: e.target.value.trim() || undefined })}
                placeholder="—"
                spellCheck={false}
                className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-white px-1.5 py-1 text-[11px] normal-case tracking-normal text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
              />
            </label>
            <label className="block text-[9px] font-semibold uppercase tracking-wider text-ivory-600">
              Due
              <input
                type="date"
                value={todo.dueDate ?? ""}
                onChange={(e) => onPatch({ dueDate: e.target.value || undefined })}
                className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-white px-1.5 py-1 text-[11px] normal-case tracking-normal text-ivory-950 cursor-pointer"
              />
            </label>
            <label className="block text-[9px] font-semibold uppercase tracking-wider text-ivory-600">
              Status
              <select
                value={todo.status}
                onChange={(e) => onPatch({ status: e.target.value as CanvasTodo["status"] })}
                className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-white px-1.5 py-1 text-[11px] font-medium normal-case tracking-normal text-ivory-950 cursor-pointer"
              >
                <option value="open">Open</option>
                <option value="in-progress">Active</option>
                <option value="blocked">Blocked</option>
                <option value="awaiting-feedback">Awaiting feedback</option>
                <option value="done">Done</option>
              </select>
            </label>
          </div>
        </div>
      )}
    </li>
  );
}
