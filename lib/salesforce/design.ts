/**
 * Schema authoring contract (Design mode): Tooling API payload builders,
 * naming validation, and result parsing for CustomField / CustomObject
 * creates. Pure functions only - no network. Deploys go through the
 * existing `/api/salesforce/rest` proxy (org scope, `/services/` paths).
 */

export type DesignFieldType =
  | "Text"
  | "TextArea"
  | "LongTextArea"
  | "Number"
  | "Percent"
  | "Currency"
  | "Checkbox"
  | "Date"
  | "DateTime"
  | "Email"
  | "Phone"
  | "Url"
  | "Picklist"
  | "Lookup"
  | "MasterDetail";

export const DESIGN_FIELD_TYPES: { value: DesignFieldType; label: string }[] = [
  { value: "Text", label: "Text" },
  { value: "TextArea", label: "Text Area" },
  { value: "LongTextArea", label: "Long Text Area" },
  { value: "Number", label: "Number" },
  { value: "Percent", label: "Percent" },
  { value: "Currency", label: "Currency" },
  { value: "Checkbox", label: "Checkbox" },
  { value: "Date", label: "Date" },
  { value: "DateTime", label: "Date/Time" },
  { value: "Email", label: "Email" },
  { value: "Phone", label: "Phone" },
  { value: "Url", label: "URL" },
  { value: "Picklist", label: "Picklist" },
  { value: "Lookup", label: "Lookup Relationship" },
  { value: "MasterDetail", label: "Master-Detail Relationship" },
];

export type AuthorKind = "field" | "object" | "relationship";

export type AuthorStatus = "draft" | "deploying" | "live" | "failed";

export interface AuthorChange {
  id: string;
  kind: AuthorKind;
  status: AuthorStatus;
  /** Human summary, e.g. "Account.Risk_Score__c (Number)". */
  label: string;
  /** Object the change lands on (or the new object's API name). */
  targetApi: string;
  /** Tooling sobject type: "CustomField" | "CustomObject". */
  toolingType: "CustomField" | "CustomObject";
  /** Request body for POST /tooling/sobjects/<toolingType>. */
  body: Record<string, unknown>;
  error?: string;
}

export interface FieldDraft {
  label: string;
  apiName: string;
  type: DesignFieldType;
  required: boolean;
  unique: boolean;
  externalId: boolean;
  length: number;
  precision: number;
  scale: number;
  defaultCheckbox: boolean;
  defaultText: string;
  picklistValues: string[];
  picklistDefault: string;
  picklistRestricted: boolean;
  /** Lookup / MasterDetail target object API name. */
  referenceTo: string;
  relationshipLabel: string;
  relationshipName: string;
  reparentable: boolean;
}

export function defaultFieldDraft(): FieldDraft {
  return {
    label: "",
    apiName: "",
    type: "Text",
    required: false,
    unique: false,
    externalId: false,
    length: 255,
    precision: 18,
    scale: 0,
    defaultCheckbox: false,
    defaultText: "",
    picklistValues: [],
    picklistDefault: "",
    picklistRestricted: false,
    referenceTo: "",
    relationshipLabel: "",
    relationshipName: "",
    reparentable: true,
  };
}

export interface ObjectDraft {
  label: string;
  pluralLabel: string;
  apiName: string;
  description: string;
  nameFieldLabel: string;
  deploymentStatus: "Deployed" | "InDevelopment";
  sharingModel: "ReadWrite" | "Read" | "Private";
}

export function defaultObjectDraft(): ObjectDraft {
  return {
    label: "",
    pluralLabel: "",
    apiName: "",
    description: "",
    nameFieldLabel: "Name",
    deploymentStatus: "Deployed",
    sharingModel: "ReadWrite",
  };
}

const API_CHARS = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Custom API names: start with a letter, alphanumerics/underscores, end __c, max 40 chars. */
export function validateCustomApiName(apiName: string): string | null {
  const v = apiName.trim();
  if (!v) return "API name is required.";
  if (!v.endsWith("__c")) return "Custom API names must end with __c.";
  if (v.length > 40) return "API names are limited to 40 characters.";
  if (!API_CHARS.test(v)) return "Use letters, numbers, and underscores, starting with a letter.";
  if (/__c.+__c/.test(v)) return "Only one __c suffix is allowed.";
  return null;
}

/** Relationship names: no __c suffix, no __r either - Salesforce appends it. */
export function validateRelationshipName(name: string): string | null {
  const v = name.trim();
  if (!v) return "Relationship name is required.";
  if (v.endsWith("__c") || v.endsWith("__r")) return "Relationship name must not end with __c or __r.";
  if (v.length > 40) return "Relationship names are limited to 40 characters.";
  if (!API_CHARS.test(v)) return "Use letters, numbers, and underscores, starting with a letter.";
  return null;
}

