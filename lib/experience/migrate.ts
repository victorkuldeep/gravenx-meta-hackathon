/**
 * Experience Mapping - lazy project migration.
 *
 * Pre-experience projects (schemaVersion absent/1) load untouched.
 * Experience structures materialize only when the architect opens the
 * Experience module - never as an eager full-project rewrite.
 */

import { blankApiCatalog, blankExperienceModule } from "./types";
import type { WorkspaceScope } from "../studio/types";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Ensure the Experience module exists. Returns the scope (mutated in place). */
export function ensureExperience<T extends WorkspaceScope>(scope: T, now: string): T {
  if (!scope.experience) {
    scope.experience = blankExperienceModule(uid("exp"), now);
  }
  if (!scope.apiCatalog) {
    scope.apiCatalog = blankApiCatalog(uid("api"), now);
  }
  if (!scope.archDecisions) scope.archDecisions = [];
  if (!scope.assumptions) scope.assumptions = [];
  if (!scope.changeLog) scope.changeLog = [];
  if (!scope.experienceSnapshots) scope.experienceSnapshots = [];
  scope.updatedAt = now;
  return scope;
}

/** Append a change-history entry. Meaningful edits only - never keystrokes. */
export function logChange<T extends { changeLog?: import("./types").ChangeLogEntry[] }>(
  scope: T,
  entityType: string,
  entityId: string,
  changeType: string,
  summary: string,
  now: string,
  origin: "manual" | "import" | "migration" | "system" = "manual"
): void {
  if (!scope.changeLog) scope.changeLog = [];
  scope.changeLog.push({
    id: uid("chg"),
    timestamp: now,
    entityType,
    entityId,
    changeType,
    summary,
    origin,
  });
}
