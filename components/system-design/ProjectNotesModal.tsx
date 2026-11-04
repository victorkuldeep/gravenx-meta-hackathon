"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import { renderMarkdownLite, toggleTaskLine } from "../erd/notesMd";
import { CanvasTodoCard } from "../notes/CanvasTodoCard";
import { NoteEditor } from "../notes/NoteEditor";
import type { CanvasTodo } from "@/lib/inbox/types";
import { commitNoteBody, emptyNoteBody, type NoteBody } from "@/lib/notes/notebody";

/**
 * Project notes & TODOs (System Design): Rich/Markdown/Preview, full TODO
 * engine, Markdown download. Writes route through parent mutate() so every
 * keystroke is undoable and autosaved with the project.
 */
export function ProjectNotesModal({
  open,
  onClose,
  projectName,
  notes,
  todos,
  onNotes,
  onAddTodo,
  onPatchTodo,
  onDeleteTodo,
}: {
  open: boolean;
  onClose: () => void;
  projectName: string;
  notes: NoteBody;
  todos: CanvasTodo[];
  onNotes: (b: NoteBody) => void;
  onAddTodo: () => string;
  onPatchTodo: (id: string, patch: Partial<CanvasTodo>) => void;
  onDeleteTodo: (id: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const md = useMemo(() => notes.md, [notes]);

  if (!open) return null;
  const openCount = todos.filter((t) => t.status !== "done").length;

  const download = () => {
    const d = new Date();
    const pad = (v: number) => String(v).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const slug = projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "architecture";
    const todoLines = todos.map((t) => `- [${t.status === "done" ? "x" : " "}] ${t.title.trim() || "Untitled TODO"}`).join("\n");
    const body = `# ${projectName} - design notes\n\n${notes.md}${todos.length > 0 ? `\n\n## TODOs\n\n${todoLines}\n` : ""}`;
    const blob = new Blob([body], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `design-notes-${slug}-${stamp}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-overlay modal-notes" role="dialog" aria-modal="true" aria-labelledby="notes-title" onClick={onClose}>
      <div
        className="modal-card flex h-full flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-line-soft)] px-6 pt-5 pb-4 shrink-0">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
              Project notes · {projectName}
            </p>
            <h2 id="notes-title" className="mt-1 text-lg font-bold text-ivory-950">
              Design Notes{openCount > 0 ? ` · ${openCount} open TODO${openCount === 1 ? "" : "s"}` : ""}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notes"
            className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ivory-700">
                TODOs ({todos.length})
              </p>
              <button
                type="button"
                onClick={() => {
                  const id = onAddTodo();
                  setExpandedId(id);
                }}
                className="rounded-lg bg-ivory-950 px-2.5 py-1 text-[11px] font-semibold text-ivory-100 hover:bg-bronze-600 transition-colors cursor-pointer"
              >
                + TODO
              </button>
            </div>
            {todos.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--color-line)] px-3 py-2.5 text-[11px] text-ivory-500">
                No TODOs yet - track design work with assignees and due dates.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {todos.map((t) => (
                  <CanvasTodoCard
                    key={t.id}
                    todo={t}
                    expanded={expandedId === t.id}
                    onToggleExpand={() => setExpandedId((cur) => (cur === t.id ? null : t.id))}
                    onPatch={(patch) => onPatchTodo(t.id, patch)}
                    onDelete={() => {
                      if (expandedId === t.id) setExpandedId(null);
                      onDeleteTodo(t.id);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>

          <NoteEditor
            draft={notes}
            onDraft={onNotes}
            label="Design notes"
            placeholder={"# Design log\n- [ ] Confirm the ServiceNow mapping\n- 14:32 — middleware retry policy…"}
            textareaRows={10}
            renderPreview={(previewMd) =>
              renderMarkdownLite(previewMd, (idx) => {
                const next = toggleTaskLine(previewMd, idx);
                if (next !== previewMd) onNotes(commitNoteBody(notes, "md", next));
              })
            }
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-ivory-500">
              {md.trim().split(/\s+/).filter(Boolean).length} words · {notes.format === "rich" ? "rich text" : "markdown"} · saved with the project
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {md.trim() && (
                <button
                  type="button"
                  onClick={() => onNotes(emptyNoteBody())}
                  className="text-[10px] text-ivory-500 hover:text-red-700 underline cursor-pointer"
                >
                  Delete note
                </button>
              )}
              {md.trim() && (
                <button
                  type="button"
                  onClick={download}
                  title="Download notes + TODOs as a Markdown file"
                  aria-label="Download notes as Markdown"
                  className="rounded p-1 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-200 transition-colors cursor-pointer"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M12 4v11m0 0 4-4m-4 4-4-4" />
                    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-[var(--color-line-soft)] shrink-0 flex justify-end">
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
