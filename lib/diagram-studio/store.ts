import { STORES, withStore } from "@/lib/db";
import type { StudioProject } from "./types";

/**
 * Diagram Studio persistence: studio packs in their own store.
 * Degrades to safe empties off-browser, mirroring the Sequence store.
 */

export async function listDiagramStudios(): Promise<StudioProject[]> {
  try {
    const all = await withStore<StudioProject[]>(STORES.diagramStudios, "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveDiagramStudio(project: StudioProject): Promise<boolean> {
  try {
    await withStore(STORES.diagramStudios, "readwrite", (s) => s.put({ ...project, updatedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export async function deleteDiagramStudio(id: string): Promise<boolean> {
  try {
    await withStore(STORES.diagramStudios, "readwrite", (s) => s.delete(id));
    return true;
  } catch {
    return false;
  }
}
