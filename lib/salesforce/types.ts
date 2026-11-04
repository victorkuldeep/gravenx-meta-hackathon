export type OperationType = "POST" | "PATCH";

export interface SalesforceConnection {
  instanceUrl: string;
  apiVersion: string;
  connected: boolean;
  objectCount?: number;
}

export interface SalesforceObject {
  name: string;
  label: string;
  labelPlural: string;
  custom: boolean;
  /** True for list/hierarchy custom settings. Absent on vintage caches. */
  customSetting?: boolean;
  createable: boolean;
  updateable: boolean;
  queryable: boolean;
  deletable: boolean;
  urls: Record<string, string>;
}

export interface SalesforcePicklistValue {
  active: boolean;
  defaultValue: boolean;
  label: string;
  value: string;
  validFor: string | null;
}

export interface SalesforceField {
  name: string;
  label: string;
  /** True for custom fields - present in describe payloads, used for audit fallback. Absent on vintage caches. */
  custom?: boolean;
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
  picklistValues: SalesforcePicklistValue[];
  restrictedPicklist: boolean;
  autoNumber: boolean;
  idLookup: boolean;
  filterable: boolean;
  sortable: boolean;
  groupable: boolean;
  nameField: boolean;
  htmlFormatted: boolean;
  deprecatedAndHidden: boolean;
  digits: number;
  byteLength: number;
  inlineHelpText: string | null;
  defaultValue: unknown;
  soapType: string;
}

export interface SalesforceChildRelationship {
  childSObject: string;
  field: string;
  relationshipName: string | null;
  /** True when the child is in a master-detail with the parent. */
  cascadeDelete: boolean;
}

export interface SalesforceRecordTypeInfo {
  recordTypeId: string;
  developerName: string;
  name: string;
  active: boolean;
  master: boolean;
  defaultRecordTypeMapping: boolean;
}

export interface SalesforceDescribeResult {
  name: string;
  label: string;
  labelPlural: string;
  custom: boolean;
  /** True for custom settings (list + hierarchy). Absent on vintage caches. */
  customSetting?: boolean;
  createable: boolean;
  updateable: boolean;
  fields: SalesforceField[];
  childRelationships: SalesforceChildRelationship[];
  /** Record types on the object, when the org describe carries them. */
  recordTypeInfos?: SalesforceRecordTypeInfo[];
}

export class SalesforceApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorCode?: string,
    public readonly fields?: string[]
  ) {
    super(message);
    this.name = "SalesforceApiError";
  }
}

export interface GeneratedPayload {
  operation: OperationType;
  objectName: string;
  endpoint: string;
  payload: Record<string, unknown>;
  recordId?: string;
}

export interface ApiVersionInfo {
  label: string;
  url: string;
  version: string;
}

export interface SalesforceErrorResponse {
  message: string;
  errorCode: string;
  fields?: string[];
}

export interface TestRequestResult {
  status: number;
  statusText: string;
  responseTime: number;
  body: unknown;
  headers: Record<string, string>;
  success: boolean;
}

// ── Composite API ────────────────────────────────────────────────────────────

export type CompositeMethod = "POST" | "PATCH" | "GET" | "DELETE";

export interface CompositeSubRequest {
  /** Stable internal ID (uuid) */
  id: string;
  /** Salesforce referenceId used in @{referenceId.id} cross-references */
  referenceId: string;
  method: CompositeMethod;
  objectName: string;
  describe: SalesforceDescribeResult | null;
  selectedFieldNames: Set<string>;
  fieldValues: Record<string, unknown>;
  /** Required for PATCH / DELETE */
  recordId: string;
}

export interface CompositePayload {
  allOrNone: boolean;
  compositeRequest: CompositeRequestItem[];
}

export interface CompositeRequestItem {
  method: CompositeMethod;
  url: string;
  referenceId: string;
  body?: Record<string, unknown>;
}
