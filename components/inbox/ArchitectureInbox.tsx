"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import { renderMarkdownLite, toggleTaskLine } from "../erd/notesMd";
import { NoteEditor } from "../notes/NoteEditor";
import { RichBody } from "../notes/RichBody";
import { firstLine, queryInbox, countInbox } from "@/lib/inbox/normalize";
import { compileActionPack } from "@/lib/inbox/actionPack";
import {
  inboxBodyToNote,
  type ArchitectureInboxItem,
  type InboxItemKind,
  type InboxMeta,
  type InboxStatus,
} from "@/lib/inbox/types";
import { commitNoteBody, emptyNoteBody, type NoteBody } from "@/lib/notes/notebody";

export interface InboxCanvas {
  id: string;
  name: string;
}

interface ArchitectureInboxProps {
  open: boolean;
  onClose: () => void;
  orgLabel: string;
  items: ArchitectureInboxItem[];
  canvases: InboxCanvas[];
  onEditBody: (id: string, b: NoteBody) => void;
  onSetTaskDone: (id: string, done: boolean) => void;
  onDelete: (id: string) => void;
  onNavigate: (item: ArchitectureInboxItem) => void;
  onUpdateMeta: (id: string, patch: Partial<InboxMeta>, what: string) => void;
  getAnchorReview: (item: ArchitectureInboxItem) => AnchorReview | null;
  onAcceptAnchor: (id: string) => void;
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function KindPill({ kind }: { kind: InboxItemKind }) {
  const cls =
    kind === "task"
      ? "bg-ivory-950 text-ivory-100"
      : kind === "question"
        ? "bg-amber-100 text-amber-800 border-amber-300"
        : kind === "decision"
          ? "bg-green-100 text-green-800 border-green-300"
          : "bg-[var(--color-canvas)] text-ivory-700 border-[var(--color-line)]";
  return (
    <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-bold capitalize ${cls}`}>
      {kind}
    </span>
  );
}

function StatusPill({ status }: { status: InboxStatus }) {  const cls =
    status === "resolved"
      ? "bg-green-100 text-green-800 border-green-300"
      : status === "in-progress"
        ? "bg-amber-100 text-amber-800 border-amber-300"
        : status === "blocked"
          ? "bg-red-100 text-red-800 border-red-300"
          : status === "awaiting-feedback"
            ? "bg-violet-100 text-violet-800 border-violet-300"
            : "bg-[var(--color-canvas)] text-ivory-700 border-[var(--color-line)]";
  return (
    <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-semibold capitalize ${cls}`}>
      {status}
    </span>
  );
}

export interface AnchorReview {
  diffs: string[];
  liveAvailable: boolean;
}

function ReviewBox({
  item,
  review,
  onAccept,
  onClose,
}: {
  item: ArchitectureInboxItem;
  review: AnchorReview | null;
  onAccept: () => void;
  onClose: () => void;
}) {
  if (!review) {
    return <p className="text-[11px] text-ivory-600">Canvas anchors need no schema review.</p>;
  }
  if (!review.liveAvailable) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5">
        <p className="text-[11px] leading-relaxed text-red-800">
          <span className="font-mono font-semibold">{item.anchor.id}</span> is missing from the
          live schema. The note is preserved - navigate to the canvas for context, never auto-remapped.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-1 text-[11px] font-semibold text-ivory-700 hover:text-ivory-950 underline cursor-pointer"
        >
          Dismiss
        </button>
      </div>
    );
  }
  if (review.diffs.length === 0) {
    return (
      <div className="rounded-lg border border-green-300 bg-green-50 px-2 py-1.5">
        <p className="text-[11px] text-green-800">Anchor matches the live schema - nothing changed.</p>
        <div className="mt-1 flex gap-2">
          <button
            type="button"
            onClick={onAccept}
            className="text-[11px] font-semibold text-green-800 hover:text-green-900 underline cursor-pointer"
          >
            Mark reviewed
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-ivory-600 hover:text-ivory-950 underline cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-amber-800">Changed since capture</p>
      <ul className="mt-1 space-y-0.5">
        {review.diffs.map((d) => (
          <li key={d} className="text-[11px] text-amber-900">· {d}</li>
        ))}
      </ul>
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          onClick={onAccept}
          title="Accept the live schema as the new baseline - explicit architect action"
          className="text-[11px] font-semibold text-amber-800 hover:text-amber-900 underline cursor-pointer"
        >
          Accept new baseline
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-ivory-600 hover:text-ivory-950 underline cursor-pointer"
        >
          Later
        </button>
      </div>
    </div>
  );
}

