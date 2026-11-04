export interface ErdSnapshot {
  id: string;
  /** Org hostname, e.g. myorg.my.salesforce.com - snapshots are listed per org. */
  orgDomain: string;
  /** Owning canvas tab - stamped at creation so inbox navigation routes back.
   * Absent on vintage snapshots (restore in place). */
  tabId?: string;
  tabName?: string;
  name: string;
  createdAt: number;
  root: string;
  focus: string;
  /** Objects on canvas. */
  nodes: string[];
  /** Drag positions to reapply on restore. */
  positions: Record<string, { x: number; y: number }>;
  /** Design notes captured with the snapshot (markdown side). */
  notes?: string;
  /** Rich side of the notes + the editor last used. Absent on vintage
   * snapshots - the Markdown side migrates them on first touch. */
  notesFormat?: NoteFormat;
  notesHtml?: string;
  /** Optional lifecycle/anchor metadata for the attached notes. */
  noteMeta?: InboxMeta;
}

import { STORES, withStore } from "@/lib/db";
import type { InboxMeta } from "@/lib/inbox/types";
import { noteBodyFromMd, type NoteBody, type NoteFormat } from "@/lib/notes/notebody";

/**
 * Stored snapshot notes triple → editor-ready dual body. Vintage snapshots
 * carry Markdown only and migrate on first touch.
 */
export function snapshotNotesToNote(s: Pick<ErdSnapshot, "notes" | "notesFormat" | "notesHtml">): NoteBody {
  if (s.notesFormat === "rich" && s.notesHtml?.trim()) {
    return { format: "rich", md: s.notes ?? "", html: s.notesHtml };
  }
  return noteBodyFromMd(s.notes ?? "");
}

/** Editor draft → storable triple. Empty drafts clear all three sides. */
export function noteToSnapshotNotes(b: NoteBody): Pick<ErdSnapshot, "notes" | "notesFormat" | "notesHtml"> {
  if (!b.md.trim() && !b.html.trim()) return { notes: undefined, notesFormat: undefined, notesHtml: undefined };
  return { notes: b.md, notesFormat: b.format, notesHtml: b.html };
}

const STORE = STORES.erdSnapshots;
const MAX_PER_ORG = 20;

export async function listSnapshotsByOrg(orgDomain: string): Promise<ErdSnapshot[]> {
  const all = await withStore<ErdSnapshot[]>(STORE, "readonly", (store) => store.getAll());
  return (all ?? [])
    .filter((s) => s.orgDomain === orgDomain)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveSnapshot(snap: ErdSnapshot): Promise<void> {
  await withStore(STORE, "readwrite", (store) => store.put(snap));
  // Prune to the newest MAX_PER_ORG for this org
  const kept = await listSnapshotsByOrg(snap.orgDomain);
  const extra = kept.slice(MAX_PER_ORG);
  if (extra.length > 0) {
    await withStore(STORE, "readwrite", (store) => {
      for (const s of extra) store.delete(s.id);
      // Return a dummy request - completion is tracked via the transaction
      return store.get(snap.id);
    });
  }
}

export async function deleteSnapshot(id: string): Promise<void> {
  await withStore(STORE, "readwrite", (store) => store.delete(id));
}

export async function renameSnapshot(id: string, name: string): Promise<void> {
  const all = await withStore<ErdSnapshot[]>(STORE, "readonly", (store) => store.getAll());
  const found = (all ?? []).find((s) => s.id === id);
  if (!found) return;
  await withStore(STORE, "readwrite", (store) => store.put({ ...found, name }));
}
