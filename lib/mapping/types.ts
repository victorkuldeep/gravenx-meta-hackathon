/**
 * Mapping Studio - versioned portable domain model.
 *
 * Local-first: IndexedDB holds working projects, portable JSON files are
 * the exchange format. Stable string IDs throughout - never row order.
 * No secrets ever enter this model.
 */

import type {
  ApiCatalog,
  ArchitectureDecision,
  ArchitectureSnapshot,
  Assumption,
  ChangeLogEntry,
  ExperienceModule,
} from "../experience/types";

export const MAPPING_FORMAT = "gravenx-mapping-project";
export const MAPPING_FORMAT_VERSION = 1;

/** Project schema version: 1 = integration-only, 2 = + experience/api/decisions. */
export const MAPPING_SCHEMA_VERSION = 2;

export type LifecycleStatus = "draft" | "in-progress" | "in-review" | "approved" | "archived";

export type SourceKind = "json-sample";
export type Requiredness = "required" | "optional" | "unknown";

export type JsonType = "string" | "integer" | "number" | "boolean" | "null" | "object" | "array";

export type NodeKind = "scalar" | "object" | "array" | "null";

export interface SourcePath {
  /** Stable id: the canonical path itself. Survives reparse. */
  id: string;
  /** Canonical path, e.g. "$.orderItem[].sku". */
  path: string;
  parent: string | null;
  key: string;
  kind: NodeKind;
  jsonType: JsonType;
  /** Representative example value (first array element wins). Truncated. */
  example?: unknown;
  depth: number;
  /** True when any ancestor is an array element. */
  inArray: boolean;
  required: Requiredness;
}

export interface SourceSnapshot {
  kind: SourceKind;
  name: string;
  /** Original JSON text - never mutated by mapping work. */
  originalText: string;
  paths: SourcePath[];
  capturedAt: string;
}

export interface SnapshotField {
  name: string;
  label: string;
  type: string;
  length: number;
  precision: number;
  scale: number;
  nillable: boolean;
  createable: boolean;
  updateable: boolean;
  calculated: boolean;
  defaultedOnCreate: boolean;
  unique: boolean;
  externalId: boolean;
  referenceTo: string[];
  relationshipName: string | null;
  restrictedPicklist: boolean;
  defaultValue: unknown;
  picklistValues: { value: string; label: string; active: boolean }[];
}

export interface SnapshotObject {
  name: string;
  label: string;
  custom: boolean;
  fields: SnapshotField[];
}

export interface SalesforceSnapshot {
  id: string;
  capturedAt: string;
  /** User-defined org label. Never a credential. */
  orgAlias?: string;
  fingerprint: string;
  objects: SnapshotObject[];
}

export type OperationIntent = "create" | "update" | "upsert" | "lookup";

export interface RecordPlan {
  id: string;
  name: string;
  objectName: string;
  intent: OperationIntent;
  /** Source collection path, e.g. "$.orderItem[]". Empty = single root record. */
  sourcePath: string;
  cardinality: "one" | "many";
  parentPlanId: string | null;
  matchKey?: string;
  notes?: string;
}

export interface RelationshipDef {
  id: string;
  childPlanId: string;
  parentPlanId: string;
  /** Target relationship field API name on the child object. */
  fieldName: string;
  strategy: "parent-id" | "external-id" | "lookup" | "unresolved" | "other";
  confirmed: boolean;
  notes?: string;
}

export type MappingKind = "direct" | "hardcoded" | "excluded" | "enum";

/**
 * Source path for free constant rows: grid-only rows with no JSON node.
 * The guide view never renders them (no leaf matches); diagnostics skips
 * the source check for them; exports show them as-is.
 */
export const FREE_SOURCE_PATH = "(constant)";

export type MappingStatus =
  | "unmapped"
  | "mapped"
  | "hardcoded"
  | "excluded"
  | "needs-transformation"
  | "needs-decision"
  | "incompatible"
  | "stale-target"
  | "invalid";

