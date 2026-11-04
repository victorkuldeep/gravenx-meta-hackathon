"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { RichTextEditor } from "./RichTextEditor";
import { commitNoteBody, noteTabCommit, type NoteBody } from "@/lib/notes/notebody";

type NoteTab = "rich" | "md" | "preview";

const TABS: { id: NoteTab; label: string; title: string }[] = [
  { id: "rich", label: "Rich", title: "WYSIWYG editor - headings, lists, highlights" },
  { id: "md", label: "Markdown", title: "Markdown source - same content, plain text" },
  { id: "preview", label: "Preview", title: "Rendered output" },
];

/**
 * One editor choice everywhere: Rich | Markdown | Preview over a dual-format
 * NoteBody. Controlled - the caller owns the draft and decides when it hits
 * IndexedDB (every keystroke for canvas notes, explicit Save for Console).
 * Switching editors without editing is lossless (see commitNoteBody).
 */
export function NoteEditor({
  draft,
  onDraft,
  label,
  hint,
  placeholder,
  renderPreview,
  emptyPreview,
  textareaRows = 7,
  initialTab,
  fill,
}: {
  draft: NoteBody;
  onDraft: (b: NoteBody) => void;
  label: string;
  hint?: string;
  placeholder?: string;
  renderPreview: (md: string) => ReactNode;
  /** Shown when the draft is empty; receives an edit() that opens the draft's editor. */
  emptyPreview?: ReactNode | ((edit: () => void) => ReactNode);
  textareaRows?: number;
  initialTab?: NoteTab;
  /** Stretch to the parent flex height (fullscreen zen) instead of fixed rows. */
  fill?: boolean;
}) {
  const [tab, setTab] = useState<NoteTab>(initialTab ?? (draft.format === "rich" ? "rich" : "md"));
  // Follow genuine format changes (draft reset, another surface) without
  // stealing the tab on every keystroke.
  const seenFormat = useRef(draft.format);
  useEffect(() => {
    if (draft.format !== seenFormat.current) {
      seenFormat.current = draft.format;
      setTab(draft.format);
    }
  }, [draft.format]);

  const switchTab = (t: NoteTab) => {
    if (t === tab) return;
    setTab(t);
    if (t === "preview") return;
    // Untouched (empty both sides): stay local, commit nothing - an empty
    // commit reads as "cleared" downstream and drops an untitled entry.
    const committed = noteTabCommit(draft, t);
    if (committed) onDraft(committed);
  };
  const edit = () => switchTab(draft.format);

  return (
    <div className={fill ? "flex min-h-0 flex-1 flex-col" : undefined}>
      <div className="flex items-center gap-2">
        <h4 className="font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">
          {label} · {tab === "preview" ? "preview" : tab === "rich" ? "rich text" : "markdown"}
        </h4>
        <span className="ml-auto inline-flex overflow-hidden rounded-lg border border-[#E8E2D8]" role="group" aria-label={`${label} mode`}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => switchTab(t.id)}
              title={t.title}
              aria-pressed={tab === t.id}
              className={`cursor-pointer px-2 py-0.5 text-[11px] font-semibold ${
                tab === t.id ? "bg-[#27241F] text-[#F5F1E8]" : "bg-white text-[#777168] hover:text-[#27241F]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </span>
      </div>

      <div className={fill ? "mt-1.5 flex min-h-0 flex-1 flex-col" : "mt-1.5"}>
        {tab === "rich" && (
          <RichTextEditor
            value={draft.html}
            label={label}
            hint={hint}
            onDone={(html) => onDraft(commitNoteBody(draft, "rich", html))}
            fill={fill}
          />
        )}
        {tab === "md" && (
          <textarea
            value={draft.md}
            onChange={(e) => onDraft(commitNoteBody(draft, "md", e.target.value))}
            rows={textareaRows}
            placeholder={placeholder}
            spellCheck={false}
            aria-label={`${label} markdown`}
            className={`w-full rounded-xl border border-[#E8E2D8] bg-white px-3 py-2 font-mono text-[12px] leading-relaxed text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none ${fill ? "min-h-0 flex-1 resize-none" : "resize-y"}`}
          />
        )}
        {tab === "preview" &&
          (draft.md.trim() ? (
            <div className={`rounded-xl border border-[#E8E2D8] bg-[#FBFAF7] px-3 py-2 ${fill ? "min-h-0 flex-1 overflow-y-auto" : ""}`}>
              {renderPreview(draft.md)}
            </div>
          ) : typeof emptyPreview === "function" ? (
            emptyPreview(edit)
          ) : (
            (emptyPreview ?? (
              <p className="rounded-xl border border-dashed border-[#D8D0C0] px-3 py-3 text-[12px] text-[#A39B8E]">
                Nothing to preview yet.
              </p>
            ))
          ))}
      </div>
    </div>
  );
}
