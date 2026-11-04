"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "../ui/Button";
import { InventoryAside } from "../ui/InventoryAside";
import { RichTextEditor } from "./RichTextEditor";
import { WordImportButton } from "./WordImportButton";
import type { DocxImport } from "@/lib/notes/docxImport";
import { findDeepRecord, syncDeepParam, useDeepParam } from "@/lib/deep/deep";
import { DeepLinkButton } from "../ui/DeepLinkButton";
import { CONSOLE_STATUSES, CONSOLE_STATUS_LABELS } from "@/lib/console/model";
import { noteDocxFilename, noteToDocxBlob } from "@/lib/notes/docxExport";
import {
  bodyToStdNote,
  deleteStdNote,
  listStdNotes,
  newStdNote,
  saveStdNote,
  stdNoteToBody,
  type StdNote,
} from "@/lib/notes/standalone";
import { commitNoteBody } from "@/lib/notes/notebody";

/**
 * Standalone Notes manager: general discussion notes with their own
 * lifecycle. Left inventory (search + status), right full rich editor,
 * Word export per note. Console sees every note as a linkable view.
 */
export function NotesRoute() {
  const [notes, setNotes] = useState<StdNote[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const all = await listStdNotes();
    setNotes(all);
    setLoaded(true);
    return all;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deepId = useDeepParam("id");
  const deepDone = useRef(false);
  useEffect(() => {
    if (deepDone.current || !loaded || deepId === null) return;
    const hit = findDeepRecord(notes, deepId);
    if (hit) {
      setActiveId(hit.id);
      deepDone.current = true;
    }
  }, [loaded, deepId, notes]);

  // Keep the URL on the open note so it survives reloads and pastes.
  useEffect(() => {
    if (!loaded) return;
    syncDeepParam("id", activeId);
  }, [loaded, activeId]);

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return notes;
    return notes.filter((n) => `${n.title} ${n.body ?? ""}`.toLowerCase().includes(query));
  }, [notes, q]);

  const active = notes.find((n) => n.id === activeId) ?? null;
  const activeBody = active ? stdNoteToBody(active) : null;

  const create = useCallback(async () => {
    const note = newStdNote("Untitled note");
    await saveStdNote(note);
    const all = await refresh();
    setActiveId(all.some((n) => n.id === note.id) ? note.id : (all[0]?.id ?? null));
    setConfirmDelete(false);
  }, [refresh]);

  /** Word import becomes its own note, titled from the file name. */
  const importWord = useCallback(
    async (imp: DocxImport) => {
      const note = { ...newStdNote(imp.title), ...bodyToStdNote(imp.body), status: "open" as const };
      await saveStdNote(note);
      const all = await refresh();
      setActiveId(all.some((n) => n.id === note.id) ? note.id : (all[0]?.id ?? null));
      setConfirmDelete(false);
      if (imp.warnings.length > 0) {
        setNotice(`${imp.warnings.length} element${imp.warnings.length === 1 ? "" : "s"} did not survive - ${imp.warnings[0]}`);
      }
    },
    [refresh],
  );

  const patch = useCallback(
    async (id: string, p: Partial<StdNote>) => {
      const cur = notes.find((n) => n.id === id);
      if (!cur) return;
      const next = { ...cur, ...p };
      setNotes((prev) => prev.map((n) => (n.id === id ? next : n)).sort((a, b) => b.updatedAt - a.updatedAt));
      await saveStdNote(next);
    },
    [notes],
  );

  const onBody = useCallback(
    (html: string) => {
      if (!active || !activeBody) return;
      void patch(active.id, bodyToStdNote(commitNoteBody(activeBody, "rich", html)));
    },
    [active, activeBody, patch],
  );

  const remove = useCallback(async () => {
    if (!active) return;
    await deleteStdNote(active.id);
    setNotes((prev) => prev.filter((n) => n.id !== active.id));
    setActiveId(null);
    setConfirmDelete(false);
  }, [active]);

  const exportWord = useCallback(async () => {
    if (!active || exporting) return;
    setExporting(true);
    try {
      const blob = await noteToDocxBlob(active.title, [`Status ${CONSOLE_STATUS_LABELS[active.status]}`, `Updated ${new Date(active.updatedAt).toLocaleString()}`], stdNoteToBody(active));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = noteDocxFilename(active.title);
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [active, exporting]);

  return (
    <div className="grid min-h-0 flex-1 items-stretch gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
      <InventoryAside
        fill
        title="Notes"
        count={notes.length}
        query={q}
        onQuery={setQ}
        searchLabel="Search notes…"
        onNew={() => void create()}
        newTitle="Start a new note"
        zeroTitle="No notes yet"
        zeroLines={[
          "Log the discussion while it happens.",
          "Full rich editor - color, align, highlights.",
          "Track open → resolved lifecycle per note.",
          "Export any note to Word for the team.",
          "Everything surfaces in Console too.",
        ]}
      >
        <ul className="space-y-1.5">
          {shown.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => {
                  setActiveId(n.id);
                  setConfirmDelete(false);
                }}
                aria-current={n.id === activeId}
                className={`w-full cursor-pointer rounded-xl border px-3 py-2 text-left ${
                  n.id === activeId ? "border-[#211F1B] bg-[#FAF8F2]" : "border-[#F0EBE0] hover:border-[#A98450]"
                }`}
              >
                <span className="block truncate text-[13px] font-semibold text-[#27241F]">{n.title}</span>
                <span className="block font-mono text-[10px] text-[#A39B8E]">
                  {CONSOLE_STATUS_LABELS[n.status]} · {new Date(n.updatedAt).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
          {loaded && notes.length > 0 && shown.length === 0 && (
            <li className="rounded-xl border border-dashed border-[#E8E2D8] p-4 text-center text-[12px] text-[#A39B8E]">
              No notes match &ldquo;{q.trim()}&rdquo;.
            </li>
          )}
        </ul>
      </InventoryAside>

      <div className="flex min-h-0 min-w-0 flex-col">
        {!active ? (
          <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-[#E8E2D8] bg-white p-8 text-center">
            <svg width="220" height="120" viewBox="0 0 220 120" fill="none" aria-hidden="true" className="mx-auto h-auto w-[220px]">
              <rect x="78" y="14" width="64" height="80" rx="8" fill="#FAF8F2" stroke="#722F37" strokeWidth="2" />
              <line x1="90" y1="34" x2="130" y2="34" stroke="#722F37" strokeWidth="4" strokeLinecap="round" />
              <line x1="90" y1="48" x2="130" y2="48" stroke="#C9A86A" strokeWidth="4" strokeLinecap="round" />
              <line x1="90" y1="62" x2="118" y2="62" stroke="#C9A86A" strokeWidth="4" strokeLinecap="round" />
              <line x1="90" y1="76" x2="124" y2="76" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
              <line x1="142" y1="40" x2="172" y2="28" stroke="#A98450" strokeWidth="1.5" strokeDasharray="3 3" />
              <line x1="142" y1="68" x2="172" y2="82" stroke="#A98450" strokeWidth="1.5" strokeDasharray="3 3" />
              <line x1="78" y1="60" x2="48" y2="40" stroke="#A98450" strokeWidth="1.5" strokeDasharray="3 3" />
              <line x1="78" y1="72" x2="48" y2="88" stroke="#A98450" strokeWidth="1.5" strokeDasharray="3 3" />
              <circle cx="178" cy="26" r="7" fill="#4E342E" />
              <text x="178" y="30" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#F4EAD6" fontFamily="monospace">T</text>
              <circle cx="178" cy="84" r="7" fill="#722F37" />
              <text x="178" y="88" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#F4EAD6" fontFamily="monospace">D</text>
              <circle cx="42" cy="38" r="7" fill="#FFFFFF" stroke="#C9A86A" strokeWidth="1.5" />
              <text x="42" y="42" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#A98450" fontFamily="monospace">?</text>
              <circle cx="42" cy="90" r="7" fill="#FFFFFF" stroke="#C9A86A" strokeWidth="1.5" />
              <text x="42" y="94" textAnchor="middle" fontSize="9" fontWeight="bold" fill="#A98450" fontFamily="monospace">✓</text>
            </svg>
            <p className="mt-3 text-[15px] font-semibold text-[#27241F]">General notes, architect-grade</p>
            <p className="mt-1 max-w-[420px] text-[12px] leading-relaxed text-[#777168]">
              Meeting notes, hallway decisions, review threads - everything that is not a canvas TODO gets a full editor, a lifecycle, Word export, and a Console trail.
            </p>
            <div className="mt-4">
              <Button onClick={() => void create()}>Start the first note</Button>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-1 flex-col rounded-xl border border-[#E8E2D8] bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-[#F0EBE0] px-4 py-3">
              <input
                value={active.title}
                onChange={(e) => void patch(active.id, { title: e.target.value.slice(0, 160) || "Untitled note" })}
                aria-label="Note title"
                spellCheck={false}
                placeholder="Note title…"
                className="min-w-0 flex-1 bg-transparent text-[16px] font-semibold text-[#27241F] placeholder-[#A39B8E] focus:outline-none"
              />
              <label className="flex items-center gap-1.5 text-[12px] font-semibold text-[#777168]">
                Status
                <select
                  value={active.status}
                  onChange={(e) => void patch(active.id, { status: e.target.value as StdNote["status"] })}
                  aria-label="Note status"
                  className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1 text-[12px] font-semibold text-[#27241F] focus:border-[#A98450] focus:outline-none"
                >
                  {CONSOLE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {CONSOLE_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="sm" variant="ghost" onClick={() => void exportWord()} disabled={exporting} title="Export this note as Word (.docx)">
                {exporting ? "Exporting…" : "Export Word"}
              </Button>
              {active && <DeepLinkButton path="/notes" param="id" value={active.id} />}
              <WordImportButton onImport={(imp) => void importWord(imp)} onError={setNotice} />
              {notice && (
                <span role="status" className="max-w-[260px] truncate text-[11px] text-[#9A5B13]" title={notice}>
                  {notice}
                </span>
              )}
              {confirmDelete ? (
                <span className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Keep
                  </Button>
                  <Button size="sm" onClick={() => void remove()}>
                    Delete note
                  </Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} title="Delete this note">
                  Delete
                </Button>
              )}
            </div>
            <div className="flex min-h-0 flex-1 flex-col p-3">
              <RichTextEditor
                key={active.id}
                value={activeBody && activeBody.format === "rich" ? activeBody.html : (activeBody?.md ?? "")}
                label={`Note: ${active.title}`}
                fill
                onDone={onBody}
              />
              <p className="mt-2 font-mono text-[10px] text-[#A39B8E]">
                Updated {new Date(active.updatedAt).toLocaleString()} · autosaved to this browser · visible in Console
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
