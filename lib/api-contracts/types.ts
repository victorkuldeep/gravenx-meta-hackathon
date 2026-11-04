/**
 * API Contract Architect - canonical project model.
 *
 * A project is an architecture blueprint: business intent, boundary,
 * operations with custom routes, independent request/response schemas,
 * mappings, rules, decisions, review and approval. The compiler renders
 * it deterministically; nothing here executes anything.
 *
 * Salesforce metadata is REFERENCED (object/field names + snapshot ref),
 * never embedded as approved truth. Assistant output lives in decisions
 * with explicit status - proposed suggestions never compile.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type InteractionPattern =
  | "sync-request-response"
  | "async-command"
  | "event-notification"
  | "query"
  | "batch";
export type LifecycleStatus =
  | "draft"
  | "in-design"
  | "in-review"
  | "approved"
  | "deprecated"
  | "archived";
export type ReviewState = "incomplete" | "ready" | "changes-requested" | "approved";
export type DecisionStatus =
  | "proposed"
  | "accepted"
  | "rejected"
  | "deferred"
  | "needs-clarification";
export type Ownership = "consumer" | "salesforce" | "shared";
export type TransformKind =
  | "direct"
  | "trim"
  | "lowercase"
  | "uppercase"
  | "date-format"
  | "enum-map"
  | "concat"
  | "constant";

export interface BusinessIntent {
  apiName: string;
  capability: string;
  purpose: string;
  outOfScope: string;
  businessOwner: string;
  technicalOwner: string;
  lifecycle: LifecycleStatus;
  targetRelease: string;
  constraints: string;
}

export interface Party {
  system: string;
  owner: string;
}

export interface Boundary {
  resources: string[];
  entityOriented: boolean;
  hiddenInfo: string;
  participatingObjects: string[];
}

export interface ServerDef {
  url: string;
  description: string;
}

export interface ParamDef {
  name: string;
  in: "path" | "query";
  required: boolean;
  type: string;
  description: string;
}

export interface PropertyDef {
  externalName: string;
  description: string;
  type: string;
  format?: string;
  enum?: string[];
  required: boolean;
  nullable: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  default?: unknown;
  example?: unknown;
  /** Salesforce source fact (metadata reference, not approved truth). */
  source?: { objectApiName: string; fieldApiName: string };
  mapping?: PropertyMapping;
  notes?: string;
}

export interface PropertyMapping {
  targetObject: string;
  targetField: string;
  transform: TransformKind;
  dateFormat?: string;
  enumMap?: Record<string, string>;
  direction: "inbound" | "outbound";
  ownership: Ownership;
  default?: unknown;
  nullHandling?: string;
  notes?: string;
}

export interface SchemaDef {
  name: string;
  description: string;
  properties: PropertyDef[];
}

export interface OperationDef {
  /** Stable internal id - never the route. */
  id: string;
  name: string;
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
  method: HttpMethod;
  /** Custom route, e.g. /leads/{leadId}. Independent of Salesforce paths. */
  route: string;
  resource: string;
  interaction: InteractionPattern;
  requestSchema: string | null;
  responseSchema: string | null;
  parameters: ParamDef[];
  errorResponses: string[];
  security: string[];
  status: "draft" | "ready" | "approved";
  dependencies: string[];
  notes: string;
}

export interface ErrorDef {
  name: string;
  status: number;
  code: string;
  message: string;
  retryable: boolean;
  classification: "business" | "technical";
}

export type RuleKind = "conditional-required" | "constraint-note";

export interface BusinessRule {
  id: string;
  description: string;
  kind: RuleKind;
  /** conditional-required: when field equals value, require targets. */
  whenField?: string;
  whenEquals?: unknown;
  requireFields?: string[];
  notes?: string;
}

export interface SecuritySchemeDef {
  name: string;
  kind: "oauth2" | "apiKey" | "none";
  description: string;
}

export interface RuntimeSemantics {
  rateLimit?: string;
  timeout?: string;
  retry?: string;
  idempotency?: string;
  pagination?: string;
  deprecation?: string;
}

export interface Decision {
  id: string;
  topic: string;
  question: string;
  options: string[];
  chosen: string;
  rationale: string;
  owner: string;
  status: DecisionStatus;
  /** True when produced by the assistant (needs explicit accept). */
  suggested: boolean;
  relatedOps: string[];
  createdAt: number;
  revision: number;
}

export interface ReviewFinding {
  id: string;
  category: "business" | "interface" | "data" | "behavior" | "security" | "governance";
  severity: "error" | "warning" | "info";
  message: string;
  relatedOps: string[];
}

export interface ApiProject {
  id: string;
  name: string;
  intent: BusinessIntent;
  consumer: Party;
  provider: Party;
  direction: "inbound" | "outbound" | "bidirectional";
  trustBoundary: string;
  servers: ServerDef[];
  boundary: Boundary;
  operations: OperationDef[];
  schemas: SchemaDef[];
  errors: ErrorDef[];
  rules: BusinessRule[];
  securitySchemes: SecuritySchemeDef[];
  defaultSecurity: string[];
  runtime: RuntimeSemantics;
  decisions: Decision[];
  review: { state: ReviewState; findings: ReviewFinding[] };
  approval: { state: "draft" | "approved" | "deprecated"; by: string; at: number | null };
  apiVersion: string;
  salesforceApiVersion: string;
  /** Metadata snapshot refs consumed (object -> ref). Facts stay in snapshots. */
  metadataRefs: Record<string, string>;
  version: number;
  createdAt: number;
  updatedAt: number;
}
