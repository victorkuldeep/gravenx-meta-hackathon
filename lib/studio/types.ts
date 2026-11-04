/**
 * Studio workspace root - the PROJECT umbrella.
 *
 * Example: "Accenture" root containing 100s of child Integration Mappings
 * (orders, quotes, …) plus one Experience workspace whose screens map to
 * endpoint payloads. Experience, API Catalog, Decisions and snapshots live
 * ONCE at the root; each child mapping owns its payload + SF field maps.
 */

import type {
  ApiCatalog,
  ArchitectureDecision,
  ArchitectureSnapshot,
  Assumption,
  ChangeLogEntry,
  ExperienceModule,
} from "../experience/types";

export const STUDIO_FORMAT_VERSION = 1;

export interface StudioProject {
  id: string;
  name: string;
  /** Customer / program umbrella, e.g. "Accenture". */
  customer?: string;
  description?: string;
  domain?: string;
  tags: string[];
  status: "draft" | "in-progress" | "in-review" | "approved" | "archived";
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  /** Child integration mapping ids (records in mapping-projects). */
  mappingIds: string[];
  experience?: ExperienceModule;
  apiCatalog?: ApiCatalog;
  archDecisions?: ArchitectureDecision[];
  assumptions?: Assumption[];
  changeLog?: ChangeLogEntry[];
  experienceSnapshots?: ArchitectureSnapshot[];
  authorName?: string;
}

export function blankStudio(init: {
  id: string;
  name: string;
  customer?: string;
  description?: string;
  domain?: string;
  now: string;
}): StudioProject {
  return {
    id: init.id,
    name: init.name,
    customer: init.customer,
    description: init.description,
    domain: init.domain,
    tags: [],
    status: "draft",
    schemaVersion: STUDIO_FORMAT_VERSION,
    createdAt: init.now,
    updatedAt: init.now,
    mappingIds: [],
  };
}

/**
 * Minimal surface shared by StudioProject (root) and MappingProject
 * (standalone child). Workspace-level panels depend on this, never on
 * integration fields - so the same Experience/APIs/Decisions UI runs on
 * both without duplication.
 */
export interface WorkspaceScope {
  id: string;
  updatedAt: string;
  experience?: ExperienceModule;
  apiCatalog?: ApiCatalog;
  archDecisions?: ArchitectureDecision[];
  assumptions?: Assumption[];
  changeLog?: ChangeLogEntry[];
  experienceSnapshots?: ArchitectureSnapshot[];
  authorName?: string;
}
