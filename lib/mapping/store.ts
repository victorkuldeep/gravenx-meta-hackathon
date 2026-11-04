/**
 * Mapping Studio - IndexedDB project library.
 * Reuses the central gravenx-studio DB via withStore + STORES.
 */

import { STORES, withStore } from "../db";
import type { MappingProject } from "./types";

function req<T>(fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return withStore(STORES.mappingProjects, "readwrite", fn);
}

function reqRead<T>(fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return withStore(STORES.mappingProjects, "readonly", fn);
}

export interface ProjectSummary {
  id: string;
  name: string;
  /** Short purpose line from the wizard - powers library word search. */
  description?: string;
  sourceApi?: string;
  targetSystem: string;
  status: MappingProject["status"];
  updatedAt: string;
  mappingCount: number;
  unmappedCount: number;
  decisionOpenCount: number;
  versionCount: number;
  fingerprint?: string;
}

export function toSummary(p: MappingProject): ProjectSummary {
  const leafPaths =
    p.source?.paths.filter((x) => x.kind === "scalar" || x.kind === "null").map((x) => x.id) ?? [];
  const mapped = new Set(p.mappings.filter((m) => m.kind !== "excluded").map((m) => m.sourcePath));
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    sourceApi: p.sourceApi,
    targetSystem: p.targetSystem,
    status: p.status,
    updatedAt: p.updatedAt,
    mappingCount: p.mappings.length,
    unmappedCount: leafPaths.filter((x) => !mapped.has(x)).length,
    decisionOpenCount: p.decisions.filter((d) => d.status === "open").length,
    versionCount: p.versions.length,
    fingerprint: p.sfSnapshot?.fingerprint,
  };
}

export async function saveProject(project: MappingProject): Promise<void> {
  await req((s) => s.put(project));
}

export async function loadProject(id: string): Promise<MappingProject | undefined> {
  return reqRead((s) => s.get(id));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await reqRead((s) => s.getAll() as IDBRequest<MappingProject[]>);
  return (all ?? []).map(toSummary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteProject(id: string): Promise<void> {
  await req((s) => s.delete(id));
}

export function duplicateProject(p: MappingProject, newId: string, now: string): MappingProject {
  return {
    ...JSON.parse(JSON.stringify(p)),
    id: newId,
    name: `${p.name} (copy)`,
    status: "draft" as const,
    createdAt: now,
    updatedAt: now,
  };
}