/** "Risk Score" -> "Risk_Score__c". */
export function apiNameFromLabel(label: string): string {
  const base = label
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  const stem = /^[A-Za-z]/.test(base) ? base : `X${base}`;
  const candidate = `${stem}__c`;
  return candidate.length > 40 ? `${candidate.slice(0, 35)}__c` : candidate;
}

/** "Risk_Score__c" -> "Risk Score". */
export function labelFromApiName(apiName: string): string {
  return apiName
    .replace(/__c$/i, "")
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** "Risk_Score__c" -> "Risk_Scores" (relationship name, no suffix). */
export function relationshipNameFromField(fieldApi: string): string {
  const stem = fieldApi.trim().replace(/__c$/i, "");
  return /^[A-Za-z]/.test(stem) ? stem : `X${stem}`;
}

export function validateFieldDraft(
  draft: FieldDraft,
  opts: { isRelationship: boolean }
): string | null {
  if (!draft.label.trim()) return "Label is required.";
  const apiErr = validateCustomApiName(draft.apiName);
  if (apiErr) return apiErr;
  if (draft.type === "Picklist" && draft.picklistValues.length === 0) {
    return "Add at least one picklist value.";
  }
  if (draft.type === "Picklist" && draft.picklistDefault) {
    const values = new Set(draft.picklistValues.map((v) => v.trim().toLowerCase()));
    if (!values.has(draft.picklistDefault.trim().toLowerCase())) {
      return "The default must be one of the picklist values.";
    }
  }
  if (draft.type === "Number" || draft.type === "Currency" || draft.type === "Percent") {
    if (draft.precision < 1 || draft.precision > 18) return "Precision must be 1-18 digits.";
    if (draft.scale < 0 || draft.scale > draft.precision) return "Decimals must be 0-precision.";
  }
  if (draft.type === "LongTextArea") {
    if (draft.length < 256 || draft.length > 131072) return "Long text length must be 256-131072.";
  } else if (draft.length < 1 || draft.length > 255) {
    return "Length must be 1-255.";
  }
  if (opts.isRelationship) {
    if (!draft.referenceTo.trim()) return "Choose the related object.";
    const relErr = validateRelationshipName(draft.relationshipName);
    if (relErr) return relErr;
    if (!draft.relationshipLabel.trim()) return "Relationship label is required.";
  }
  return null;
}

export function validateObjectDraft(draft: ObjectDraft): string | null {
  if (!draft.label.trim()) return "Label is required.";
  if (!draft.pluralLabel.trim()) return "Plural label is required.";
  const apiErr = validateCustomApiName(draft.apiName);
  if (apiErr) return apiErr;
  if (!draft.nameFieldLabel.trim()) return "Record name label is required.";
  return null;
}

function versioned(ver: string): string {
  const v = ver.trim().startsWith("v") ? ver.trim() : `v${ver.trim()}`;
  return v;
}

function fieldMetadata(draft: FieldDraft, objectApi: string): Record<string, unknown> {
  const fullName = `${objectApi}.${draft.apiName.trim()}`;
  const meta: Record<string, unknown> = {
    fullName,
    label: draft.label.trim(),
    type: draft.type,
  };
  switch (draft.type) {
    case "Text":
    case "TextArea":
    case "LongTextArea":
    case "Email":
    case "Phone":
    case "Url":
      meta.length = draft.length;
      meta.required = draft.required;
      if (draft.type === "Text" || draft.type === "Email" || draft.type === "Url") {
        meta.unique = draft.unique;
        meta.externalId = draft.externalId;
      }
      if (draft.defaultText.trim()) meta.defaultValue = draft.defaultText.trim();
      break;
    case "Number":
    case "Currency":
    case "Percent":
      meta.precision = draft.precision;
      meta.scale = draft.scale;
      meta.required = draft.required;
      if (draft.type === "Number") {
        meta.unique = draft.unique;
        meta.externalId = draft.externalId;
      }
      break;
    case "Checkbox":
      meta.defaultValue = draft.defaultCheckbox;
      break;
    case "Date":
    case "DateTime":
      meta.required = draft.required;
      break;
    case "Picklist": {
      const values = draft.picklistValues.map((v) => v.trim()).filter(Boolean);
      meta.valueSet = {
        restricted: draft.picklistRestricted,
        valueSetDefinition: {
          sorted: false,
          value: values.map((v) => ({
            fullName: v,
            label: v,
            default: draft.picklistDefault.trim().toLowerCase() === v.toLowerCase(),
          })),
        },
      };
      meta.required = draft.required;
      break;
    }
    case "Lookup":
    case "MasterDetail":
      meta.referenceTo = draft.referenceTo.trim();
      meta.relationshipName = draft.relationshipName.trim();
      meta.relationshipLabel = draft.relationshipLabel.trim();
      if (draft.type === "Lookup") {
        meta.required = draft.required;
        meta.deleteConstraint = "SetNull";
      } else {
        meta.reparentableMasterDetail = draft.reparentable;
        meta.writeRequiresMasterRead = false;
      }
      break;
  }
  return meta;
}

/** Build the Tooling CustomField create body for a field on an existing object. */
export function buildCustomFieldBody(draft: FieldDraft, objectApi: string): Record<string, unknown> {
  const fullName = `${objectApi}.${draft.apiName.trim()}`;
  return {
    FullName: fullName,
    Metadata: fieldMetadata(draft, objectApi),
  };
}

/** Build the Tooling CustomObject create body. */
export function buildCustomObjectBody(draft: ObjectDraft): Record<string, unknown> {
  const api = draft.apiName.trim();
  return {
    FullName: api,
    Metadata: {
      fullName: api,
      label: draft.label.trim(),
      pluralLabel: draft.pluralLabel.trim(),
      description: draft.description.trim() || undefined,
      nameField: {
        label: draft.nameFieldLabel.trim(),
        type: "Text",
        displayLines: 1,
      },
      deploymentStatus: draft.deploymentStatus,
      sharingModel: draft.sharingModel,
    },
  };
}

/** REST proxy path for a Tooling create. */
export function toolingCreatePath(apiVersion: string, toolingType: "CustomField" | "CustomObject"): string {
  return `/services/data/${versioned(apiVersion)}/tooling/sobjects/${toolingType}`;
}

export interface ToolingResult {
  ok: boolean;
  id: string | null;
  message: string;
}

/** Normalize a Tooling create response ({ id, success, errors[] }) into a result. */
export function parseToolingResult(payload: unknown, httpOk: boolean, httpStatus?: number): ToolingResult {
  const body = payload as
    | { id?: unknown; success?: unknown; errors?: unknown; message?: unknown }
    | null
    | undefined;
  if (!httpOk || !body || body.success !== true) {
    const errs = Array.isArray(body?.errors)
      ? (body.errors as { message?: unknown }[])
          .map((e) => (typeof e.message === "string" ? e.message : ""))
          .filter(Boolean)
      : [];
    const fallback =
      typeof body?.message === "string" && body.message
        ? body.message
        : `Deploy failed (HTTP ${httpStatus ?? "?"})`;
    return { ok: false, id: null, message: errs.length > 0 ? errs.join("; ") : fallback };
  }
  return {
    ok: true,
    id: typeof body.id === "string" ? body.id : null,
    message: "Deployed.",
  };
}

/** Heuristic: sandbox / scratch / test orgs get a light touch, everything else warns as production. */
export function looksLikeSandbox(instanceUrl: string): boolean {
  return /sandbox|scratch|test\.salesforce\.com/i.test(instanceUrl);
}

/** Display type for a pending sketch row, mirroring describe `type` values. */
export function describeTypeFor(t: DesignFieldType): string {
  switch (t) {
    case "Text":
      return "string";
    case "TextArea":
    case "LongTextArea":
      return "textarea";
    case "Number":
      return "double";
    case "Percent":
      return "percent";
    case "Currency":
      return "currency";
    case "Checkbox":
      return "boolean";
    case "Date":
      return "date";
    case "DateTime":
      return "datetime";
    case "Email":
      return "email";
    case "Phone":
      return "phone";
    case "Url":
      return "url";
    case "Picklist":
      return "picklist";
    case "Lookup":
    case "MasterDetail":
      return "reference";
  }
}

function sketchField(name: string, label: string, type: string, extra?: Record<string, unknown>) {
  return {
    name,
    label,
    type,
    length: 255,
    precision: 0,
    scale: 0,
    nillable: true,
    createable: true,
    updateable: true,
    calculated: false,
    defaultedOnCreate: false,
    unique: false,
    externalId: false,
    referenceTo: [],
    relationshipName: null,
    picklistValues: [],
    restrictedPicklist: false,
    autoNumber: false,
    idLookup: false,
    filterable: true,
    sortable: true,
    groupable: false,
    nameField: false,
    htmlFormatted: false,
    deprecatedAndHidden: false,
    digits: 0,
    byteLength: 0,
    inlineHelpText: null,
    defaultValue: null,
    soapType: "xsd:string",
    ...extra,
  };
}

/**
 * Synthetic describe for a not-yet-deployed object sketch. Renders through the
 * normal ERD pipeline; flagged so autosave never persists it and deploys can
 * roll it back. Replaced by the live describe on deploy success.
 */
export function syntheticDescribeForObject(draft: ObjectDraft) {
  const api = draft.apiName.trim();
  return {
    __authorSketch: true as const,
    name: api,
    label: draft.label.trim(),
    labelPlural: draft.pluralLabel.trim(),
    custom: true,
    createable: false,
    updateable: false,
    fields: [
      sketchField("Id", "Record ID", "id", { nillable: false }),
      sketchField("Name", draft.nameFieldLabel.trim() || "Name", "string", {
        nillable: false,
        nameField: true,
      }),
    ],
    childRelationships: [],
  };
}

let authorSeq = 0;

/** Fresh client id for an author change (per session, collision-free). */
export function newAuthorId(): string {
  authorSeq += 1;
  return `author-${Date.now().toString(36)}-${authorSeq}`;
}
