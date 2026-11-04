/**
 * Experience Mapping Studio - domain model.
 *
 * Lives as an OPTIONAL module on the existing MappingProject
 * (see lib/mapping/types.ts). Never duplicates Integration Mapping
 * state: Salesforce metadata and field mappings are referenced by
 * stable ID, never copied.
 */

export type ExperienceStatus = "draft" | "proposed" | "confirmed" | "changed" | "blocked" | "open";
export type ScreenStatus = "draft" | "in-review" | "confirmed" | "changed" | "archived";

export interface ExperienceModule {
  id: string;
  version: number;
  screens: Screen[];
  assets: ScreenAsset[];
  components: UIComponent[];
  annotations: ScreenAnnotation[];
  actions: UIAction[];
  journeys: UserJourney[];
  transitions: ScreenTransition[];
  bindings: APIBinding[];
  requirements: UIDataRequirement[];
  states: UIStateDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface WireframeRef {
  experienceId: string;
  screenId: string;
  /** Last-known labels - kept as historical context when the wireframe is deleted. */
  experienceName?: string;
  screenName?: string;
}

export interface Screen {
  id: string;
  name: string;
  description?: string;
  route?: string;
  feature?: string;
  journeyIds: string[];
  userRole?: string;
  deviceContext?: "desktop" | "tablet" | "mobile" | "responsive";
  assetId?: string;
  /** Agreed endpoint powering this screen, e.g. "POST /leads". */
  endpoint?: string;
  /** Child integration mapping id whose payload feeds this screen. */
  payloadMappingId?: string;
  /** Linked Wireframe Studio screen - a live wireframe acts as this screen's design. */
  wireframeRef?: WireframeRef;
  /** Architect / workshop notes about this screen's contract. */
  notes?: string;
  canvas: { sourceWidth: number; sourceHeight: number; aspectRatio: number };
  componentIds: string[];
  actionIds: string[];
  bindingIds: string[];
  status: ScreenStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ScreenAsset {
  id: string;
  screenId: string;
  fileName: string;
  mimeType: "image/png" | "image/webp";
  byteSize: number;
  width: number;
  height: number;
  contentHash?: string;
  /** Stable key into the mapping-assets IDB store. Never a blob: URL. */
  storageKey: string;
  thumbnailStorageKey?: string;
  createdAt: string;
}

export type ComponentType =
  | "container" | "text" | "input" | "button" | "table" | "list"
  | "card" | "form" | "modal" | "navigation" | "custom";

export interface UIComponent {
  id: string;
  screenId: string;
  name: string;
  componentType: ComponentType;
  purpose?: string;
  description?: string;
  requirementIds: string[];
  bindingIds: string[];
  actionIds: string[];
  stateIds: string[];
  status: ExperienceStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Geometry {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSpace: "source-pixels";
}

export interface ScreenAnnotation {
  id: string;
  screenId: string;
  componentId?: string;
  label: string;
  geometry: Geometry;
  zIndex: number;
  createdAt: string;
  updatedAt: string;
}

export type ActionTrigger = "page-load" | "click" | "submit" | "change" | "selection" | "navigation" | "timer" | "other";

export interface UIAction {
  id: string;
  screenId: string;
  componentId?: string;
  name: string;
  description?: string;
  trigger: ActionTrigger;
  bindingIds: string[];
  transitionIds?: string[];
  status: ExperienceStatus;
  createdAt: string;
  updatedAt: string;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OTHER";
export type ApiLayer = "frontend" | "bff" | "salesforce" | "middleware" | "external" | "unknown";
export type ApiLifecycle = "existing" | "proposed" | "in-review" | "approved" | "deprecated";

export interface APIOperation {
  id: string;
  operationKey: string;
  name: string;
  description?: string;
  method: HttpMethod;
  path: string;
  layer: ApiLayer;
  owner?: string;
  version?: string;
  requestContractId?: string;
  responseContractId?: string;
  errorContractIds: string[];
  dependencyIds: string[];
  lifecycle: ApiLifecycle;
  status: ExperienceStatus;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export type BindingUsage = "read" | "create" | "update" | "delete" | "search" | "submit" | "other";
export type BindingTrigger = "screen-load" | "component-load" | "user-action" | "background" | "navigation" | "other";

export interface APIBinding {
  id: string;
  screenId: string;
  componentId?: string;
  actionId?: string;
  operationId: string;
  usage: BindingUsage;
  trigger: BindingTrigger;
  requestRequirementIds: string[];
  responseRequirementIds: string[];
  stateIds: string[];
  sequence?: number;
  notes?: string;
  status: "proposed" | "confirmed" | "changed" | "blocked";
  createdAt: string;
  updatedAt: string;
}

export type RequirementDirection = "response" | "request" | "both" | "local-only";
export type RequirementSource = "design" | "business" | "contract" | "architect";

export interface UIDataRequirement {
  id: string;
  screenId: string;
  componentId?: string;
  bindingId?: string;
  name: string;
  description?: string;
  direction: RequirementDirection;
  propertyPath?: string;
  dataType?: "string" | "number" | "boolean" | "object" | "array" | "date" | "unknown";
  required: boolean;
  nullable?: boolean;
  format?: string;
  example?: unknown;
  source: RequirementSource;
  status: ExperienceStatus;
  notes?: string;
}

export type UIStateKind =
  | "loading" | "success" | "empty" | "validation-error" | "authorization-error"
  | "not-found" | "server-error" | "timeout" | "partial" | "disabled" | "custom";

export interface UIStateDefinition {
  id: string;
  screenId: string;
  componentId?: string;
  bindingId?: string;
  name: string;
  kind: UIStateKind;
  description?: string;
  expectedBehavior?: string;
  status: "proposed" | "confirmed" | "open";
}

export interface UserJourney {
  id: string;
  name: string;
  description?: string;
  actor?: string;
  goal?: string;
  screenIds: string[];
  transitionIds: string[];
  status: "draft" | "in-review" | "confirmed";
}

export interface ScreenTransition {
  id: string;
  journeyId: string;
  fromScreenId: string;
  toScreenId: string;
  actionId?: string;
  condition?: string;
  notes?: string;
  status: "proposed" | "confirmed" | "open";
}

export type DependencyKind =
  | "salesforce-object" | "salesforce-field" | "integration-mapping"
  | "external-service" | "middleware" | "api-operation" | "unknown";

export interface BackendDependency {
  id: string;
  operationId: string;
  kind: DependencyKind;
  reference?: {
    projectId?: string;
    /** Integration mapping row id, record plan id, or API operation id. */
    artifactId?: string;
    objectApiName?: string;
    fieldApiName?: string;
    /** Last-known display values - historical context if the ref breaks. */
    label?: string;
    broken?: boolean;
  };
  label: string;
  notes?: string;
  status: "proposed" | "confirmed" | "open" | "blocked";
}

export interface ApiCatalog {
  id: string;
  version: number;
  operations: APIOperation[];
  dependencies: BackendDependency[];
  updatedAt: string;
}

export type ArchitectureDecisionStatus = "proposed" | "accepted" | "rejected" | "superseded" | "open";

export interface ArchitectureDecision {
  id: string;
  title: string;
  context: string;
  decision?: string;
  rationale?: string;
  status: ArchitectureDecisionStatus;
  owner?: string;
  reviewers?: string[];
  relatedEntityIds: string[];
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
}

export interface Assumption {
  id: string;
  question: string;
  context?: string;
  relatedEntityIds: string[];
  owner?: string;
  status: "open" | "resolved" | "deferred";
  resolution?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeLogEntry {
  id: string;
  timestamp: string;
  entityType: string;
  entityId: string;
  changeType: string;
  summary: string;
  origin: "manual" | "import" | "migration" | "system";
}

/** Empty module shell - every array starts empty, never null. */
export function blankExperienceModule(id: string, now: string): ExperienceModule {  return {
    id, version: 1, screens: [], assets: [], components: [], annotations: [],
    actions: [], journeys: [], transitions: [], bindings: [],
    requirements: [], states: [], createdAt: now, updatedAt: now,
  };
}

export function blankApiCatalog(id: string, now: string): ApiCatalog {
  return { id, version: 1, operations: [], dependencies: [], updatedAt: now };
}

/**
 * Named architecture snapshot: consistent module records at a point in
 * time. Image binaries stay in IDB by storage key - never duplicated.
 */
export interface ArchitectureSnapshot {
  id: string;
  label: string;
  createdAt: string;
  experience: ExperienceModule;
  apiCatalog: ApiCatalog | null;
  archDecisions: ArchitectureDecision[];
  assumptions: Assumption[];
}
