import { STORES, withStore } from "@/lib/db";
import { SequenceSchema, type SequenceDocument } from "./model";

/**
 * Sequence persistence (EPIC 01): documents + versioned snapshots.
 * Mirrors the Wireframe store contract. Degrades to safe empties off-browser.
 */

export interface SequenceSnapshot {
  id: string;
  sequenceId: string;
  version: number;
  status: "draft" | "in-review" | "approved";
  note: string;
  createdAt: number;
  payload: SequenceDocument;
}

function clean(doc: SequenceDocument): SequenceDocument {
  return SequenceSchema.parse(doc);
}

export async function listSequences(): Promise<SequenceDocument[]> {
  try {
    const all = await withStore<SequenceDocument[]>(STORES.sequences, "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveSequence(doc: SequenceDocument): Promise<boolean> {
  try {
    await withStore(STORES.sequences, "readwrite", (s) => s.put(clean({ ...doc, updatedAt: Date.now() })));
    return true;
  } catch {
    return false;
  }
}

export async function deleteSequence(id: string): Promise<boolean> {
  try {
    await withStore(STORES.sequences, "readwrite", (s) => s.delete(id));
    return true;
  } catch {
    return false;
  }
}

export async function listSequenceSnapshots(sequenceId: string): Promise<SequenceSnapshot[]> {
  try {
    const all = await withStore<SequenceSnapshot[]>(STORES.sequenceSnapshots, "readonly", (s) => s.getAll());
    return all.filter((s) => s.sequenceId === sequenceId).sort((a, b) => b.version - a.version);
  } catch {
    return [];
  }
}

export async function saveSequenceSnapshot(snap: SequenceSnapshot): Promise<boolean> {
  try {
    await withStore(STORES.sequenceSnapshots, "readwrite", (s) => s.put({ ...snap, payload: clean(snap.payload) }));
    return true;
  } catch {
    return false;
  }
}
