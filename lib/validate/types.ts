/**
 * Validate workspace - canonical contract model.
 *
 * UI-independent normalized representation of an uploaded API contract
 * (OpenAPI 3.0 / 3.1 JSON or YAML). Compiled AJV functions are NEVER
 * stored here; they live in the engine cache keyed by schema identity.
 */

export type ContractFormat = "openapi-json" | "openapi-yaml" | "json-schema";

export type ValidationDirection = "request" | "response";

export type ContractStatus =
  | "parsed"
  | "parsed-with-warnings"
  | "invalid"
  | "unsupported";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface ContractDiagnostic {
  id: string;
  severity: DiagnosticSeverity;
  /** Location in the spec, e.g. "#/paths/~1orders/post". */
  location?: string;
  message: string;
  /** True when validation cannot be trusted until this is resolved. */
  blocking: boolean;
  hint?: string;
}

export interface ParameterDefinition {
  name: string;
  in: "query" | "header" | "path" | "cookie";
  required: boolean;
}

export interface ContentDefinition {
  mediaType: string;
  /** Resolved (dereferenced + adapted) schema, or undefined when unsupported. */
  schema?: unknown;
  supported: boolean;
  diagnostics: ContractDiagnostic[];
}

export interface RequestDefinition {
  required?: boolean;
  contentTypes: ContentDefinition[];
}

export interface ResponseDefinition {
  statusCode: string;
  description?: string;
  contentTypes: ContentDefinition[];
}

export interface Operation {
  /** Stable id: METHOD + path, collision-suffixed. Never an array index. */
  id: string;
  path: string;
  method: string;
  operationId?: string;
  summary?: string;
  description?: string;
  parameters: ParameterDefinition[];
  request?: RequestDefinition;
  responses: ResponseDefinition[];
  diagnostics: ContractDiagnostic[];
}

export interface ParsedContract {
  id: string;
  name: string;
  format: ContractFormat;
  /** e.g. "3.0.3", "3.1.0". */
  version?: string;
  /** JSON Schema dialect URL used for validation, when known. */
  dialect?: string;
  originalText: string;
  operations: Operation[];
  diagnostics: ContractDiagnostic[];
  status: ContractStatus;
  schemaCount: number;
}

export interface ValidationTarget {
  operationId: string;
  direction: ValidationDirection;
  statusCode?: string;
  mediaType: string;
  /** Stable schema identity for the engine cache. */
  schemaId: string;
  dialect: string;
  /** The exact resolved schema to compile. */
  schema: unknown;
}

export type FindingSeverity = "error" | "warning" | "info";

export type FindingSource = "schema" | "contract" | "compatibility";

export interface ValidationFinding {
  id: string;
  severity: FindingSeverity;
  source: FindingSource;
  /** JSON Pointer into the payload, e.g. "/customer/address/postalCode". */
  path: string;
  keyword?: string;
  rule?: string;
  message: string;
  expected?: unknown;
  actual?: unknown;
  schemaPath?: string;
  operationId?: string;
  direction?: ValidationDirection;
  statusCode?: string;
  mediaType?: string;
}

export type ValidationOutcome = "valid" | "invalid" | "inconclusive" | "not-run";

export interface ValidationReport {
  outcome: ValidationOutcome;
  findings: ValidationFinding[];
  errors: number;
  warnings: number;
  infos: number;
  /** Wall-clock ms, measured around AJV validation only. */
  durationMs: number;
  target: ValidationTarget;
  stale: boolean;
}
