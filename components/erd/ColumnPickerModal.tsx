"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import Input from "../ui/Input";

/**
 * Column chooser for the record grid: the same Custom/Standard tabbed
 * experience as the Pull Child/Parent picker. Select-all and clear-all are
 * icon buttons scoped to the active tab; visibility applies live so Done
 * just closes. Escape/backdrop never leak to the grid underneath - the grid
 * owns Escape while this modal is open.
 */
export function ColumnPickerModal({
  title,
  subtitle,
  columns,
  hidden,
  onToggle,
  onShow,
  onHide,
  onClose,
}: {
  title: string;
  subtitle: string;
  columns: string[];
  hidden: Set<string>;
  onToggle: (col: string) => void;
  /** Show every column in the list (select-all for one tab). */
  onShow: (cols: string[]) => void;
  /** Hide every column in the list (clear for one tab). */
  onHide: (cols: string[]) => void;
  onClose: () => void;
}) {
  const custom = useMemo(() => columns.filter((c) => c.endsWith("__c")), [columns]);
  const standard = useMemo(() => columns.filter((c) => !c.endsWith("__c")), [columns]);
  // Land on the family that has rows; Custom wins ties.
  const [family, setFamily] = useState<"custom" | "standard">(() =>
    custom.length === 0 && standard.length > 0 ? "standard" : "custom"
  );
  const [filter, setFilter] = useState("");

  const active = family === "custom" ? custom : standard;
  const visible = useMemo(() => {
    const q = filter.toLowerCase().trim();
    if (!q) return active;
    return active.filter((c) => c.toLowerCase().includes(q));
  }, [active, filter]);
  const visibleCount = columns.length - hidden.size;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{ paddingTop: "10vh" }}
    >
      <div
        className="modal-card max-w-lg flex flex-col"
        style={{ maxHeight: "78vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-3 border-b border-[var(--color-line-soft)] shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
            Visible columns
          </p>
          <h2 className="mt-1 text-lg font-bold text-ivory-950">{title}</h2>
          <p className="mt-0.5 text-xs text-ivory-600">{subtitle}</p>
          <div className="mt-3 flex rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-0.5" role="tablist" aria-label="Column family">
            {(
              [
                ["custom", `Custom (${custom.length})`],
                ["standard", `Standard (${standard.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={family === id}
                onClick={() => {
                  setFamily(id);
                  setFilter("");
                }}
                className={`flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                  family === id ? "bg-[var(--color-surface)] text-ivory-950 shadow-sm" : "text-ivory-500 hover:text-ivory-950"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <Input
                placeholder="Filter columns…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter columns"
              />
            </div>
            <button
              type="button"
              onClick={() => onShow(active)}
              title="Select all in this tab (keeps the other tab's columns)"
              aria-label="Select all in this tab"
              className="shrink-0 rounded-md border border-[var(--color-line)] p-1.5 text-bronze-600 transition-colors hover:border-bronze-400 hover:bg-bronze-100/60 cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="3" />
                <path d="m8.5 12.5 2.5 2.5 5-5.5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => onHide(active)}
              title="Clear this tab (keeps the other tab's columns)"
              aria-label="Clear this tab"
              className="shrink-0 rounded-md border border-[var(--color-line)] p-1.5 text-ivory-500 transition-colors hover:border-bronze-400 hover:text-bronze-600 hover:bg-bronze-100/60 cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <rect x="4" y="4" width="16" height="16" rx="3" />
                <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {active.length === 0 ? (
            <p className="py-6 text-center text-xs text-ivory-600">
              {family === "custom"
                ? "No custom columns - everything here is standard."
                : "No standard columns - everything here is custom."}
            </p>
          ) : visible.length === 0 ? (
            <p className="py-6 text-center text-xs text-ivory-600">No columns match.</p>
          ) : (
            <div className="rounded-lg border border-[var(--color-line)] divide-y divide-[var(--color-line-soft)] overflow-hidden">
              {visible.map((c) => (
                <label
                  key={c}
                  className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:bg-ivory-300 ${
                    hidden.has(c) ? "" : "bg-ivory-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!hidden.has(c)}
                    onChange={() => onToggle(c)}
                    className="h-4 w-4 shrink-0 rounded border-ivory-400 bg-white text-bronze-600 focus:ring-bronze-500"
                    aria-label={`Show ${c} column`}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ivory-950" title={c}>
                    {c}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-3.5 border-t border-[var(--color-line-soft)] bg-[var(--color-canvas)] flex items-center gap-2 shrink-0">
          <p className="flex-1 text-[11px] text-ivory-600">
            {visibleCount} of {columns.length} visible · across both tabs
          </p>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
