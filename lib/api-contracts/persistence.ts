import { STORES, withStore } from "../db";
import { validateApiProject } from "./project-schema";
import type { ApiProject } from "./types";

/**
 * Architect project persistence: drafts + metadata snapshots in the
 * central IndexedDB (v8 store). Snapshots are per-object describes so a
 * saved project stays reviewable offline.
 */

export interface SnapshotEntry {
  objectName: string;
  capturedAt: number;
  describe: unknown;
}

export interface StoredApiProject {
  id: string;
  project: ApiProject;
  snapshots: SnapshotEntry[];
}

const STORE = STORES.architectProjects;

export async function listStoredProjects(): Promise<StoredApiProject[]> {
  const all = await withStore<StoredApiProject[]>(STORE, "readonly", (s) => s.getAll());
  return (all ?? []).sort((a, b) => a.project.updatedAt - b.project.updatedAt);
}

export async function saveStoredProject(stored: StoredApiProject): Promise<void> {
  await withStore(STORE, "readwrite", (s) => s.put(stored));
}

export async function deleteStoredProject(id: string): Promise<void> {
  await withStore(STORE, "readwrite", (s) => s.delete(id));
}

export function serializeStoredProject(stored: StoredApiProject): string {
  return JSON.stringify({ kind: "sf-architect-project", version: 1, ...stored }, null, 2);
}

export function parseStoredProjectImport(text: string): StoredApiProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Import is not valid JSON.");
  }
  const rec = raw as { project?: unknown; snapshots?: unknown; id?: unknown };
  if (!rec || typeof rec !== "object" || !rec.project) {
    throw new Error("Import is not an architect project (missing project).");
  }
  const check = validateApiProject(rec.project);
  if (!check.ok) throw new Error(`Invalid project: ${check.errors[0]}`);
  const snapshots = Array.isArray(rec.snapshots) ? (rec.snapshots as SnapshotEntry[]) : [];
  const project = rec.project as ApiProject;
  return { id: project.id, project, snapshots };
}
