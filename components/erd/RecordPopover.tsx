"use client";

import { useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import { RecordGridModal } from "./RecordGridModal";

export interface RecordFieldMeta {
  name: string;
  label: string;
  type: string;
  updateable: boolean;
  /** Required (!nillable) - red asterisk in the edit modal. */
  required?: boolean;
  /** Lookup targets for reference fields - picker search in the edit modal. */
  refs?: string[];
  picklistValues?: { label: string; value: string }[];
}

export interface RecordSection {
  key: string;
  viaLabel: string;
  childApi: string;
  rows: Record<string, unknown>[];
  exhausted: boolean;
  loadingMore: boolean;
}

/** Picker candidates scoped to one loaded parent (eye list tab). */
export interface RecordCandidateGroup {
  key: string;
  label: string;
  ids: { id: string; name: string }[];
}

/** Grid rows scoped to one loaded parent (table-grid modal tab). */
export interface RecordTableGroup {
  key: string;
  label: string;
  rows: Record<string, unknown>[];
}

export interface RecordPopData {
  apiName: string;
  nodeLabel: string;
  /** Single-record rows (root / parent pulls). */
  single: { label: string; value: string }[] | null;
  singleId: string | null;
  /** 1-many sections, one per loaded parent. */
  sections: RecordSection[];
  /** Unreachable hint + the canvas parent to load first. */
  blockedHint: string | null;
  blockedApi: string | null;
  loading: boolean;
  error: string | null;
  /** Viewport anchor (icon rect) - panel flips to fit. */
  x: number;
  y: number;
  /** Picker = choose which aboard record the entity box visualizes.
   * Record = full dump + edit for the selected record.
   * Lookup = on-demand target of one reference field from one source row. */
  mode: "picker" | "record" | "lookup";
  /** Every aboard id with a human name; the entity box shows selectedId. */
  candidates: { id: string; name: string }[];
  /** Every aboard row for the entity: singles then child rows, deduped by Id. Feeds the table-grid modal. */
  tableRows: Record<string, unknown>[];
  /** Per-parent slices of candidates/tableRows; tabs render when > 1. */
  candidateGroups: RecordCandidateGroup[];
  tableGroups: RecordTableGroup[];
  /** Required (!nillable) field API names - pinned behind Id in the grid. */
  requiredFields: string[];
  selectedId: string | null;
  /** Lookup jump context: which source field's target this panel shows. */
  lookup?: {
    sourceApi: string;
    sourceName: string;
    fieldName: string;
    targetLabel: string;
    targetId: string;
    keyField: string | null;
    kind: string | null;
  } | null;
}

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
};

/** Shared by the peek panel and the full-screen edit modal. */
export { cell as formatCellValue };

const NUMBER_TYPES = new Set(["int", "double", "currency", "percent", "long", "number"]);

/** Type-aware cell editor shared by the peek panel and the edit modal.
 * Read-only span when the field has no updateable meta. */
