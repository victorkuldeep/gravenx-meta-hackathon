"use client";

import { useEffect, useMemo, useState } from "react";
import { NoteEditor } from "../notes/NoteEditor";
import { WordImportButton } from "../notes/WordImportButton";
import type { DocxImport } from "@/lib/notes/docxImport";
import { renderMarkdownLite } from "./notesMd";
import { todoBodyToNote, todayIso, type CanvasTodo, type CanvasTodoStatus, type InboxAnchor, type InboxItemKind } from "@/lib/inbox/types";
import { commitNoteBody, type NoteBody } from "@/lib/notes/notebody";

export const ENTRY_KINDS: { id: InboxItemKind; label: string }[] = [
  { id: "task", label: "Task" },
  { id: "question", label: "Question" },
  { id: "note", label: "Note" },
  { id: "decision", label: "Decision" },
];

const ENTRY_STATUSES: { id: CanvasTodoStatus; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "in-progress", label: "In progress" },
  { id: "blocked", label: "Blocked" },
  { id: "awaiting-feedback", label: "Awaiting feedback" },
  { id: "done", label: "Done" },
];

const KIND_PILL: Record<InboxItemKind, string> = {
  note: "bg-[#F0EBE0] text-[#777168]",
  task: "bg-[#F5EEDF] text-[#8A6A2F]",
  question: "bg-[#EBF2E6] text-[#3E6B34]",
  decision: "bg-[#ECEAF6] text-[#4E4494]",
};

