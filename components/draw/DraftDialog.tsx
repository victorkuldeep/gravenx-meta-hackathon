"use client";

import { useState } from "react";
import type { TopologyDraft } from "@/lib/draw/toSystemDraft";

export interface DraftConfirmation {
  included: string[];
  names: Record<string, string>;
  projectName: string;
}

interface DraftDialogProps {
  draft: TopologyDraft;
  onCancel: () => void;
  onConfirm: (selection: DraftConfirmation) => void;
}

/**
 * Confirm-what-the-board-meant dialog. The parser drafts; the architect
 * decides: rename boxes, drop junk, then send. Nothing is guessed silently.
 */
export function DraftDialog({ draft, onCancel, onConfirm }: DraftDialogProps) {
  const [included, setIncluded] = useState<Set<string>>(
    () => new Set(draft.systems.map((s) => s.key)),
  );
  const [names, setNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(draft.systems.map((s) => [s.key, s.name])),
  );
  const [projectName, setProjectName] = useState("Whiteboard topology");

  const toggle = (key: string) => {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const visibleConnections = draft.connections.filter(
    (c) => included.has(c.fromKey) && included.has(c.toKey),
  );
  const nameOf = (key: string): string => {
    const edited = (names[key] ?? "").trim();
    if (edited !== "") return edited;
    return draft.systems.find((s) => s.key === key)?.name ?? key;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Send board to System Design"
    >
      <div className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
        <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
          Send to System Design
        </p>
        <h2 className="mt-1 text-lg font-bold text-[var(--color-ink)]">
          {draft.systems.length} system{draft.systems.length === 1 ? "" : "s"},{" "}
          {draft.connections.length} flow{draft.connections.length === 1 ? "" : "s"} found
        </h2>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Confirm what each box is. Methods, headers, auth and transforms stay empty for you to
          fill on the System canvas.
        </p>

        <label className="mt-4 block text-xs font-semibold text-[var(--color-ink)]">
          Project name
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2 text-sm font-normal"
          />
        </label>

        <ul className="mt-3 space-y-2">
          {draft.systems.map((s) => (
            <li
              key={s.key}
              className="flex items-center gap-2 rounded-lg border border-[var(--color-line-soft)] px-3 py-2"
            >
              <input
                type="checkbox"
                checked={included.has(s.key)}
                onChange={() => toggle(s.key)}
                aria-label={`Include ${s.name}`}
                className="h-4 w-4 shrink-0 cursor-pointer"
              />
              <div className="min-w-0 flex-1">
                <input
                  value={names[s.key] ?? ""}
                  onChange={(e) => setNames((p) => ({ ...p, [s.key]: e.target.value }))}
                  aria-label="System name"
                  className="w-full rounded-md border border-transparent bg-transparent px-1 text-sm font-semibold text-[var(--color-ink)] hover:border-[var(--color-line-soft)] focus:border-[var(--color-accent)] focus:outline-none"
                />
                <p className="px-1 text-[11px] text-[var(--color-muted)]">
                  {s.systemType}
                  {s.portHint ? ` · port :${s.portHint}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ul>

        {visibleConnections.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-[var(--color-ink)]">Flows</p>
            <ul className="mt-1 space-y-1">
              {visibleConnections.map((c) => (
                <li key={c.key} className="text-xs text-[var(--color-muted)]">
                  <span className="font-semibold text-[var(--color-ink)]">{nameOf(c.fromKey)}</span>
                  {" → "}
                  <span className="font-semibold text-[var(--color-ink)]">{nameOf(c.toKey)}</span>
                  {c.label !== "" && <span className="font-mono"> · {c.label}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {draft.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-lg bg-[var(--color-warning-bg)] px-3 py-2">
            {draft.warnings.map((w, i) => (
              <li key={i} className="text-xs text-[var(--color-ink-soft)]">
                {w}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-[var(--color-line)] px-3.5 py-2 text-xs font-semibold hover:border-[var(--color-accent)] transition-colors cursor-pointer"
          >
            Keep drawing
          </button>
          <button
            type="button"
            disabled={included.size === 0}
            onClick={() =>
              onConfirm({ included: [...included], names, projectName })
            }
            className="rounded-lg bg-ivory-950 px-3.5 py-2 text-xs font-semibold text-ivory-100 hover:bg-bronze-600 transition-colors cursor-pointer disabled:opacity-40"
          >
            Send to System
          </button>
        </div>
      </div>
    </div>
  );
}