export function FieldInput({
  meta,
  value,
  onChange,
}: {
  meta?: RecordFieldMeta;
  value: string | boolean;
  onChange: (v: string | boolean) => void;
}) {
  if (!meta || !meta.updateable) {
    return (
      <span className="min-w-0 break-all text-right font-mono text-[11px] text-ivory-400">
        {typeof value === "boolean" ? String(value) : cell(value)}
      </span>
    );
  }
  if (meta.type === "boolean") {
    return (
      <span className="flex justify-end">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-3.5 w-3.5 cursor-pointer accent-bronze-600"
          aria-label={meta.label}
        />
      </span>
    );
  }
  if (meta.type === "picklist" && meta.picklistValues && meta.picklistValues.length > 0) {
    return (
      <select
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label={meta.label}
        className="w-full cursor-pointer rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[11px] text-ivory-950"
      >
        <option value="">—</option>
        {meta.picklistValues.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}{p.label !== p.value ? ` (${p.value})` : ""}
          </option>
        ))}
      </select>
    );
  }
  if (meta.type === "date") {
    return (
      <input
        type="date"
        value={typeof value === "string" ? value.slice(0, 10) : ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label={meta.label}
        className="w-full rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[11px] text-ivory-950"
      />
    );
  }
  if (meta.type === "datetime") {
    return (
      <input
        type="datetime-local"
        value={typeof value === "string" ? value.slice(0, 16) : ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label={meta.label}
        className="w-full rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[11px] text-ivory-950"
      />
    );
  }
  if (NUMBER_TYPES.has(meta.type)) {
    return (
      <input
        type="number"
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label={meta.label}
        className="w-full rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[11px] text-ivory-950"
      />
    );
  }
  return (
    <input
      type="text"
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      aria-label={meta.label}
      spellCheck={false}
      className="w-full rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[11px] text-ivory-950"
    />
  );
}

function SectionRows({
  rows,
  selectedId,
  onSelectRow,
  onEditRow,
}: {
  rows: Record<string, unknown>[];
  selectedId: string | null;
  onSelectRow?: (id: string) => void;
  /** Open the full-screen edit modal for this exact record. */
  onEditRow?: (id: string) => void;
}) {
  return (
    <ul className="space-y-1">
      {rows.map((r, i) => {
        const id = typeof r.Id === "string" ? r.Id : String(i);
        const isSelected = selectedId === id;
        return (
          <li
            key={id}
            onClick={onSelectRow ? () => onSelectRow(id) : undefined}
            title={onSelectRow ? "Visualize this record in the entity box" : undefined}
            className={`rounded-lg border px-2 py-1.5 bg-[var(--color-canvas)] ${
              isSelected ? "border-bronze-500 ring-1 ring-bronze-500" : "border-[var(--color-line-soft)]"
            } ${onSelectRow ? "cursor-pointer hover:border-bronze-400" : ""}`}
          >
            {isSelected && onSelectRow && (
              <p className="pb-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-bronze-700">
                Visualizing
              </p>
            )}
            {Object.entries(r).map(([k, v]) => {
              // The REST envelope's attributes block ({type, url}) is noise
              // on a card - the header already names the object.
              if (k === "attributes") return null;
              return (
                <p key={k} className="flex items-baseline justify-between gap-2">
                  <span className="shrink-0 font-mono text-[10px] text-ivory-500">{k}</span>
                  <span className="min-w-0 break-all text-right font-mono text-[11px] text-ivory-950">{cell(v)}</span>
                </p>
              );
            })}
            {onEditRow && typeof r.Id === "string" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditRow(r.Id as string);
                }}
                aria-label="Edit this record full-screen"
                title="Edit this record full-screen"
                className="mt-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-bronze-600 hover:text-bronze-700 hover:bg-bronze-100 transition-colors cursor-pointer"
              >
                Edit
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function RecordPopover({
  pop,
  onClose,
  onLoadMore,
  onFetchMissing,
  onClear,
  onRefresh,
  refreshing,
  onSelectRecord,
  onModeChange,
  onCopyLookup,
  onEditRecord,
  onInspectRecord,
}: {
  pop: RecordPopData;
  onClose: () => void;
  onLoadMore: (sectionKey: string) => void;
  onFetchMissing: (apiName: string) => void;
  onClear: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** Visualize an aboard record in the entity box (picker + section rows). */
  onSelectRecord: (apiName: string, id: string) => void;
  onModeChange: (mode: "picker" | "record" | "lookup") => void;
  /** Copy a lookup's target label + Id for the row it came from. */
  onCopyLookup: (value: string) => void;
  /** Open the full-screen edit modal for a record of any aboard object. */
  onEditRecord: (apiName: string, id: string) => void;
  /** Visualize a candidate AND jump straight to its record view. */
  onInspectRecord: (apiName: string, id: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [copiedLookup, setCopiedLookup] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  /** Picker candidate tab: "__all__" or a parent group key. */
  const [candTab, setCandTab] = useState("__all__");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLElement && e.target.closest("[data-grid-modal]"))) onClose();
    };
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as globalThis.Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  // Reset transient state whenever a different node or panel opens.
  useEffect(() => {
    setCopiedLookup(false);
    setGridOpen(false);
    setCandTab("__all__");
  }, [pop.apiName, pop.mode, pop.lookup?.targetId]);

  const W = 320;
  const left = Math.min(Math.max(8, pop.x), Math.max(8, window.innerWidth - W - 8));
  const top = Math.min(Math.max(8, pop.y), Math.max(8, window.innerHeight - 420));

  // Lookup mode shows a live status line: resolving, then the key field (or
  // raw-Id fallback). Never a silent empty panel.
  if (pop.mode === "lookup") {
    const lk = pop.lookup;
    return (
      <div
        ref={rootRef}
        role="dialog"
        aria-label={`Lookup target for ${lk?.fieldName ?? "field"}`}
        className="fixed z-[80] w-[320px] overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_16px_48px_-12px_rgba(24,20,12,0.4)]"
        style={{ left, top }}
      >
        <div className="border-b border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-3 py-2">
          <div className="flex items-center gap-1">
            <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ivory-950">
              {lk ? `${lk.sourceName} · ${lk.fieldName}` : "Lookup target"}
              {lk?.kind && (
                <span className="ml-1.5 rounded-full border border-bronze-300 bg-bronze-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-bronze-700">
                  {lk.kind}
                </span>
              )}
            </p>
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing || pop.loading}
              aria-label="Retry lookup pull"
              title="Retry lookup pull"
              className="rounded p-1 text-ivory-500 hover:text-bronze-600 hover:bg-ivory-200 transition-colors cursor-pointer disabled:opacity-40"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className={refreshing ? "animate-spin" : ""}>
                <path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3" />
                <path d="M18 4v4h-4M6 20v-4h4" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close lookup panel"
              title="Close lookup panel"
              className="rounded p-1 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-200 transition-colors cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <p className="text-[10px] text-ivory-600">Live record data · session only, never stored</p>
        </div>
        <div className="max-h-[300px] overflow-y-auto p-2.5">
          {pop.loading && <p className="px-1 py-2 text-xs text-bronze-600">Pulling target…</p>}
          {pop.error && (
            <p className="rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-700" role="alert">
              {pop.error}
            </p>
          )}
          {lk && (
            <div className="px-1 py-1">
              <p className="mt-0.5 break-all font-mono text-[11px] font-bold leading-relaxed text-ivory-950" title={lk.targetId}>
                {lk.targetLabel}
              </p>
              <p className="mt-0.5 break-all font-mono text-[10px] text-ivory-500" title={lk.targetId}>
                {lk.targetId}
                {lk.keyField && lk.targetLabel !== lk.targetId ? ` · via ${lk.keyField}` : ""}
              </p>
              <div className="mt-1.5 flex gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    onCopyLookup(lk.targetLabel === lk.targetId ? lk.targetId : `${lk.targetLabel} (${lk.targetId})`);
                    setCopiedLookup(true);
                    window.setTimeout(() => setCopiedLookup(false), 1200);
                  }}
                >
                  {copiedLookup ? "Copied ✓" : "Copy"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Picker tabs: one per loaded parent when several fed this node.
  // "All" preserves the full aboard list; a parent tab scopes to its rows.
  const tabbed = pop.candidateGroups.length > 1;
  const activeTab = tabbed ? pop.candidateGroups.find((g) => g.key === candTab) : undefined;
  const shownCandidates = activeTab ? activeTab.ids : pop.candidates;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`${pop.nodeLabel} record data`}
      className="fixed z-[80] w-[320px] overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_16px_48px_-12px_rgba(24,20,12,0.4)]"
      style={{ left, top }}
    >
      <div className="border-b border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-3 py-2">
        <div className="flex items-center gap-1">
          <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ivory-950">
            {pop.nodeLabel} · <span className="font-mono">{pop.apiName}</span>
          </p>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing || pop.loading}
            aria-label="Pull latest data from the server"
            title="Pull latest data from the server"
            className="rounded p-1 text-ivory-500 hover:text-bronze-600 hover:bg-ivory-200 transition-colors cursor-pointer disabled:opacity-40"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className={refreshing ? "animate-spin" : ""}>
              <path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3" />
              <path d="M18 4v4h-4M6 20v-4h4" />
            </svg>
          </button>
          {pop.tableRows.length > 0 && (
            <button
              type="button"
              onClick={() => setGridOpen(true)}
              aria-label={`View all ${pop.tableRows.length} ${pop.apiName} records as a table`}
              title={`View all ${pop.tableRows.length} records as a table - search, filter columns, export to Excel`}
              className="rounded p-1 text-ivory-500 hover:text-bronze-600 hover:bg-ivory-200 transition-colors cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 10h18M9 10v10" />
              </svg>
            </button>
          )}
          {pop.singleId && (
            <button
              type="button"
              onClick={() => onEditRecord(pop.apiName, pop.singleId!)}
              aria-label="Edit this record full-screen"
              title="Edit this record full-screen"
              className="rounded p-1 text-ivory-500 hover:text-bronze-600 hover:bg-ivory-200 transition-colors cursor-pointer"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
                <path d="m13.5 6.5 3 3" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close record panel"
            title="Close record panel"
            className="rounded p-1 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-200 transition-colors cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <p className="text-[10px] text-ivory-600">Live record data · session only, never stored</p>
      </div>
      <div className="max-h-[300px] overflow-y-auto p-2.5">
        {pop.loading && <p className="px-1 py-2 text-xs text-bronze-600">Pulling record…</p>}
        {pop.error && (
          <p className="rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-700" role="alert">
            {pop.error}
          </p>
        )}
        {pop.blockedHint && (
          <div className="px-1 py-1">
            <p className="text-[11px] leading-relaxed text-ivory-700">{pop.blockedHint}</p>
            {pop.blockedApi && (
              <Button size="sm" variant="secondary" className="mt-1.5 w-full" onClick={() => onFetchMissing(pop.blockedApi!)}>
                Load {pop.blockedApi} first
              </Button>
            )}
          </div>
        )}
        {pop.mode === "picker" && !pop.blockedHint && (
          <div className="px-1 py-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
              {shownCandidates.length === 0
                ? "No records aboard yet"
                : shownCandidates.length === 1
                  ? "1 record aboard - visualizing it"
                  : `${shownCandidates.length} records aboard - pick one to visualize`}
            </p>
            {tabbed && (
              <div className="mt-1.5 flex flex-nowrap gap-1 overflow-x-auto pb-0.5" role="tablist" aria-label="Parent records">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!activeTab}
                  onClick={() => setCandTab("__all__")}
                  title="Every aboard record, all parents"
                  className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold transition-colors cursor-pointer ${
                    !activeTab
                      ? "border-bronze-400 bg-bronze-100 text-bronze-700"
                      : "border-[var(--color-line-soft)] text-ivory-500 hover:text-ivory-950"
                  }`}
                >
                  All ({pop.candidates.length})
                </button>
                {pop.candidateGroups.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    role="tab"
                    aria-selected={activeTab?.key === g.key}
                    onClick={() => setCandTab(g.key)}
                    title={g.label}
                    className={`shrink-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-semibold transition-colors cursor-pointer ${
                      activeTab?.key === g.key
                        ? "border-bronze-400 bg-bronze-100 text-bronze-700"
                        : "border-[var(--color-line-soft)] text-ivory-500 hover:text-ivory-950"
                    }`}
                  >
                    {g.label} ({g.ids.length})
                  </button>
                ))}
              </div>
            )}
            {shownCandidates.length > 0 && (
              <ul className="mt-1.5 max-h-[180px] space-y-1 overflow-y-auto">
                {shownCandidates.map((c) => {
                  const active = pop.selectedId === c.id;
                  return (
                    <li key={c.id} className={`rounded-lg border px-2 py-1.5 transition-colors ${
                      active
                        ? "border-bronze-500 bg-bronze-100 ring-1 ring-bronze-500"
                        : "border-[var(--color-line-soft)] bg-[var(--color-canvas)]"
                    }`}>
                      <button
                        type="button"
                        onClick={() => onSelectRecord(pop.apiName, c.id)}
                        title={active ? "Visualizing in the entity box" : "Visualize in the entity box"}
                        className="w-full text-left cursor-pointer"
                      >
                        <p className="truncate text-[11px] font-bold text-ivory-950">{c.name}</p>
                        <p className="truncate font-mono text-[10px] text-ivory-500">{c.id}</p>
                      </button>
                      <button
                        type="button"
                        onClick={() => onInspectRecord(pop.apiName, c.id)}
                        title="Visualize and open this record for inspection"
                        className="mt-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-bronze-600 hover:text-bronze-700 hover:bg-bronze-100 transition-colors cursor-pointer"
                      >
                        Inspect →
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {pop.single && (
              <Button size="sm" variant="secondary" className="mt-1.5 w-full" onClick={() => onModeChange("record")}>
                Inspect selected record
              </Button>
            )}
          </div>
        )}
        {pop.mode === "record" && pop.candidates.length > 0 && (
          <div className="px-1 pb-1">
            <button
              type="button"
              onClick={() => onModeChange("picker")}
              className="text-[11px] font-semibold text-bronze-600 hover:text-bronze-700 cursor-pointer"
            >
              ← {pop.candidates.length} record{pop.candidates.length === 1 ? "" : "s"} aboard
            </button>
          </div>
        )}
        {pop.mode === "record" && pop.single && (
          <dl className="divide-y divide-[var(--color-line-soft)]">
            {pop.single.map((row) => (
              <div key={row.label} className="flex items-baseline justify-between gap-2 px-1 py-1">
                <dt className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-ivory-500">{row.label}</dt>
                <dd className="min-w-0 break-all text-right font-mono text-[11px] text-ivory-950">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {pop.sections.map((s) => {
          return (
            <div key={s.key} className="mb-2 last:mb-0">
              <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                {s.viaLabel} · {s.rows.length}{s.exhausted ? "" : "+"}
              </p>
              <SectionRows
                rows={s.rows}
                selectedId={pop.selectedId}
                onSelectRow={(id) => onSelectRecord(s.childApi, id)}
                onEditRow={(id) => onEditRecord(s.childApi, id)}
              />
              {!s.exhausted && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1 w-full"
                  disabled={s.loadingMore}
                  onClick={() => onLoadMore(s.key)}
                >
                  {s.loadingMore ? "Loading…" : "Load 10 more"}
                </Button>
              )}
            </div>
          );
        })}
        {!pop.loading && !pop.error && !pop.blockedHint && !pop.single && pop.sections.length === 0 && (
          <p className="px-1 py-2 text-[11px] text-ivory-600">No rows returned for this node.</p>
        )}
      </div>
      <div className="flex gap-1.5 p-2">
        <Button
          size="sm"
          className="flex-1"
          onClick={onClear}
          title="Forget this node's loaded records only. The root record Id you typed stays saved in the Record Walk box, so fetching again is one click."
        >
          Drop {pop.nodeLabel} data · root Id stays
        </Button>
      </div>
      {gridOpen && pop.tableRows.length > 0 && (
        <RecordGridModal
          apiName={pop.apiName}
          nodeLabel={pop.nodeLabel}
          rows={pop.tableRows}
          groups={pop.tableGroups}
          requiredFields={pop.requiredFields}
          onClose={() => setGridOpen(false)}
          onEditRecord={onEditRecord}
        />
      )}
    </div>
  );
}
