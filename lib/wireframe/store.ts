import { STORES, withStore } from "@/lib/db";
import { ExperienceSchema, type Experience } from "./model";

/**
 * Wireframe persistence (EPIC 01): experiences + versioned snapshots.
 * Snapshots freeze a full payload copy with status; only `approved`
 * snapshots feed the Author-mode prefill contract (EPIC 06).
 * Degrades to safe empties off-browser.
 */

export interface WireframeSnapshot {
  id: string;
  experienceId: string;
  version: number;
  status: "draft" | "in-review" | "approved";
  note: string;
  createdAt: number;
  payload: Experience;
}

function clean(exp: Experience): Experience {
  return ExperienceSchema.parse(exp);
}

export async function listExperiences(): Promise<Experience[]> {
  try {
    const all = await withStore<Experience[]>(STORES.wireframes, "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveExperience(exp: Experience): Promise<boolean> {
  try {
    await withStore(STORES.wireframes, "readwrite", (s) => s.put(clean({ ...exp, updatedAt: Date.now() })));
    return true;
  } catch {
    return false;
  }
}

export async function deleteExperience(id: string): Promise<boolean> {
  try {
    await withStore(STORES.wireframes, "readwrite", (s) => s.delete(id));
    return true;
  } catch {
    return false;
  }
}

export async function listSnapshots(experienceId: string): Promise<WireframeSnapshot[]> {
  try {
    const all = await withStore<WireframeSnapshot[]>(STORES.wireframeSnapshots, "readonly", (s) => s.getAll());
    return all.filter((s) => s.experienceId === experienceId).sort((a, b) => b.version - a.version);
  } catch {
    return [];
  }
}

export async function saveSnapshot(snap: WireframeSnapshot): Promise<boolean> {
  try {
    await withStore(STORES.wireframeSnapshots, "readwrite", (s) => s.put({ ...snap, payload: clean(snap.payload) }));
    return true;
  } catch {
    return false;
  }
}
