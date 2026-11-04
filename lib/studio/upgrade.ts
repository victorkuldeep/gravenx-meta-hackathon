/**
 * Studio workspace - upgrade + attach.
 *
 * A standalone MappingProject (one JSON = one integration mapping) becomes
 * a child of a workspace root. Experience/API/decisions move UP to the
 * root exactly once; the child keeps payload + field maps + snapshots.
 */

import { MAPPING_SCHEMA_VERSION, type MappingProject } from "../mapping/types";
import { blankStudio, type StudioProject } from "./types";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Split a standalone project into { root, child }. No data loss. */
export function upgradeToWorkspace(source: MappingProject, now: string): { root: StudioProject; child: MappingProject } {
  const clone = JSON.parse(JSON.stringify(source)) as MappingProject;
  const root = blankStudio({
    id: uid("ws"),
    name: `${source.name} Workspace`,
    description: source.description,
    domain: source.domain,
    now,
  });
  root.mappingIds = [clone.id];
  if (clone.experience) root.experience = clone.experience;
  if (clone.apiCatalog) root.apiCatalog = clone.apiCatalog;
  if (clone.archDecisions) root.archDecisions = clone.archDecisions;
  if (clone.assumptions) root.assumptions = clone.assumptions;
  if (clone.changeLog) root.changeLog = clone.changeLog;
  if (clone.experienceSnapshots) root.experienceSnapshots = clone.experienceSnapshots;
  if (clone.authorName) root.authorName = clone.authorName;

  delete clone.experience;
  delete clone.apiCatalog;
  delete clone.archDecisions;
  delete clone.assumptions;
  delete clone.changeLog;
  delete clone.experienceSnapshots;
  clone.schemaVersion = MAPPING_SCHEMA_VERSION;
  clone.updatedAt = now;
  return { root, child: clone };
}

/** Attach an existing standalone mapping under a root (no duplication). */
export function attachMapping(root: StudioProject, childId: string, now: string): StudioProject {
  if (root.mappingIds.includes(childId)) return root;
  return { ...root, mappingIds: [...root.mappingIds, childId], updatedAt: now };
}

/** Detach a child (the mapping record itself is preserved). */
export function detachMapping(root: StudioProject, childId: string, now: string): StudioProject {
  return { ...root, mappingIds: root.mappingIds.filter((id) => id !== childId), updatedAt: now };
}
