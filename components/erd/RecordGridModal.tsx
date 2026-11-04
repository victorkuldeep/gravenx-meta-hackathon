"use client";

import { useEffect, useMemo, useState } from "react";
import { buildExcelWorkbook, downloadExcelWorkbook, safeSheetName } from "@/lib/excel/workbook";
import {
  filterGridRows,
  gridCellFull,
  gridColumns,
  gridRowsToMatrix,
  gridRowsToTsv,
} from "@/lib/erd/recordGrid";
import { formatCellValue, type RecordTableGroup } from "./RecordPopover";
import { ColumnPickerModal } from "./ColumnPickerModal";

const ICON_BTN =
  "rounded-md border border-[var(--color-line)] p-1.5 text-ivory-500 transition-colors hover:text-bronze-600 hover:border-bronze-400 cursor-pointer disabled:opacity-40";

/**
 * Full-screen 2-D grid over every aboard record of one object: records as
 * rows, API names as columns, both scroll directions, global search,
 * per-column filters, column chooser, and copy/download as Excel.
 * Read-only by design - row edits go through the existing edit modal.
 */
export function RecordGridModal({
  apiName,
  nodeLabel,
  rows,
  groups,
  requiredFields,
  onClose,
  onEditRecord,
}: {
  apiName: string;
  nodeLabel: string;
  rows: Record<string, unknown>[];
  /** Per-parent slices; tabs render when > 1. Defaults to every row. */
  groups?: RecordTableGroup[];
  /** Required field API names - pinned behind Id, then Name. */
  requiredFields?: string[];
  onClose: () => void;
  /** Open the existing full-screen edit modal for one row. */
  onEditRecord: (apiName: string, id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [colsOpen, setColsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Parent tab: "__all__" or a group key. Search/filters/columns follow it. */
  const [groupKey, setGroupKey] = useState("__all__");
  const parentGroups = groups ?? [];
  const tabbed = parentGroups.length > 1;
  const activeGroup = tabbed ? parentGroups.find((g) => g.key === groupKey) : undefined;
  const activeRows = activeGroup ? activeGroup.rows : rows;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        // Topmost first: Escape closes the column modal, never the grid.
        if (colsOpen) setColsOpen(false);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, colsOpen]);

  const allCols = useMemo(() => gridColumns(activeRows, requiredFields ?? []), [activeRows, requiredFields]);
  const visibleCols = useMemo(() => allCols.filter((c) => !hidden.has(c)), [allCols, hidden]);
  const filtered = useMemo(
    () => filterGridRows(activeRows, allCols, { search, cols: colFilters, hidden }),
    [activeRows, allCols, search, colFilters, hidden]
  );

  const copyExcel = async () => {
    try {
      await navigator.clipboard.writeText(gridRowsToTsv(filtered, visibleCols));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  const downloadExcel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const wb = await buildExcelWorkbook([
        {
          name: safeSheetName(apiName, new Set()),
          header: visibleCols,
          rows: gridRowsToMatrix(filtered, visibleCols),
          widths: visibleCols.map(() => 28),
        },
      ]);
      await downloadExcelWorkbook(wb, `${apiName.toLowerCase()}-records.xlsx`);
    } finally {
      setBusy(false);
    }
  };

  const toggleCol = (c: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };
  const showCols = (cols: string[]) => {
    setHidden((prev) => {
      const next = new Set(prev);
      for (const c of cols) next.delete(c);
      return next;
    });
  };
  const hideCols = (cols: string[]) => {
    setHidden((prev) => new Set([...prev, ...cols]));
  };

  return (
    <div
      data-grid-modal
      role="dialog"
      aria-modal="true"
      aria-label={`${nodeLabel} records as a table`}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/45 p-3 sm:p-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_24px_64px_-16px_rgba(24,20,12,0.5)]">
        <div className="border-b border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ivory-950">
              {nodeLabel} · <span className="font-mono">{apiName}</span>
              <span className="ml-2 font-mono text-[10px] font-normal text-ivory-500">
                {filtered.length}/{activeRows.length} rows · {visibleCols.length}/{allCols.length} cols
              </span>
            </p>
            <button
              type="button"
              onClick={() => void copyExcel()}
              title="Copy visible grid as Excel (tab-separated)"
              aria-label="Copy grid as Excel"
              className={ICON_BTN}
            >
              {copied ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                  <path d="m4 12.5 5 5L20 6.5" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="9" y="9" width="12" height="12" rx="2" />
                  <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => void downloadExcel()}
              disabled={busy || filtered.length === 0}
              title="Download visible grid as Excel (.xlsx)"
              aria-label="Download grid as Excel"
              className={ICON_BTN}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close records table"
              title="Close records table"
              className={ICON_BTN}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          {tabbed && (
            <div className="mt-2 flex flex-nowrap gap-1 overflow-x-auto pb-0.5" role="tablist" aria-label="Parent records">
              <button
                type="button"
                role="tab"
                aria-selected={!activeGroup}
                onClick={() => setGroupKey("__all__")}
                title="Every aboard record, all parents"
                className={`rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                  !activeGroup
                    ? "border-bronze-400 bg-bronze-100 text-bronze-700"
                    : "border-[var(--color-line)] bg-white text-ivory-500 hover:text-ivory-950"
                }`}
              >
                All ({rows.length})
              </button>
              {parentGroups.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  role="tab"
                  aria-selected={activeGroup?.key === g.key}
                  onClick={() => setGroupKey(g.key)}
                  title={g.label}
                  className={`shrink-0 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    activeGroup?.key === g.key
                      ? "border-bronze-400 bg-bronze-100 text-bronze-700"
                      : "border-[var(--color-line)] bg-white text-ivory-500 hover:text-ivory-950"
                  }`}
                >
                  {g.label} ({g.rows.length})
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <div className="relative min-w-[180px] flex-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ivory-500">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search all visible cells…"
                aria-label="Search grid cells"
                spellCheck={false}
                className="w-full rounded-lg border border-[var(--color-line)] bg-white py-1.5 pl-7 pr-2 text-[12px] text-ivory-950 placeholder:text-ivory-500 focus:border-bronze-400 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={() => setColsOpen(true)}
              title="Choose which API columns stay visible"
              className="rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-ivory-700 hover:text-bronze-600 hover:border-bronze-400 transition-colors cursor-pointer"
            >
              Columns {visibleCols.length}/{allCols.length}
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {visibleCols.length === 0 ? (
            <p className="px-4 py-10 text-center text-[12px] text-ivory-500">
              All columns hidden - reopen Columns and tick at least one API name.
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-[12px] text-ivory-500">
              No records match the current search and filters.
            </p>
          ) : (
            <table className="border-collapse">
              <thead className="sticky top-0 z-[2]">
                <tr>
                  <th className="sticky left-0 z-[3] border-b border-r border-[var(--color-line)] bg-[var(--color-surface-soft)] px-2 py-1.5 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-ivory-500">
                    #
                  </th>
                  {visibleCols.map((c) => (
                    <th
                      key={c}
                      className="whitespace-nowrap border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-2 py-1.5 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-ivory-500"
                      title={c}
                    >
                      {c}
                    </th>
                  ))}
                  <th className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-2 py-1.5" aria-label="Row actions" />
                </tr>
                <tr>
                  <th className="sticky left-0 z-[3] border-b border-r border-[var(--color-line)] bg-[var(--color-surface-soft)] px-2 py-1" aria-label="No filter" />
                  {visibleCols.map((c) => (
                    <th key={c} className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-1 py-1">
                      <input
                        value={colFilters[c] ?? ""}
                        onChange={(e) => setColFilters((prev) => ({ ...prev, [c]: e.target.value }))}
                        placeholder={`Filter ${c}…`}
                        aria-label={`Filter ${c} column`}
                        spellCheck={false}
                        className="w-full min-w-[90px] rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[10px] text-ivory-950 placeholder:text-ivory-500 focus:border-bronze-400 focus:outline-none"
                      />
                    </th>
                  ))}
                  <th className="border-b border-[var(--color-line)] bg-[var(--color-surface-soft)] px-2 py-1" aria-label="No filter" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const id = typeof row.Id === "string" ? row.Id : null;
                  return (
                    <tr key={id ?? i} className="odd:bg-white even:bg-[var(--color-canvas)] hover:bg-bronze-100/60">
                      <td className="sticky left-0 border-r border-[var(--color-line-soft)] bg-inherit px-2 py-1">
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-ivory-500">{i + 1}</span>
                          {id && (
                            <button
                              type="button"
                              onClick={() => onEditRecord(apiName, id)}
                              title="Edit this record full-screen"
                              aria-label={`Edit record ${id}`}
                              className="rounded p-0.5 text-bronze-600 transition-colors hover:bg-bronze-100 hover:text-bronze-700 cursor-pointer"
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                                <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                              </svg>
                            </button>
                          )}
                        </span>
                      </td>
                      {visibleCols.map((c) => (
                        <td
                          key={c}
                          className="max-w-[280px] truncate border-b border-[var(--color-line-soft)] px-2 py-1 font-mono text-[11px] text-ivory-950"
                          title={gridCellFull(row[c])}
                        >
                          {formatCellValue(row[c])}
                        </td>
                      ))}
                      <td className="border-b border-[var(--color-line-soft)] px-2 py-1">
                        {id && (
                          <button
                            type="button"
                            onClick={() => onEditRecord(apiName, id)}
                            title="Edit this record full-screen"
                            className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-bronze-600 hover:text-bronze-700 hover:bg-bronze-100 transition-colors cursor-pointer"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="border-t border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-1.5">
          <p className="font-mono text-[10px] text-ivory-500">
            Read-only grid · session data only · per-row Edit opens the full-screen editor · exports carry the current filters
          </p>
        </div>
      </div>
      {colsOpen && (
        <ColumnPickerModal
          title={`Columns · ${nodeLabel}`}
          subtitle={`${allCols.length} API columns - tick what stays visible`}
          columns={allCols}
          hidden={hidden}
          onToggle={toggleCol}
          onShow={showCols}
          onHide={hideCols}
          onClose={() => setColsOpen(false)}
        />
      )}
    </div>
  );
}
