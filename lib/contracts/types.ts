/**
 * Canonical API Contract Studio model.
 *
 * One source of truth for designer, compiler, validator and exporter.
 * - Salesforce metadata: what Describe reported (see metadata-adapter).
 * - Contract configuration: what the architect chose (this file).
 * - Runtime behavior: never inferred - only what metadata + config prove.
 */

export type ContractOperation = "POST" | "PATCH";
export type IntegrationDirection = "inbound" | "outbound" | "bidirectional";
export type TransformKind =
  | "direct"
  | "trim"
  | "lowercase"
  | "uppercase"
  | "date-format"
  | "enum-map";
export type Ownership = "consumer" | "salesforce" | "shared";

export interface FieldMapping {
  /** External (consumer-side) field name. */
  externalName: string;
  /** Salesforce target field API name (canonical, never aliased away). */
  targetField: string;
  transform: TransformKind;
  /** date-format pattern, e.g. "yyyy-MM-dd". Only for date-format. */
  dateFormat?: string;
  /** external -> Salesforce value map. Only for enum-map. */
  enumMap?: Record<string, string>;
  direction: "inbound" | "outbound";
  ownership: Ownership;
  notes?: string;
}

export interface ContractFieldConfig {
  salesforceApiName: string;
  /** External contract name. Defaults to the API name. */
  externalName: string;
  label: string;
  description: string;
  /** Operations including this field. */
  operations: ContractOperation[];
  /** Business-required beyond Salesforce metadata. */
  integrationRequired: boolean;
  /** Explicit null allowed (PATCH clearing semantics). */
  nullable: boolean;
  defaultValue?: unknown;
  /** Explicit enum translation (subset or rename of describe values). */
  enumOverride?: string[];
  ownership: Ownership;
  mapping?: FieldMapping;
}

export interface OperationConfig {
  operation: ContractOperation;
  enabled: boolean;
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
}

export interface SecurityDeclaration {
  type: "oauth2-client-credentials" | "api-key" | "none";
  description: string;
}

export interface ContractProfile {
  id: string;
  name: string;
  description: string;
  targetObjectApiName: string;
  /** Org identifier / metadata context the snapshot came from. */
  orgId: string;
  consumer: string;
  direction: IntegrationDirection;
  apiTitle: string;
  /** Contract version, e.g. "1.0.0". */
  apiVersion: string;
  /** Salesforce API version, e.g. "v66.0". */
  salesforceApiVersion: string;
  /** External base URL (custom/BFF contracts). Empty = Salesforce-native. */
  baseUrl: string;
  /** External resource path (custom/BFF contracts). */
  resourcePath: string;
  operations: OperationConfig[];
  fields: ContractFieldConfig[];
  security: SecurityDeclaration;
  revision: number;
  createdAt: number;
  updatedAt: number;
  /** Hash/pointer of the metadata snapshot used. Null = never snapshotted. */
  metadataSnapshotRef: string | null;
  metadataCapturedAt: number | null;
}

/** A captured Describe result that travels with the profile (offline-safe). */
export interface MetadataSnapshot {
  ref: string;
  orgId: string;
  objectApiName: string;
  capturedAt: number;
  describe: unknown;
}
