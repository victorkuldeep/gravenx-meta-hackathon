import type { SalesforceDescribeResult, SalesforceField } from "../salesforce/types";

/**
 * Metadata adapter: normalizes the EXISTING Describe shape into contract
 * metadata. Never invents - properties Describe cannot provide
 * (record-type scoping, dependent picklists) are reported as unknown.
 */

export interface ContractFieldMeta {
  apiName: string;
  label: string;
  sfType: string;
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
  idLookup: boolean;
  autoNumber: boolean;
  referenceTo: string[];
  relationshipName: string | null;
  picklistValues: { value: string; label: string; active: boolean }[];
  restrictedPicklist: boolean;
  defaultValue: unknown;
  /** Metadata properties unavailable from Describe (never inferred). */
  unknown: string[];
}

export interface AdaptedMetadata {
  objectApiName: string;
  objectLabel: string;
  custom: boolean;
  fields: ContractFieldMeta[];
  /** Object-level unknowns (e.g. record-type scoping). */
  unknown: string[];
}

const FIELD_UNKNOWNS = ["recordTypeScoping", "dependentPicklist"] as const;

export function adaptField(f: SalesforceField): ContractFieldMeta {
  return {
    apiName: f.name,
    label: f.label,
    sfType: f.type,
    length: f.length,
    precision: f.precision,
    scale: f.scale,
    nillable: f.nillable,
    createable: f.createable,
    updateable: f.updateable,
    calculated: f.calculated,
    defaultedOnCreate: f.defaultedOnCreate,
    unique: f.unique,
    externalId: f.externalId,
    idLookup: f.idLookup,
    autoNumber: f.autoNumber,
    referenceTo: [...(f.referenceTo ?? [])],
    relationshipName: f.relationshipName,
    picklistValues: (f.picklistValues ?? []).map((p) => ({
      value: p.value,
      label: p.label,
      active: p.active !== false,
    })),
    restrictedPicklist: f.restrictedPicklist,
    defaultValue: f.defaultValue ?? null,
    unknown: [...FIELD_UNKNOWNS],
  };
}

export function adaptDescribe(d: SalesforceDescribeResult): AdaptedMetadata {
  return {
    objectApiName: d.name,
    objectLabel: d.label,
    custom: d.custom,
    fields: (d.fields ?? []).map(adaptField),
    unknown: ["recordTypeScoping"],
  };
}
