"use client";

import { useState } from "react";
import { AiMarkdown } from "@/components/ai/Markdown";
import { NoteEditor } from "@/components/notes/NoteEditor";
import {
  CONSOLE_PRIORITIES,
  CONSOLE_STATUS_LABELS,
  CONSOLE_STATUSES,
  type ConsolePriority,
  type ConsoleStatus,
} from "@/lib/console/model";
import { todayIso, type InboxItemKind } from "@/lib/inbox/types";
import { emptyNoteBody, noteBodyEmpty, type NoteBody } from "@/lib/notes/notebody";

const DRAFT_KINDS: { id: InboxItemKind; label: string }[] = [
  { id: "task", label: "Task" },
  { id: "note", label: "Note" },
  { id: "question", label: "Question" },
  { id: "decision", label: "Decision" },
];

export interface NewTaskDraft {
  title: string;
  body?: NoteBody;
  kind: InboxItemKind;
  owner?: string;
  status: ConsoleStatus;
  priority: ConsolePriority;
  dueDate?: string;
}

/**
 * Proper task creation: title, description, status, priority and due date
 * up front - no more instant "Untitled task" rows.
 */
export function NewTaskDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (d: NewTaskDraft) => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState<NoteBody>(() => emptyNoteBody());
  const [kind, setKind] = useState<InboxItemKind>("task");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState<ConsoleStatus>("open");
  const [priority, setPriority] = useState<ConsolePriority>("normal");
  const [dueDate, setDueDate] = useState("");

  const clean = title.trim();
  const cleanOwner = owner.trim().slice(0, 120);
  const submit = () => {
    if (!clean) return;
    onCreate({
      title: clean.slice(0, 160),
      ...(noteBodyEmpty(body) ? {} : { body }),
      kind,
      ...(cleanOwner ? { owner: cleanOwner } : {}),
      status,
      priority,
      ...(dueDate ? { dueDate } : {}),
    });
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Log a task" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-5" onClick={onClose}>
      <div className="flex h-[calc(100vh-40px)] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-2 border-b border-[#E8E2D8] px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-[#27241F]">Log a task</h3>
            <p className="font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">Console queue · autosaved to this browser</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded p-1.5 text-[#A39B8E] hover:bg-[#F5F1E8] hover:text-[#27241F]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          <div>
            <label htmlFor="new-task-title" className="mb-1 block text-[12px] font-semibold text-[#3A352D]">Title</label>
            <input
              id="new-task-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 160))}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="e.g. ERD the Order object before the workshop"
              spellCheck={false}
              className="w-full rounded-lg border border-[#E8E2D8] bg-white px-3 py-2 text-[13px] text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none"
            />
          </div>
          <div className="flex min-h-40 flex-1 flex-col">
            <NoteEditor
              draft={body}
              onDraft={setBody}
              label="Description"
              placeholder={"What needs doing, acceptance criteria, links…\n\n- [ ] first step\n- [ ] second step"}
              renderPreview={(md) => <AiMarkdown content={md} />}
            />
          </div>
          <div className="flex flex-wrap gap-3 border-t border-[#E8E2D8] pt-3">
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#3A352D]">
              Kind
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as InboxItemKind)}
                className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] font-normal text-[#27241F] focus:border-[#C9A86A] focus:outline-none"
              >
                {DRAFT_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>{k.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#3A352D]">
              Owner
              <input
                value={owner}
                onChange={(e) => setOwner(e.target.value.slice(0, 120))}
                placeholder="Who owns it"
                spellCheck={false}
                className="w-32 rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] font-normal text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#3A352D]">
              Status
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as ConsoleStatus)}
                className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] font-normal text-[#27241F] focus:border-[#C9A86A] focus:outline-none"
              >
                {CONSOLE_STATUSES.map((s) => (
                  <option key={s} value={s}>{CONSOLE_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#3A352D]">
              Priority
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as ConsolePriority)}
                className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] font-normal capitalize text-[#27241F] focus:border-[#C9A86A] focus:outline-none"
              >
                {CONSOLE_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#3A352D]">
              Due
              <input
                type="date"
                value={dueDate}
                min={todayIso()}
                onChange={(e) => setDueDate(e.target.value)}
                className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] font-normal text-[#27241F] focus:border-[#C9A86A] focus:outline-none"
              />
            </label>
          </div>
        </div>
        <div className="flex justify-center gap-2 border-t border-[#E8E2D8] px-5 py-3">
          <button type="button" onClick={onClose} className="cursor-pointer rounded-lg border border-[#E8E2D8] px-3 py-1.5 text-xs font-semibold text-[#27241F] hover:border-[#C9A86A]">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!clean}
            className="cursor-pointer rounded-lg bg-[#27241F] px-3 py-1.5 text-xs font-semibold text-[#F5F1E8] hover:bg-[#3A352D] disabled:cursor-default disabled:opacity-40"
          >
            Log task
          </button>
        </div>
      </div>
    </div>
  );
}
