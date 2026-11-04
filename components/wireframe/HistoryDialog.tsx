"use client";

import { useEffect, useState } from "react";
import Button from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import type { Experience } from "@/lib/wireframe/model";
import { experiencePackage } from "@/lib/wireframe/packageIo";
import { listSnapshots, saveExperience, saveSnapshot, type WireframeSnapshot } from "@/lib/wireframe/store";

function download(filename: string, text: string, mime: string) {
  try {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    /* download unavailable */
  }
}

/**
 * History + export dialog (EPIC 11/12): versioned snapshots with status,
 * one-click restore, and the portable package (experience + ODA manifest
 * + build spec) as a single JSON download.
 */
export function HistoryDialog({ exp, onRestored, onClose }: { exp: Experience; onRestored: () => void; onClose: () => void }) {
  const [snaps, setSnaps] = useState<WireframeSnapshot[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingRestore, setPendingRestore] = useState<WireframeSnapshot | null>(null);

  const refresh = async () => {
    setSnaps(await listSnapshots(exp.id).catch(() => []));
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exp.id]);

  const take = async () => {
    setBusy(true);
    const version = snaps.reduce((m, s) => Math.max(m, s.version), 0) + 1;
    const ok = await saveSnapshot({
      id: `${exp.id}:v${version}`,
      experienceId: exp.id,
      version,
      status: exp.status,
      note: note.trim().slice(0, 200),
      createdAt: Date.now(),
      payload: exp,
    }).catch(() => false);
    setBusy(false);
    if (ok) {
      setNote("");
      await refresh();
    }
  };

  const restore = async (snap: WireframeSnapshot) => {
    setPendingRestore(null);
    setBusy(true);
    const ok = await saveExperience({ ...snap.payload, id: exp.id, version: snap.version, status: snap.status }).catch(() => false);
    setBusy(false);
    if (ok) onRestored();
  };

  const exportPackage = () => {
    const slug = exp.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
    download(
      `${slug}-v${exp.version}-package.json`,
      JSON.stringify(experiencePackage(exp), null, 2),
      "application/json",
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Snapshots and export"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
          History · snapshots
        </p>
        <h2 className="mt-1 text-lg font-bold text-[var(--color-ink)]">{exp.name}</h2>

        <div className="mt-3 flex gap-1.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void take();
            }}
            placeholder="Snapshot note - e.g. client review cut"
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
              No snapshots yet - freeze the design before client reviews and approvals.
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
                  {new Date(s.createdAt).toLocaleString()} · {s.payload.screens.length} screens · {s.payload.components.length} components
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setPendingRestore(s)} disabled={busy}>
                Restore
              </Button>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex gap-2 border-t border-[#EFE9DC] pt-3">
          <Button size="sm" variant="secondary" onClick={exportPackage}>
            Export package
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
          message={`Current canvas becomes unsaved work${pendingRestore.note ? ` - "${pendingRestore.note}"` : ""}.`}
          confirmLabel="Restore snapshot"
          onCancel={() => setPendingRestore(null)}
          onConfirm={() => void restore(pendingRestore)}
        />
      )}
    </div>
  );
}
