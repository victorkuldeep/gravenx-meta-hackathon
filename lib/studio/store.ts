/**
 * Studio workspace - IndexedDB library (central DB, studio-projects store).
 */

import { STORES, withStore } from "../db";
import type { StudioProject } from "./types";

export interface StudioSummary {
  id: string;
  name: string;
  customer?: string;
  status: StudioProject["status"];
  updatedAt: string;
  mappingCount: number;
  screenCount: number;
  operationCount: number;
  openDecisions: number;
}

export function toStudioSummary(w: StudioProject): StudioSummary {
  return {
    id: w.id,
    name: w.name,
    customer: w.customer,
    status: w.status,
    updatedAt: w.updatedAt,
    mappingCount: w.mappingIds.length,
    screenCount: w.experience?.screens.length ?? 0,
    operationCount: w.apiCatalog?.operations.length ?? 0,
    openDecisions: (w.archDecisions ?? []).filter((d) => d.status === "open" || d.status === "proposed").length,
  };
}

export async function saveStudio(root: StudioProject): Promise<void> {
  await withStore(STORES.studioProjects, "readwrite", (s) => s.put(root));
}

export async function loadStudio(id: string): Promise<StudioProject | undefined> {
  return withStore(STORES.studioProjects, "readonly", (s) => s.get(id));
}

export async function listStudios(): Promise<StudioSummary[]> {
  const all = await withStore(STORES.studioProjects, "readonly", (s) => s.getAll() as IDBRequest<StudioProject[]>);
  return (all ?? []).map(toStudioSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteStudio(id: string): Promise<void> {
  await withStore(STORES.studioProjects, "readwrite", (s) => s.delete(id));
}