export function ArchitectureInbox({
  open,
  onClose,
  orgLabel,
  items,
  canvases,
  onEditBody,
  onSetTaskDone,
  onDelete,
  onNavigate,
  onUpdateMeta,
  getAnchorReview,
  onAcceptAnchor,
}: ArchitectureInboxProps) {
  const [text, setText] = useState("");
  const [kinds, setKinds] = useState<InboxItemKind[]>([]);
  const [statuses, setStatuses] = useState<InboxStatus[]>([]);
  const [canvasIds, setCanvasIds] = useState<string[]>([]);
  const [staleOnly, setStaleOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NoteBody>(() => emptyNoteBody());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [packScope, setPackScope] = useState<"outstanding" | "all">("outstanding");
  const [copied, setCopied] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  const filtered = useMemo(
    () => queryInbox(items, { text, kinds, statuses, canvases: canvasIds, staleOnly }),
    [items, text, kinds, statuses, canvasIds, staleOnly]
  );
  const counts = useMemo(() => countInbox(items), [items]);
  const selected = filtered.find((i) => i.id === selectedId) ?? items.find((i) => i.id === selectedId) ?? null;

  const grouped = useMemo(() => {
    const map = new Map<string, ArchitectureInboxItem[]>();
    for (const item of filtered) {
      if (!map.has(item.canvasId)) map.set(item.canvasId, []);
      map.get(item.canvasId)!.push(item);
    }
    return [...map.entries()].map(([canvasId, list]) => ({
      canvasId,
      name: canvases.find((c) => c.id === canvasId)?.name ?? list[0]?.canvasName ?? canvasId,
      list,
    }));
  }, [filtered, canvases]);



  const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const clearFilters = () => {
    setText("");
    setKinds([]);
    setStatuses([]);
    setCanvasIds([]);
    setStaleOnly(false);
  };
  const hasFilters = text.trim() !== "" || kinds.length > 0 || statuses.length > 0 || canvasIds.length > 0 || staleOnly;

  const pack = useMemo(
    () => compileActionPack(filtered, { scope: packScope, orgLabel }),
    [filtered, packScope, orgLabel]
  );

  if (!open) return null;

  const startEdit = () => {
    if (!selected) return;
    setDraft(inboxBodyToNote(selected));
    setEditing(true);
    setConfirmDelete(false);
  };

  const saveEdit = () => {
    if (!selected) return;
    onEditBody(selected.id, draft);
    setEditing(false);
  };

  const doDelete = () => {
    if (!selected) return;
    onDelete(selected.id);
    setSelectedId(null);
    setEditing(false);
    setConfirmDelete(false);
  };

  const closeReader = () => {
    setSelectedId(null);
    setEditing(false);
    setConfirmDelete(false);
    setReviewOpen(false);
  };

  return (
    <div className="modal-overlay modal-notes" role="dialog" aria-modal="true" aria-labelledby="inbox-title" onClick={onClose}>
      <div className="modal-card flex min-h-0 flex-col" style={{ height: "calc(100dvh - 40px)" }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)] shrink-0">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
              {orgLabel} · {counts.total} item{counts.total === 1 ? "" : "s"}
            </p>
            <h2 id="inbox-title" className="mt-1 text-lg font-bold text-ivory-950">
              Architecture Inbox
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" onClick={() => setPackOpen(true)} title="Preview and download the Markdown Action Pack">
              Compile Action Pack
            </Button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Architecture Inbox"
              className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Summary strip - clickable filters */}
        <div className="flex flex-wrap gap-1.5 px-6 pt-3 shrink-0">
          <button
            type="button"
            onClick={() => setStatuses((s) => (s.length === 1 && s[0] === "open" ? [] : ["open"]))}
            title="Show open items"
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${statuses.length === 1 && statuses[0] === "open" ? "bg-ivory-950 text-ivory-100 border-ivory-950" : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-700 hover:border-[var(--color-accent)]"}`}
          >
            Open · {counts.open}
          </button>
          <button
            type="button"
            onClick={() => setKinds((k) => (k.length === 1 && k[0] === "task" ? [] : ["task"]))}
            title="Show tasks"
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${kinds.length === 1 && kinds[0] === "task" ? "bg-ivory-950 text-ivory-100 border-ivory-950" : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-700 hover:border-[var(--color-accent)]"}`}
          >
            Tasks · {counts.tasks}
          </button>
          <button
            type="button"
            onClick={() => setStaleOnly((v) => !v)}
            title="Show items whose anchor is missing from the current schema"
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${staleOnly ? "bg-red-700 text-white border-red-700" : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-700 hover:border-red-400"}`}
          >
            Stale · {counts.stale}
          </button>
          <button
            type="button"
            onClick={() => setStatuses((s) => (s.length === 1 && s[0] === "resolved" ? [] : ["resolved"]))}
            title="Show resolved items"
            className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${statuses.length === 1 && statuses[0] === "resolved" ? "bg-ivory-950 text-ivory-100 border-ivory-950" : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-700 hover:border-[var(--color-accent)]"}`}
          >
            Resolved · {counts.resolved}
          </button>
        </div>

        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-1.5 px-6 pt-2.5 shrink-0">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search title, body, API name, canvas…"
            aria-label="Search inbox"
            spellCheck={false}
            className="min-w-[180px] flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-1.5 text-xs text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
          />
          {(["note", "task", "question", "decision"] as InboxItemKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKinds((prev) => toggle(prev, k))}
              aria-pressed={kinds.includes(k)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors cursor-pointer ${kinds.includes(k) ? "bg-ivory-950 text-ivory-100 border-ivory-950" : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-600 hover:text-ivory-950"}`}
            >
              {k}s
            </button>
          ))}
          <select
            value={canvasIds[0] ?? ""}
            onChange={(e) => setCanvasIds(e.target.value ? [e.target.value] : [])}
            aria-label="Filter by canvas"
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-[11px] font-medium text-ivory-800 cursor-pointer"
          >
            <option value="">All canvases</option>
            {canvases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[11px] font-semibold text-bronze-600 hover:text-bronze-700 underline cursor-pointer"
            >
              Clear
            </button>
          )}
        </div>

        {/* List (30%) + reader (70%) */}
        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden px-6 py-3">
          <div className={selected ? "min-w-[240px] w-[30%] shrink-0 overflow-y-auto" : "min-w-0 flex-1 overflow-y-auto"}>
            {filtered.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-sm font-semibold text-ivory-950">
                  {items.length === 0 ? "No architecture notes yet" : "No matches"}
                </p>
                <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ivory-600">
                  {items.length === 0
                    ? "Notes added on ERD entities and canvases appear here, grouped by source."
                    : "Adjust the search or clear the active filters."}
                </p>
                {hasFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-2 text-xs font-semibold text-bronze-600 hover:text-bronze-700 underline cursor-pointer"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              grouped.map((g) => (
                <div key={g.canvasId} className="mb-3">
                  <p className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ivory-600">
                    {g.name}
                    <span className="font-mono font-medium text-ivory-500">
                      {g.list.filter((i) => i.status === "open").length}/{g.list.length} open
                    </span>
                  </p>
                  <ul className="space-y-1.5">
                    {g.list.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedId(item.id);
                            setEditing(false);
                            setConfirmDelete(false);
                            setReviewOpen(false);
                          }}
                          aria-current={selectedId === item.id}
                          className={`block w-full rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${selectedId === item.id ? "border-bronze-500 bg-bronze-100/40" : "border-[var(--color-line)] bg-[var(--color-surface)] hover:border-bronze-400"}`}
                        >
                          <span className="flex items-center gap-2">
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#A98450" strokeWidth="1.6" aria-hidden="true" className="shrink-0">
                              <rect x="5" y="3" width="14" height="18" rx="2.5" />
                              <line x1="9" y1="8.5" x2="15" y2="8.5" strokeLinecap="round" />
                              <line x1="9" y1="12.5" x2="15" y2="12.5" strokeLinecap="round" />
                              <line x1="9" y1="16.5" x2="13" y2="16.5" strokeLinecap="round" />
                            </svg>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-bold text-ivory-950">{item.title}</span>
                              <span className="block truncate text-[11px] text-ivory-600">{firstLine(item.body)}</span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1">
                              <span className="font-mono text-[10px] text-ivory-500">{timeAgo(item.updatedAt)}</span>
                              <span className="flex items-center gap-1">
                                <KindPill kind={item.kind} />
                                <StatusPill status={item.status} />
                                {item.stale === "missing" && (
                                  <span className="shrink-0 rounded-full border border-red-300 bg-red-50 px-1.5 py-px text-[10px] font-bold text-red-700" title="Anchor missing from the current schema - review required">
                                    Stale
                                  </span>
                                )}
                                {item.stale === "changed" && (
                                  <span className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] font-bold text-amber-800" title="Anchor changed since capture - review required">
                                    Changed
                                  </span>
                                )}
                                <span className="font-mono text-[10px] text-ivory-500">{item.anchor.id}</span>
                              </span>
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>

          {selected && (
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)]">
              <div className="border-b border-[var(--color-line-soft)] p-3">
                <div className="flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1">
                    <KindPill kind={selected.kind} />
                    <StatusPill status={selected.status} />
                    {selected.stale === "missing" && (
                      <span className="rounded-full border border-red-300 bg-red-50 px-1.5 py-px text-[10px] font-bold text-red-700">
                        Stale anchor
                      </span>
                    )}
                    <p className="min-w-0 truncate text-sm font-bold text-ivory-950">{selected.title}</p>
                  </div>
                  <p className="shrink-0 font-mono text-[10px] text-ivory-600">
                    {selected.canvasName} · {selected.anchor.id} · {timeAgo(selected.updatedAt)}
                  </p>
                </div>
                {selected.stale === "missing" && (
                  <p className="mt-1.5 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] leading-relaxed text-red-800">
                    Anchor <span className="font-mono font-semibold">{selected.anchor.id}</span> is missing
                    from the current schema. Review before acting - never auto-remapped.
                  </p>
                )}
                {selected.stale === "changed" && (
                  <p className="mt-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800">
                    Anchor <span className="font-mono font-semibold">{selected.anchor.id}</span> changed
                    since capture. Review the diff below before acting.
                  </p>
                )}
              </div>
              {/* Anchor + review (live canvas notes need neither) */}
              {selected.id !== "live-canvas" && (
              <div className="border-b border-[var(--color-line-soft)] px-3 py-2">
                <p className="font-mono text-[10px] text-ivory-600">
                  {selected.anchor.type} · {selected.anchor.id}
                  {selected.anchor.labelAtCreation && selected.anchor.labelAtCreation !== selected.anchor.id
                    ? ` (${selected.anchor.labelAtCreation})`
                    : ""}
                </p>
                {(selected.anchor.type === "entity" || selected.anchor.type === "field" || selected.anchor.type === "relationship") && (
                  <div className="mt-1.5">
                    {!reviewOpen ? (
                      <button
                        type="button"
                        onClick={() => setReviewOpen(true)}
                        className="text-[11px] font-semibold text-bronze-600 hover:text-bronze-700 underline cursor-pointer"
                      >
                        Review anchor against live schema
                      </button>
                    ) : (
                      <ReviewBox
                        item={selected}
                        review={getAnchorReview(selected)}
                        onAccept={() => {
                          onAcceptAnchor(selected.id);
                          setReviewOpen(false);
                        }}
                        onClose={() => setReviewOpen(false)}
                      />
                    )}
                  </div>
                )}
              </div>
              )}
              {/* Lifecycle */}
              {selected.id !== "live-canvas" && (
              <div className="border-b border-[var(--color-line-soft)] px-3 py-2">
                <>
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                    Kind
                    <select
                      value={selected.kind}
                      onChange={(e) => onUpdateMeta(selected.id, { kind: e.target.value as InboxItemKind }, `Kind set to ${e.target.value}`)}
                      className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-white px-1.5 py-1 text-xs font-medium normal-case tracking-normal text-ivory-950 cursor-pointer"
                    >
                      <option value="note">Note</option>
                      <option value="task">Task</option>
                      <option value="question">Question</option>
                      <option value="decision">Decision</option>
                    </select>
                  </label>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                    Status
                    <select
                      value={selected.status}
                      onChange={(e) => {
                        const v = e.target.value as InboxStatus;
                        if (selected.kind === "task" && (v === "resolved" || selected.status === "resolved")) {
                          onSetTaskDone(selected.id, v === "resolved");
                        } else {
                          onUpdateMeta(selected.id, { status: v }, `Status set to ${v}`);
                        }
                      }}
                      className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-white px-1.5 py-1 text-xs font-medium normal-case tracking-normal text-ivory-950 cursor-pointer"
                    >
                      <option value="open">Open</option>
                      <option value="in-progress">In progress</option>
                      <option value="blocked">Blocked</option>
                      <option value="awaiting-feedback">Awaiting feedback</option>
                      <option value="resolved">Resolved</option>
                    </select>
                  </label>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                    Owner
                    <input
                      value={selected.owner ?? ""}
                      onChange={(e) => onUpdateMeta(selected.id, { owner: e.target.value.trim() || undefined }, e.target.value.trim() ? `Owner set to ${e.target.value.trim()}` : "Owner cleared")}
                      placeholder="—"
                      spellCheck={false}
                      className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-white px-1.5 py-1 text-xs normal-case tracking-normal text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                    />
                  </label>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                    Team
                    <input
                      value={selected.team ?? ""}
                      onChange={(e) => onUpdateMeta(selected.id, { team: e.target.value.trim() || undefined }, e.target.value.trim() ? `Team set to ${e.target.value.trim()}` : "Team cleared")}
                      placeholder="—"
                      spellCheck={false}
                      className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-white px-1.5 py-1 text-xs normal-case tracking-normal text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                    />
                  </label>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                    Priority
                    <select
                      value={selected.priority ?? ""}
                      onChange={(e) => onUpdateMeta(selected.id, { priority: (e.target.value || undefined) as InboxMeta["priority"] }, e.target.value ? `Priority set to ${e.target.value}` : "Priority cleared")}
                      className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-white px-1.5 py-1 text-xs font-medium normal-case tracking-normal text-ivory-950 cursor-pointer"
                    >
                      <option value="">—</option>
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </label>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                    Due
                    <input
                      type="date"
                      value={selected.dueDate ?? ""}
                      onChange={(e) => onUpdateMeta(selected.id, { dueDate: e.target.value || undefined }, e.target.value ? `Due date set to ${e.target.value}` : "Due date cleared")}
                      className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-white px-1.5 py-1 text-xs normal-case tracking-normal text-ivory-950 cursor-pointer"
                    />
                  </label>
                </div>
                {selected.kind === "decision" && (
                  <label className="mt-1.5 block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                    Decision state
                    <select
                      value={selected.decisionState ?? "proposed"}
                      onChange={(e) => onUpdateMeta(selected.id, { decisionState: e.target.value as InboxMeta["decisionState"] }, `Decision ${e.target.value}`)}
                      className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-white px-1.5 py-1 text-xs font-medium normal-case tracking-normal text-ivory-950 cursor-pointer"
                    >
                      <option value="proposed">Proposed</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="rejected">Rejected</option>
                      <option value="superseded">Superseded</option>
                    </select>
                  </label>
                )}
                {(selected.status === "resolved" || selected.kind === "question" || selected.kind === "decision") && (
                  <label className="mt-1.5 block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                    {selected.kind === "question" ? "Answer / resolution" : "Resolution"}
                    <textarea
                      value={selected.resolution ?? ""}
                      onChange={(e) => onUpdateMeta(selected.id, { resolution: e.target.value || undefined }, "Resolution updated")}
                      rows={2}
                      spellCheck={false}
                      placeholder="—"
                      className="mt-0.5 w-full resize-y rounded-lg border border-[var(--color-line)] bg-white p-1.5 text-xs normal-case tracking-normal text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                    />
                  </label>
                )}
                {selected.history.length > 0 && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-[11px] font-semibold text-ivory-700 hover:text-ivory-950">
                      History ({selected.history.length})
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {[...selected.history].reverse().map((h, i) => (
                        <li key={`${h.at}-${i}`} className="text-[11px] text-ivory-700">
                          <span className="font-mono text-[10px] text-ivory-500">{timeAgo(h.at)}</span> — {h.what}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
              </div>
              )}
              <div className={editing ? "flex min-h-0 flex-1 flex-col overflow-y-auto p-3" : "min-h-0 flex-1 overflow-y-auto p-3"}>
                {editing ? (
                  <NoteEditor
                    draft={draft}
                    onDraft={setDraft}
                    label="Body"
                    textareaRows={10}
                    fill={editing}
                    renderPreview={(md) => renderMarkdownLite(md)}
                  />
                ) : selected.bodyFormat === "rich" && selected.bodyHtml?.trim() ? (
                  <div className="min-h-full rounded-lg border border-[var(--color-line)] bg-white p-2.5">
                    <RichBody html={selected.bodyHtml} compact />
                  </div>
                ) : (
                  <div className="min-h-full rounded-lg border border-[var(--color-line)] bg-white p-2.5">
                    {renderMarkdownLite(selected.body, (idx) =>
                      onEditBody(
                        selected.id,
                        commitNoteBody(inboxBodyToNote(selected), "md", toggleTaskLine(selected.body, idx)),
                      ),
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-1.5 border-t border-[var(--color-line-soft)] p-3">
                {editing ? (
                  <>
                    <span className="ml-auto flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                        Cancel
                      </Button>
                      <Button size="sm" onClick={saveEdit}>
                        Save
                      </Button>
                    </span>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="secondary" onClick={startEdit} className="flex-1">
                      Edit
                    </Button>
                    {selected.kind === "task" && selected.status !== "resolved" && (
                      <Button size="sm" onClick={() => onSetTaskDone(selected.id, true)} className="flex-1">
                        Resolve
                      </Button>
                    )}
                    {selected.status === "resolved" && selected.kind === "task" && (
                      <Button size="sm" variant="secondary" onClick={() => onSetTaskDone(selected.id, false)} className="flex-1">
                        Reopen
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => onNavigate(selected)} className="flex-1">
                      Open in ERD
                    </Button>
                    {confirmDelete ? (
                      <>
                        <Button size="sm" variant="ghost" onClick={doDelete} className="!text-red-700">
                          Confirm delete
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                        Delete
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={closeReader} title="Close the reading pane">
                      Close
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Action Pack dialog */}
        {packOpen && (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pack-title" onClick={() => setPackOpen(false)}>
            <div
              className="modal-card max-w-3xl flex flex-col"
              style={{ maxHeight: "88vh" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)] shrink-0">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
                    {pack.manifest.itemCount} items · {pack.manifest.warnings.length} warning{pack.manifest.warnings.length === 1 ? "" : "s"}
                  </p>
                  <h3 id="pack-title" className="mt-1 text-lg font-bold text-ivory-950">
                    Action Pack preview
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setPackOpen(false)}
                  aria-label="Close Action Pack preview"
                  className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer shrink-0"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-3 px-6 pt-3 shrink-0">
                <div className="flex rounded-lg border border-[var(--color-line)] overflow-hidden" role="radiogroup" aria-label="Export scope">
                  {(["outstanding", "all"] as const).map((s) => (
                    <button
                      key={s}
                      role="radio"
                      aria-checked={packScope === s}
                      onClick={() => setPackScope(s)}
                      className={`px-3 py-1.5 text-[11px] font-semibold capitalize transition-colors cursor-pointer ${packScope === s ? "bg-ivory-950 text-ivory-100" : "text-ivory-600 hover:text-ivory-950"}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <span className="font-mono text-[11px] text-ivory-600">{pack.fileName}</span>
              </div>
              {pack.manifest.warnings.length > 0 && (
                <div className="mx-6 mt-2.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800 shrink-0">
                  {pack.manifest.warnings.map((w) => (
                    <p key={w}>{w}</p>
                  ))}
                </div>
              )}
              <div className="mx-6 mt-2.5 min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--color-line)] bg-ivory-950 p-4">
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ivory-100">{pack.markdown}</pre>
              </div>
              <div className="flex gap-2 px-6 py-4 shrink-0">
                <Button
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    void (async () => {
                      try {
                        await navigator.clipboard.writeText(pack.markdown);
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1600);
                      } catch {
                        setCopied(false);
                      }
                    })();
                  }}
                >
                  {copied ? "Copied" : "Copy Markdown"}
                </Button>
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    const blob = new Blob([pack.markdown], { type: "text/markdown" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = pack.fileName;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Download .md
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
