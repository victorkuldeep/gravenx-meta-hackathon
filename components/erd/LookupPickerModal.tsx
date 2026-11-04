"use client";

import { useEffect, useRef, useState } from "react";

export interface LookupHit {
  id: string;
  name: string;
  /** Extra context per row, e.g. Group Type ("Queue"). */
  extra?: string;
}

/**
 * Reference-field picker: search records of the lookup target object(s)
 * and write the chosen Id back. Typing an Id by hand always stays available
 * in the field itself - this is the optional "go and search" shortcut.
 */
export function LookupPickerModal({
  fieldLabel,
  targets,
  targetLabelOf,
  initialTarget,
  currentId,
  currentName,
  onSearch,
  onPick,
  onClose,
}: {
  fieldLabel: string;
  /** referenceTo objects, e.g. ["User", "Group"] for Owner. */
  targets: string[];
  targetLabelOf: (apiName: string) => string;
  initialTarget?: string;
  /** Saved/draft Id on the record - pinned as the Current row. */
  currentId?: string | null;
  /** Resolved human label for the current Id (still loading until set). */
  currentName?: string | null;
  onSearch: (apiName: string, query: string) => Promise<LookupHit[]>;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState(
    initialTarget && targets.includes(initialTarget) ? initialTarget : (targets[0] ?? ""),
  );
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [hits, setHits] = useState<LookupHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!target) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    setError(null);
    void onSearch(target, debounced)
      .then((rows) => {
        if (searchSeq.current !== seq) return;
        setHits(rows);
      })
      .catch((err: unknown) => {
        if (searchSeq.current !== seq) return;
        setError(err instanceof Error ? err.message : "Search failed.");
        setHits([]);
      })
      .finally(() => {
        if (searchSeq.current === seq) setSearching(false);
      });
  }, [target, debounced, onSearch]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Pick ${fieldLabel}`}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_32px_96px_-16px_rgba(24,20,12,0.5)]">
        <div className="shrink-0 border-b border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-ivory-950" title={`Pick ${fieldLabel}`}>
              Pick {fieldLabel}
            </p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close picker"
              title="Close picker"
              className="shrink-0 rounded px-1.5 py-0.5 text-[12px] font-semibold text-ivory-500 hover:text-ivory-950 hover:bg-ivory-200 transition-colors cursor-pointer"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 flex gap-1.5">
            {targets.length > 1 && (
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                aria-label="Target object"
                title="This lookup points at several objects - pick which to search"
                className="shrink-0 cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 text-[12px] font-semibold text-ivory-950"
              >
                {targets.map((t) => (
                  <option key={t} value={t}>
                    {targetLabelOf(t)}
                  </option>
                ))}
              </select>
            )}
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setDebounced(query);
              }}
              placeholder={`Search ${targetLabelOf(target)} by name…`}
              aria-label={`Search ${targetLabelOf(target)}`}
              spellCheck={false}
              autoComplete="off"
              className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-white px-2.5 text-[12px] text-ivory-950 placeholder-ivory-500 focus:border-bronze-500 focus:outline-none"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {searching && hits.length === 0 && (
            <p className="px-2 py-3 text-[12px] text-bronze-600">Searching {targetLabelOf(target)}…</p>
          )}
          {error && (
            <p className="m-1 rounded-lg border border-red-300 bg-red-50 px-2.5 py-2 text-[12px] text-red-700" role="alert">
              {error}
            </p>
          )}
          {!searching && !error && hits.length === 0 && (
            <p className="px-2 py-3 text-[12px] text-ivory-600">
              No {targetLabelOf(target)} matches{debounced.trim() ? ` for “${debounced.trim()}”` : " yet"}. You can still paste an Id directly in the field.
            </p>
          )}
          <ul className="space-y-1">
            {currentId && (
              <li>
                <button
                  type="button"
                  onClick={() => onPick(currentId)}
                  title={`Keep ${currentId}`}
                  className="w-full rounded-xl border border-bronze-400 bg-bronze-100/60 px-3 py-2 text-left transition-colors hover:border-bronze-500 cursor-pointer"
                >
                  <span className="block truncate text-[12px] font-bold text-ivory-950">
                    {currentName ?? currentId}
                    <span className="ml-1.5 rounded-full border border-bronze-300 bg-white px-1.5 py-px font-mono text-[10px] font-bold text-bronze-700">CURRENT</span>
                  </span>
                  <span className="block truncate font-mono text-[10px] text-ivory-500">{currentName ? currentId : "Resolving…"}</span>
                </button>
              </li>
            )}
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => onPick(h.id)}
                  title={`Use ${h.id}`}
                  className={`w-full rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer ${
                    h.id === currentId
                      ? "border-bronze-400 bg-bronze-100/60 hover:border-bronze-500"
                      : "border-[var(--color-line-soft)] bg-white hover:border-bronze-400 hover:bg-bronze-100/50"
                  }`}
                >
                  <span className="block truncate text-[12px] font-bold text-ivory-950">
                    {h.name}
                    {h.extra && <span className="ml-1.5 font-mono text-[10px] font-semibold text-bronze-700">· {h.extra}</span>}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-ivory-500">{h.id}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="shrink-0 border-t border-[var(--color-line-soft)] px-4 py-2">
          <p className="text-[10px] text-ivory-500">Tip: an Id typed by hand works too - the picker is just a shortcut.</p>
        </div>
      </div>
    </div>
  );
}
