import { STORES, withStore } from "@/lib/db";
import type { GroundingDoc } from "./grounding";

export async function listGrounding(): Promise<GroundingDoc[]> {
  try {
    const all = await withStore<GroundingDoc[]>(STORES.arenaGrounding, "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveGroundingDoc(doc: GroundingDoc): Promise<boolean> {
  try {
    await withStore(STORES.arenaGrounding, "readwrite", (s) => s.put({ ...doc, updatedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export async function deleteGroundingDoc(id: string): Promise<boolean> {
  try {
    await withStore(STORES.arenaGrounding, "readwrite", (s) => s.delete(id));
    return true;
  } catch {
    return false;
  }
}
