"use client";

import { useEffect, useState } from "react";
import Button from "../ui/Button";

/**
 * Rename a System Design project. Styled modal (same shell as the
 * credentials/notes dialogs) - no native prompt() anywhere.
 */
export function RenameProjectModal({
  open,
  currentName,
  onClose,
  onRename,
}: {
  open: boolean;
  currentName: string;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState(currentName);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(currentName);
      setError(null);
    }
  }, [open, currentName]);

  if (!open) return null;

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setError("Give the project a name - blank names are not saved.");
      return;
    }
    setError(null);
    onRename(trimmed);
    onClose();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="rename-title" onClick={onClose}>
      <div
        className="modal-card max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)] shrink-0">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
              Project
            </p>
            <h2 id="rename-title" className="mt-1 text-lg font-bold text-ivory-950">
              Rename project
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ivory-600">
              Shown in the project bar and the saved-project library. Autosaves like any other change.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close rename"
            className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4">
          <label htmlFor="rename-input" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[1.5px] text-ivory-500">
            Project name
          </label>
          <input
            id="rename-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") onClose();
            }}
            autoFocus
            maxLength={80}
            spellCheck={false}
            placeholder="e.g. Order to fulfillment flow"
            aria-label="Project name"
            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-2 text-[13px] font-semibold text-ivory-950 placeholder-ivory-400 placeholder:font-normal focus:border-bronze-500 focus:outline-none"
          />
          {error && (
            <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-2.5 py-2 text-xs text-red-700" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-[var(--color-line-soft)] shrink-0 flex items-center justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={draft.trim() === "" || draft.trim() === currentName.trim()}>
            Save name
          </Button>
        </div>
      </div>
    </div>
  );
}
