"use client";

import { useMemo, useState } from "react";
import Button from "./ui/Button";
import type { SoqlQuery } from "@/lib/soql/historyDb";

/**
 * One searchable history surface (B3). Replaces the History / Saved /
 * Delete-saved selects: search across both, load on click, delete per row,
 * clear-history with confirm - saved queries are never touched by clear.
 */
export function QueryHistoryDialog({
  history,
  saved,
  onClose,
  onLoad,
  onDelete,
  onClearHistory,
}: {
  history: SoqlQuery[];
  saved: SoqlQuery[];
  onClose: () => void;
  onLoad: (q: SoqlQuery) => void;
  onDelete: (id: string) => void;
  onClearHistory: () => Promise<number>;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"all" | "saved" | "history">("all");
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = tab === "saved" ? saved : tab === "history" ? history : [...saved, ...history];
    const filtered = q
      ? pool.filter((h) => (h.label || "").toLowerCase().includes(q) || h.soql.toLowerCase().includes(q))
      : pool;
    return filtered.slice(0, 100);
  }, [query, tab, saved, history]);

  const clear = async () => {
    try {
      const n = await onClearHistory();
      setNotice(n > 0 ? `Cleared ${n} run${n === 1 ? "" : "s"} (saved queries kept).` : "History already empty.");
    } catch {
      setNotice("Couldn't clear history.");
    } finally {
      setConfirmClear(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Query history" onClick={onClose}>
      <div
        className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <p className="text-sm font-semibold text-ivory-950">History & saved queries</p>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-lg px-2 py-1 text-xs text-ivory-700 hover:bg-ivory-200">
            ✕
          </button>
        </div>
        <div className="px-4 pt-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search label or SQL…"
            aria-label="Search queries"
            spellCheck={false}
            autoFocus
            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1.5 px-4 pt-2" role="tablist" aria-label="History filter">
          {(["all", "saved", "history"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`cursor-pointer rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                tab === t ? "border-bronze-600 bg-bronze-600 text-white" : "border-[var(--color-line)] text-ivory-700"
              }`}
            >
              {t === "all" ? `All (${saved.length + history.length})` : t === "saved" ? `Saved (${saved.length})` : `Runs (${history.length})`}
            </button>
          ))}
          <span className="flex-1" />
          {!confirmClear ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={history.length === 0}
              title="Clear run history (saved queries are kept)"
              className="cursor-pointer rounded-lg px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-40"
            >
              Clear runs…
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11px]">
              <span className="font-semibold text-red-700">Clear {history.length} runs?</span>
              <button type="button" onClick={() => void clear()} className="cursor-pointer rounded px-1 font-semibold text-red-700 hover:bg-red-50">
                Yes
              </button>
              <button type="button" onClick={() => setConfirmClear(false)} className="cursor-pointer rounded px-1 text-ivory-700 hover:bg-ivory-200">
                No
              </button>
            </span>
          )}
        </div>
        {notice && <p className="px-4 pt-1.5 text-[11px] font-semibold text-emerald-700">{notice}</p>}
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-ivory-700">
            {query.trim() || saved.length > 0 || history.length > 0
              ? "No queries match."
              : "No runs yet and nothing saved. Run a query in the editor above, or load the training set from Mapping."}
          </p>
        ) : (
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto p-3">
            {rows.map((h) => (
              <li key={h.id} className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] px-2.5 py-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onLoad(h);
                    onClose();
                  }}
                  title="Load into editor"
                  className="min-w-0 flex-1 cursor-pointer text-left"
                >
                  <span className="block truncate text-xs font-semibold text-ivory-950">
                    {h.saved ? `★ ${h.label}` : h.soql.slice(0, 80)}
                  </span>
                  <span className="block truncate font-mono text-[10px] text-ivory-700">
                    {(h.mode ?? "soql").toUpperCase()} · {(h.rowCount ?? "?") + " rows"} · {h.saved ? h.soql.slice(0, 80) : new Date(h.lastRun).toLocaleString()}
                  </span>
                </button>
                <span className="shrink-0 rounded border border-[var(--color-line)] px-1 font-mono text-[9px] text-ivory-700">
                  {(h.mode ?? "soql").toUpperCase()}
                </span>
                <button
                  type="button"
                  onClick={() => onDelete(h.id)}
                  title={h.saved ? "Delete saved query" : "Remove from history"}
                  aria-label={`Delete ${h.saved ? h.label : h.soql.slice(0, 40)}`}
                  className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[11px] text-red-700 hover:bg-red-50"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-1.5 border-t border-[var(--color-line)] px-4 py-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