/** Display copy for status ids - Title Case everywhere, never raw kebab. */
export const STATUS_LABELS: Record<MappingStatus, string> = {
  unmapped: "Unmapped",
  mapped: "Mapped",
  hardcoded: "Hardcoded",
  excluded: "Excluded",
  "needs-transformation": "Needs Transformation",
  "needs-decision": "Needs Decision",
  incompatible: "Incompatible",
  "stale-target": "Stale Target",
  invalid: "Invalid",
};

export const ALL_STATUSES: MappingStatus[] = [
  "unmapped",
  "mapped",
  "hardcoded",
  "excluded",
  "needs-transformation",
  "needs-decision",
  "incompatible",
  "stale-target",
  "invalid",
];

export interface EnumValueMap {
  sourceValue: string;
  targetValue: string;
  decided: boolean;
  rationale?: string;
}

export interface MappingRow {
  id: string;
  sourcePath: string;
  planId: string | null;
  objectName: string;
  fieldName: string;
  kind: MappingKind;
  status: MappingStatus;
  hardcodedValue?: unknown;
  hardcodedConfirmed?: boolean;
  enumMap?: EnumValueMap[];
  rationale?: string;
  notes?: string;
  updatedAt: string;
}

export type DecisionStatus = "open" | "decided" | "deferred";

export interface Decision {
  id: string;
  title: string;
  description?: string;
  sourcePaths: string[];
  planId?: string | null;
  fieldName?: string;
  status: DecisionStatus;
  decision?: string;
  rationale?: string;
  owner?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectVersion {
  id: string;
  label: string;
  createdAt: string;
  summary: string;
  mappings: MappingRow[];
  decisions: Decision[];
  recordPlans: RecordPlan[];
  relationships: RelationshipDef[];
  fingerprint: string;
}

export interface Diagnostic {
  id: string;
  severity: "error" | "warning" | "info";
  category: string;
  sourcePath?: string;
  objectName?: string;
  fieldName?: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
  action?: string;
  resolved?: boolean;
}

export interface MappingProject {
  id: string;
  name: string;
  description?: string;
  sourceSystem?: string;
  sourceApi?: string;
  targetSystem: string;
  domain?: string;
  tags: string[];
  status: LifecycleStatus;
  createdAt: string;
  updatedAt: string;
  /** Schema version of this record. Absent on pre-experience projects (= 1). */
  schemaVersion?: number;
  source: SourceSnapshot | null;
  sfSnapshot: SalesforceSnapshot | null;
  recordPlans: RecordPlan[];
  relationships: RelationshipDef[];
  mappings: MappingRow[];
  decisions: Decision[];
  versions: ProjectVersion[];
  /** Optional Experience Mapping module - same project identity, same record. */
  experience?: ExperienceModule;
  /** Project-level shared API catalog. */
  apiCatalog?: ApiCatalog;
  /** Architecture decisions / assumptions / change history. */
  archDecisions?: ArchitectureDecision[];
  assumptions?: Assumption[];
  changeLog?: ChangeLogEntry[];
  /** Named architecture snapshots (binaries stay in IDB by key). */
  experienceSnapshots?: ArchitectureSnapshot[];
  /** Optional architect display name for change log. Never auto-filled. */
  authorName?: string;
  extensions: Record<string, unknown>;
}

export interface PortableProject {
  format: typeof MAPPING_FORMAT;
  formatVersion: number;
  exportedAt: string;
  exportKind: "full" | "handoff" | "mapping-only";
  project: MappingProject;
}

/** Fresh project shell from the wizard. IDs assigned by the caller. */
export function blankProject(init: {
  id: string;
  name: string;
  description?: string;
  sourceSystem?: string;
  sourceApi?: string;
  domain?: string;
  tags?: string[];
  now: string;
}): MappingProject {
  return {
    id: init.id,
    name: init.name,
    description: init.description,
    sourceSystem: init.sourceSystem,
    sourceApi: init.sourceApi,
    targetSystem: "Salesforce",
    domain: init.domain,
    tags: init.tags ?? [],
    status: "draft",
    createdAt: init.now,
    updatedAt: init.now,
    schemaVersion: MAPPING_SCHEMA_VERSION,
    source: null,
    sfSnapshot: null,
    recordPlans: [],
    relationships: [],
    mappings: [],
    decisions: [],
    versions: [],
    extensions: {},
  };
}
