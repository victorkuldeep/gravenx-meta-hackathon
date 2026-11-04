"use client";

import { useEffect, useState } from "react";
import Button from "../ui/Button";
import type { SequenceDocument } from "@/lib/sequence/model";
import { sequencePackage } from "@/lib/sequence/packageIo";
import { printStatements } from "@/lib/sequence/dsl";
import { toMermaid } from "@/lib/sequence/mermaid";
import { listSequenceSnapshots, saveSequence, saveSequenceSnapshot, type SequenceSnapshot } from "@/lib/sequence/store";
import { ConfirmDialog } from "../wireframe/ConfirmDialog";

function download(filename: string, text: string, mime: string) {
  try {
    const d = globalThis.document;
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = d.createElement("a");
    a.href = url;
    a.download = filename;
    d.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    /* download unavailable */
  }
}

/**
 * History + export dialog (EPIC 07): versioned snapshots with restore,
 * plus the portable package (document + DSL + Mermaid) as downloads.
 */
export function SequenceHistoryDialog({ doc, onRestored, onClose }: { doc: SequenceDocument; onRestored: () => void; onClose: () => void }) {
  const [snaps, setSnaps] = useState<SequenceSnapshot[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<SequenceSnapshot | null>(null);

  const refresh = async () => {
    setSnaps(await listSequenceSnapshots(doc.id).catch(() => []));
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  const take = async () => {
    setBusy(true);
    const version = snaps.reduce((m, s) => Math.max(m, s.version), 0) + 1;
    const ok = await saveSequenceSnapshot({
      id: `${doc.id}:v${version}`,
      sequenceId: doc.id,
      version,
      status: doc.status,
      note: note.trim().slice(0, 200),
      createdAt: Date.now(),
      payload: doc,
    }).catch(() => false);
    setBusy(false);
    if (ok) {
      setNote("");
      await refresh();
    }
  };

  const restore = async (snap: SequenceSnapshot) => {
    setPendingRestore(null);
    setBusy(true);
    const ok = await saveSequence({ ...snap.payload, id: doc.id, version: snap.version, status: snap.status }).catch(() => false);
    setBusy(false);
    if (ok) onRestored();
  };

  const slug = doc.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase().replace(/^-+|-+$/g, "") || "sequence";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Sequence snapshots and export"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
          History · snapshots
        </p>
        <h2 className="mt-1 text-lg font-bold text-[var(--color-ink)]">{doc.name}</h2>

        <div className="mt-3 flex gap-1.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void take();
            }}
            placeholder="Snapshot note - e.g. workshop cut"
            aria-label="Snapshot note"
            spellCheck={false}
            disabled={busy}
            className="min-w-0 flex-1 rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-xs text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none"
          />
          <Button size="sm" onClick={() => void take()} disabled={busy}>
            Snapshot
          </Button>
        </div>

        <ul className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {snaps.length === 0 && (
            <li className="rounded-lg border border-dashed border-[#E3D9C6] px-3 py-4 text-center text-[11px] text-[#777168]">
              No snapshots yet - freeze the interaction before workshops and approvals.
            </li>
          )}
          {snaps.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-lg border border-[#EFE9DC] bg-white px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold text-[#27241F]">
                  v{s.version} · {s.status}
                  {s.note && <span className="font-normal text-[#777168]"> - {s.note}</span>}
                </p>
                <p className="font-mono text-[10px] text-[#A39B8E]">
                  {new Date(s.createdAt).toLocaleString()} · {s.payload.participants.length} participants
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setPendingRestore(s)} disabled={busy}>
                Restore
              </Button>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap gap-2 border-t border-[#EFE9DC] pt-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => download(`${slug}-v${doc.version}.seq.txt`, printStatements(doc.participants, doc.nodes), "text/plain")}
          >
            DSL .txt
          </Button>
          <Button size="sm" variant="secondary" onClick={() => download(`${slug}-v${doc.version}.mmd`, toMermaid(doc), "text/plain")}>
            Mermaid .mmd
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => download(`${slug}-v${doc.version}-package.json`, JSON.stringify(sequencePackage(doc), null, 2), "application/json")}
          >
            Package JSON
          </Button>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      {pendingRestore && (
        <ConfirmDialog
          title={`Restore v${pendingRestore.version}?`}
          message={`The editor returns to v${pendingRestore.version}${pendingRestore.note ? ` - "${pendingRestore.note}"` : ""}. Current statements become unsaved work.`}
          confirmLabel="Restore snapshot"
          onCancel={() => setPendingRestore(null)}
          onConfirm={() => void restore(pendingRestore)}
        />
      )}
    </div>
  );
}
