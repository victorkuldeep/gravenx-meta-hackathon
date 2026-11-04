import { STORES, withStore } from "@/lib/db";
import type { StudioSketch } from "./sketch";

/** Diagram Studio sketches: freehand docs in their own store. */

export async function listSketches(): Promise<StudioSketch[]> {
  try {
    const all = await withStore<StudioSketch[]>(STORES.diagramSketches, "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveSketch(sketch: StudioSketch): Promise<boolean> {
  try {
    await withStore(STORES.diagramSketches, "readwrite", (s) => s.put({ ...sketch, updatedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export async function deleteSketch(id: string): Promise<boolean> {
  try {
    await withStore(STORES.diagramSketches, "readwrite", (s) => s.delete(id));
    return true;
  } catch {
    return false;
  }
}
