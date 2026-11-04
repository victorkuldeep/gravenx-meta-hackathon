"use client";

import { withStore, STORES } from "@/lib/db";
import { validateProject, type SystemProject } from "./model";

/** Project repository: one record per project, keyed by project id. */
export async function saveSystemProject(project: SystemProject): Promise<void> {
  const record = { ...project, id: project.id, updatedAt: Date.now() };
  try {
    await withStore(STORES.systemProjects, "readwrite", (store) => store.put({ ...record }));
  } catch {
    throw new Error("Could not save project (IndexedDB unavailable or quota exceeded).");
  }
}

export async function listSystemProjects(): Promise<{ id: string; name: string; updatedAt: number }[]> {
  try {
    const all = await withStore<SystemProject[]>(STORES.systemProjects, "readonly", (store) => store.getAll());
    return (all ?? [])
      .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/**
 * Migrate-on-read: vintage records predate flows/settings/runScope defaults
 * and newer validation, and the rest of the code assumes those shapes. A
 * record that no longer validates reads as missing (callers fall back to a
 * fresh project) instead of loading half-shaped.
 */
export async function loadSystemProject(id: string): Promise<SystemProject | null> {
  try {
    const rec = await withStore<SystemProject | undefined>(STORES.systemProjects, "readonly", (store) =>
      store.get(id)
    );
    if (!rec) return null;
    const { project } = validateProject(rec);
    return project;
  } catch {
    return null;
  }
}

export async function deleteSystemProject(id: string): Promise<void> {
  try {
    await withStore(STORES.systemProjects, "readwrite", (store) => store.delete(id));
  } catch {
    throw new Error("Could not delete project (IndexedDB unavailable).");
  }
}
