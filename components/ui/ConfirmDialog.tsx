"use client";

import { useState } from "react";
import Button from "./Button";

/**
 * Shared application confirm + prompt dialogs - the single replacement
 * for window.confirm / window.prompt across every tab. Overlay, explicit
 * choice, Esc to cancel; the destructive tone renders the confirm action
 * in red (production deploys, wipe-everything paths).
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  tone = "default",
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "default" | "danger";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-bold text-[#27241F]">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-[#777168]">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={busy}
            title={confirmLabel}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Modal replacement for window.prompt: labelled input with validation. */
export function PromptDialog({
  title,
  message,
  inputLabel,
  placeholder = "",
  defaultValue = "",
  confirmLabel = "Save",
  requireValue = true,
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  inputLabel: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  requireValue?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const valid = !requireValue || value.trim().length > 0;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[15px] font-bold text-[#27241F]">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-[#777168]">{message}</p>
        <label className="mt-3 block">
          <span className="text-xs font-semibold text-[#3A352D]">{inputLabel}</span>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid && !busy) onConfirm(value.trim());
            }}
            placeholder={placeholder}
            autoFocus
            maxLength={500}
            spellCheck={false}
            aria-label={inputLabel}
            className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 text-xs text-ivory-950 focus:border-bronze-500 focus:outline-none"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onConfirm(value.trim())} disabled={busy || !valid} title={confirmLabel}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