function rowTitle(e: CanvasTodo, fallback: string): string {
  const t = e.title.trim();
  if (t) return t;
  const line =
    (e.body ?? "")
      .split("\n")
      .map((l) => l.trim().replace(/^#{1,3}\s+|^[-*]\s+(\[[ xX]\]\s+)?|^\d+[.)]\s+/, ""))
      .find((l) => l.length > 0) ?? "";
  return line || fallback;
}

function timeAgo(n: number): string {
  const s = Math.max(0, Math.floor((Date.now() - n) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const selectCls =
  "mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-1 text-xs font-medium normal-case tracking-normal text-ivory-950 cursor-pointer";
const inputCls =
  "mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-1 text-xs normal-case tracking-normal text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none";
const labelCls = "block text-[10px] font-semibold uppercase tracking-wider text-ivory-600";

/** Identity + lifecycle in one compact top block - the editor owns the rest. */
function EntryTop({
  apiName,
  entry,
  fields,
  onPatch,
  onAnchor,
  onDelete,
  hideAnchor,
}: {
  apiName: string;
  entry: CanvasTodo;
  fields: { name: string; label: string; type: string; referenceTo: string[] }[];
  onPatch: (patch: Partial<CanvasTodo>, what: string) => void;
  onAnchor: (anchor: InboxAnchor | null) => void;
  onDelete: () => void;
  /** Canvas scope has no Salesforce object - the Anchor control hides. */
  hideAnchor?: boolean;
}) {
  const kind = entry.kind ?? "task";
  const anchorId = entry.anchor?.id ?? apiName;
  const fieldOf = (name: string) => fields.find((f) => f.name === name);
  return (
    <div className="shrink-0">
      <div className="mb-2 flex items-center gap-2">
        <input
          value={entry.title}
          onChange={(e) => onPatch({ title: e.target.value.slice(0, 160) }, "Title updated")}
          placeholder={`${kind === "task" ? "Task" : kind === "question" ? "Question" : kind === "decision" ? "Decision" : "Note"} title…`}
          aria-label="Entry title"
          spellCheck={false}
          className="w-full min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-1.5 text-[14px] font-semibold text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={onDelete}
          title="Delete entry"
          aria-label="Delete entry"
          className="shrink-0 cursor-pointer rounded-md p-1.5 text-ivory-500 hover:bg-red-500/10 hover:text-red-700 transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div className={`mb-2 grid gap-1.5 ${kind === "decision" ? "grid-cols-4" : "grid-cols-3"}`}>
        <label className={hideAnchor ? `${labelCls} col-span-2` : labelCls}>
          Kind
          <select
            value={kind}
            onChange={(e) => onPatch({ kind: e.target.value as InboxItemKind }, `Kind set to ${e.target.value}`)}
            className={selectCls}
          >
            {ENTRY_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        {!hideAnchor && (
        <label className={labelCls}>
          Anchor
          <select
            value={anchorId}
            onChange={(e) => {
              const v = e.target.value;
              if (v === apiName) {
                onAnchor(null);
                return;
              }
              const f = fieldOf(v);
              onAnchor({
                type: f && f.type === "reference" ? "relationship" : "field",
                id: `${apiName}.${v}`,
                labelAtCreation: f?.label,
              });
            }}
            title="Anchor this entry to the object or one of its fields"
            className={selectCls}
          >
            <option value={apiName}>{apiName} (object)</option>
            {fields.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
                {f.type === "reference" ? " ⤴" : ""}
              </option>
            ))}
          </select>
        </label>
        )}
        <label className={labelCls}>
          Team
          <input
            value={entry.team ?? ""}
            onChange={(e) => onPatch({ team: e.target.value.trim() || undefined }, e.target.value.trim() ? `Team set to ${e.target.value.trim()}` : "Team cleared")}
            placeholder="Enter team name…"
            spellCheck={false}
            className={inputCls}
          />
        </label>
        {kind === "decision" && (
          <label className={labelCls}>
            Decision
            <select
              value={entry.decisionState ?? "proposed"}
              onChange={(e) => onPatch({ decisionState: e.target.value as CanvasTodo["decisionState"] }, `Decision ${e.target.value}`)}
              className={selectCls}
            >
              <option value="proposed">Proposed</option>
              <option value="confirmed">Confirmed</option>
              <option value="rejected">Rejected</option>
              <option value="superseded">Superseded</option>
            </select>
          </label>
        )}
      </div>
      <div className="mb-2 grid grid-cols-3 gap-1.5">
        <label className={labelCls}>
          Status
          <select
            value={entry.status}
            onChange={(e) => onPatch({ status: e.target.value as CanvasTodoStatus }, `Status set to ${e.target.value}`)}
            className={selectCls}
          >
            {ENTRY_STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelCls}>
          Owner
          <input
            value={entry.owner ?? entry.assignee ?? ""}
            onChange={(e) => {
              const v = e.target.value.trim() || undefined;
              onPatch({ owner: v, assignee: v }, v ? `Owner set to ${v}` : "Owner cleared");
            }}
            placeholder="Enter owner…"
            spellCheck={false}
            className={inputCls}
          />
        </label>
        <label className={labelCls}>
          Due
          <input
            type="date"
            value={entry.dueDate ?? ""}
            min={todayIso()}
            onChange={(e) => onPatch({ dueDate: e.target.value || undefined }, e.target.value ? `Due date set to ${e.target.value}` : "Due date cleared")}
            className={`${selectCls} cursor-pointer`}
          />
        </label>
      </div>
      {(entry.status === "done" || kind === "question" || kind === "decision") && (
        <label className={`${labelCls} mb-2`}>
          {kind === "question" ? "Answer / resolution" : "Resolution"}
          <textarea
            value={entry.resolution ?? ""}
            onChange={(e) => onPatch({ resolution: e.target.value || undefined }, "Resolution updated")}
            placeholder="Describe the outcome…"
            spellCheck={false}
            rows={2}
            className="mt-0.5 w-full resize-y rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-1.5 text-xs normal-case tracking-normal text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
          />
        </label>
      )}
    </div>
  );
}


/**
 * Per-entity log as one large standard modal: entries list left, editor
 * taking the full center space, lifecycle metadata in a collapsible right
 * sidebar. New-entry kind is a dropdown, not a button row.
 */
export function EntityLogModal({
  apiName,
  label,
  rows,
  fields,
  initialSelectedId,
  onClose,
  onNew,
  onDelete,
  onBody,
  onToggleTask,
  onPatch,
  onAnchor,
  hideAnchor,
}: {
  apiName: string;
  label: string;
  rows: CanvasTodo[];
  fields: { name: string; label: string; type: string; referenceTo: string[] }[];
  hideAnchor?: boolean;
  initialSelectedId: string | null;
  onClose: () => void;
  onNew: (kind: InboxItemKind) => string;
  onDelete: (id: string) => void;
  onBody: (id: string, b: NoteBody) => void;
  onToggleTask: (id: string, lineIndex: number) => void;
  onPatch: (id: string, patch: Partial<CanvasTodo>, what: string) => void;
  onAnchor: (id: string, anchor: InboxAnchor | null) => void;
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.updatedAt - a.updatedAt), [rows]);
  const kindsPresent = useMemo(() => {
    const s = new Set<InboxItemKind>();
    for (const r of rows) s.add(r.kind ?? "task");
    return ENTRY_KINDS.filter((k) => s.has(k.id));
  }, [rows]);
  const [kindFilter, setKindFilter] = useState<InboxItemKind | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(
    () => (initialSelectedId && rows.some((r) => r.id === initialSelectedId) ? initialSelectedId : (sorted[0]?.id ?? null)),
  );
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "title">("newest");
  const [listOpen, setListOpen] = useState(true);
  const [topOpen, setTopOpen] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A selected row deleted elsewhere (Console sync) falls back to recency.
  useEffect(() => {
    if (selectedId && !rows.some((r) => r.id === selectedId)) {
      setSelectedId(sorted[0]?.id ?? null);
    }
  }, [rows, selectedId, sorted]);

  const ordered = useMemo(() => {
    const list = [...sorted];
    if (sort === "oldest") list.sort((a, b) => a.updatedAt - b.updatedAt);
    else if (sort === "title") list.sort((a, b) => rowTitle(a, apiName).localeCompare(rowTitle(b, apiName)));
    return list;
  }, [sorted, sort, apiName]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ordered.filter((r) => {
      if (kindFilter !== "all" && (r.kind ?? "task") !== kindFilter) return false;
      if (!q) return true;
      const hay = `${rowTitle(r, apiName)} ${r.body ?? ""} ${r.status} ${r.owner ?? r.assignee ?? ""} ${r.kind ?? "task"}`.toLowerCase();
      return hay.includes(q);
    });
  }, [ordered, kindFilter, query, apiName]);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const draft = useMemo<NoteBody | null>(
    () => (selected ? todoBodyToNote({ body: selected.body, bodyFormat: selected.bodyFormat, bodyHtml: selected.bodyHtml }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected?.body, selected?.bodyFormat, selected?.bodyHtml],
  );

  const createEntry = (kind: InboxItemKind) => {
    const id = onNew(kind);
    setKindFilter("all");
    setSelectedId(id);
    setTopOpen(true);
  };

  /** Word import appends to the selected entry - existing content stays on top. */
  const importWord = (imp: DocxImport) => {
    if (!selected || !draft) return;
    onBody(selected.id, commitNoteBody(draft, "md", [draft.md, imp.body.md].filter((s) => s.trim()).join("\n\n")));
    if (imp.warnings.length > 0) {
      setNotice(`${imp.warnings.length} element${imp.warnings.length === 1 ? "" : "s"} did not survive - ${imp.warnings[0]}`);
    }
  };

  const exportSelected = async () => {
    if (!selected || exporting) return;
    setExporting(true);
    try {
      const { entryToDocxBlob, entryDocxFilename } = await import("@/lib/notes/docxExport");
      const blob = await entryToDocxBlob(apiName, label, selected);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = entryDocxFilename(apiName, selected);
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ivory-950/40 p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`${label} log`}
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-line-soft)] px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold text-ivory-950">{label} · Log</h2>
            <p className="truncate font-mono text-[10px] text-ivory-600">
              {apiName} · {rows.length} {rows.length === 1 ? "entry" : "entries"}
            </p>
          </div>
          <label className="sr-only" htmlFor="entity-log-new">
            Log a new entry
          </label>
          <select
            id="entity-log-new"
            value=""
            onChange={(e) => {
              if (e.target.value) createEntry(e.target.value as InboxItemKind);
            }}
            title={`Log a note, task, question or decision on ${apiName}`}
            className="cursor-pointer rounded-lg bg-ivory-950 px-2.5 py-1 text-xs font-semibold text-ivory-100 hover:bg-bronze-600 transition-colors"
          >
            <option value="">+ Log…</option>
            {ENTRY_KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-ivory-950 px-3 py-1.5 text-[11px] font-semibold text-ivory-100 hover:bg-bronze-600 transition-colors cursor-pointer"
          >
            Done
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close log"
            title="Close log"
            className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {listOpen ? (
            <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--color-line-soft)]" aria-label="Log entries">
              <div className="shrink-0 space-y-1.5 border-b border-[var(--color-line-soft)] p-2.5">
                <div className="flex items-center gap-1.5">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search entries…"
                    aria-label="Search entries"
                    spellCheck={false}
                    className="w-full min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-xs text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setListOpen(false)}
                    aria-label="Collapse entries list"
                    title="Collapse entries list"
                    className="shrink-0 cursor-pointer rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                      <path d="m14 6-6 6 6 6" />
                    </svg>
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="sr-only" htmlFor="entity-log-filter">
                    Filter entries by kind
                  </label>
                  <select
                    id="entity-log-filter"
                    value={kindFilter}
                    onChange={(e) => setKindFilter(e.target.value as InboxItemKind | "all")}
                    title="Filter entries by kind"
                    className="w-full min-w-0 flex-1 cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-1 text-xs font-medium text-ivory-950"
                  >
                    <option value="all">All · {rows.length}</option>
                    {kindsPresent.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label} · {rows.filter((r) => (r.kind ?? "task") === k.id).length}
                      </option>
                    ))}
                  </select>
                  <label className="sr-only" htmlFor="entity-log-sort">
                    Sort entries
                  </label>
                  <select
                    id="entity-log-sort"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as "newest" | "oldest" | "title")}
                    title="Sort entries"
                    className="shrink-0 cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-1 text-xs font-medium text-ivory-950"
                  >
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="title">Title</option>
                  </select>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
                {visible.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[var(--color-line)] px-3 py-4 text-center text-[12px] text-ivory-500">
                    {rows.length === 0 ? "No entries yet — pick a kind from + Log… above." : "Nothing matches — clear the search or filter."}
                  </p>
                ) : (
                  <ul className="space-y-1">
                {visible.map((r) => {
                  const active = r.id === selected?.id;
                  return (
                    <li key={r.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedId(r.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") setSelectedId(r.id);
                        }}
                        aria-pressed={active}
                        className={`flex w-full cursor-pointer items-center gap-1.5 rounded-xl border px-2 py-1.5 text-left transition-colors ${
                          active ? "border-[#C9A86A] bg-[#FAF3E3]" : "border-[#F0EBE0] bg-white hover:border-[#E0D5BE]"
                        }`}
                      >
                        <span className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${KIND_PILL[r.kind ?? "task"]}`}>
                          {(r.kind ?? "task").slice(0, 4)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-semibold text-[#27241F]">{rowTitle(r, apiName)}</span>
                          <span className="block truncate font-mono text-[10px] text-[#A39B8E]">
                            {r.status}
                            {(r.owner ?? r.assignee) ? ` · ${r.owner ?? r.assignee}` : ""}
                            {r.dueDate ? ` · ${r.dueDate}` : ""} · {timeAgo(r.updatedAt)}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(r.id);
                          }}
                          aria-label={`Delete ${rowTitle(r, apiName)}`}
                          title="Delete entry"
                          className="shrink-0 cursor-pointer rounded p-1 text-[#C9BFAE] hover:bg-red-500/10 hover:text-red-700"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                            <path d="M6 6l12 12M18 6 6 18" />
                          </svg>
                        </button>
                      </div>
                    </li>
                  );
                })}
                  </ul>
                )}
              </div>
            </aside>
          ) : (
            <div className="flex w-9 shrink-0 items-start justify-center border-r border-[var(--color-line-soft)] pt-3">
              <button
                type="button"
                onClick={() => setListOpen(true)}
                aria-label="Expand entries list"
                title="Show entries list"
                className="cursor-pointer rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors"
              >
                <span className="[writing-mode:vertical-rl] text-[10px] font-bold uppercase tracking-wider">
                  Entries · {rows.length}
                </span>
              </button>
            </div>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col p-4">
            {selected && draft ? (
              <>
                <div className="mb-1.5 flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setTopOpen((v) => !v)}
                    aria-expanded={topOpen}
                    title={topOpen ? "Collapse title and details" : "Expand title and details"}
                    className="flex w-full min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-lg px-1 py-0.5 text-left hover:bg-ivory-300/60 transition-colors"
                  >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    aria-hidden="true"
                    className={`shrink-0 text-ivory-500 transition-transform ${topOpen ? "" : "-rotate-90"}`}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                  <span className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${KIND_PILL[selected.kind ?? "task"]}`}>
                    {(selected.kind ?? "task").slice(0, 4)}
                  </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#27241F]">
                      {selected.title.trim() || "Untitled entry"}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-[#A39B8E]">{selected.status}</span>
                  </button>
                  <button
                    type="button"
                    onClick={exportSelected}
                    disabled={exporting}
                    title="Export this entry as a Word document (.docx)"
                    aria-label="Export entry as Word document"
                    className="shrink-0 cursor-pointer rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors disabled:opacity-50"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                      <path d="M12 4v11m0 0 4-4m-4 4-4-4" />
                      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                    </svg>
                  </button>
                  <WordImportButton label="Import" onImport={importWord} onError={setNotice} />
                </div>
                {notice && (
                  <p role="status" className="mb-1.5 shrink-0 truncate rounded-lg border border-[#E0C491] bg-[#F3EADB] px-2.5 py-1 text-[11px] text-[#9A5B13]" title={notice}>
                    {notice}
                  </p>
                )}
                {topOpen && (
                  <EntryTop
                    apiName={apiName}
                    entry={selected}
                    fields={fields}
                    hideAnchor={hideAnchor}
                    onPatch={(patch, what) => onPatch(selected.id, patch, what)}
                    onAnchor={(anchor) => onAnchor(selected.id, anchor)}
                    onDelete={() => onDelete(selected.id)}
                  />
                )}
                <div className="flex min-h-0 flex-1 flex-col">
                  <NoteEditor
                    draft={draft}
                    onDraft={(b) => onBody(selected.id, b)}
                    label={`Entry · ${apiName}`}
                    placeholder={`Describe it in Rich text or Markdown…\n- [ ] Verify lookup before demo`}
                    textareaRows={10}
                    renderPreview={(md) => renderMarkdownLite(md, (idx) => onToggleTask(selected.id, idx))}
                    fill
                  />
                </div>
              </>
            ) : (
              <p className="rounded-xl border border-dashed border-[var(--color-line)] px-3 py-8 text-center text-[12px] text-ivory-500">
                {rows.length === 0
                  ? "Nothing logged yet — pick a kind from + Log… to start."
                  : "Select an entry on the left to read and edit it."}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
