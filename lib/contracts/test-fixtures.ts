import type { SalesforceDescribeResult, SalesforceField } from "../salesforce/types";

/**
 * Synthetic Lead describe covering the compiler test matrix:
 * ordinary strings/booleans, picklists (open + restricted), a required
 * lookup, currency/decimal precision, date/datetime, non-createable,
 * non-updateable, polymorphic reference, nullable and unique fields.
 */

const f = (over: Partial<SalesforceField>): SalesforceField => ({
  name: "X",
  label: "X",
  type: "string",
  length: 80,
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
  groupable: true,
  nameField: false,
  htmlFormatted: false,
  deprecatedAndHidden: false,
  digits: 0,
  byteLength: 0,
  inlineHelpText: null,
  defaultValue: null,
  soapType: "xsd:string",
  ...over,
});

const pick = (value: string, active = true) => ({
  value,
  label: value,
  active,
  defaultValue: false,
  validFor: null as string | null,
});

export function leadDescribeFixture(): SalesforceDescribeResult {
  return {
    name: "Lead",
    label: "Lead",
    labelPlural: "Leads",
    custom: false,
    createable: true,
    updateable: true,
    childRelationships: [],
    fields: [
      f({ name: "FirstName", label: "First Name", type: "string", length: 40 }),
      f({ name: "LastName", label: "Last Name", type: "string", length: 80, nillable: false }),
      f({ name: "Company", label: "Company", type: "string", length: 255, nillable: false }),
      f({ name: "Email", label: "Email", type: "email", length: 80 }),
      f({ name: "HasOptedOutOfEmail", label: "Email Opt Out", type: "boolean" }),
      f({
        name: "Status", label: "Status", type: "picklist", nillable: false,
        picklistValues: [pick("New"), pick("Contacted"), pick("Old", false)],
      }),
      f({
        name: "Rating", label: "Rating", type: "picklist", restrictedPicklist: true,
        picklistValues: [pick("Hot"), pick("Warm"), pick("Cold")],
      }),
      f({ name: "AnnualRevenue", label: "Annual Revenue", type: "currency", precision: 18, scale: 2 }),
      f({ name: "NumberOfEmployees", label: "Employees", type: "int", precision: 8, scale: 0 }),
      f({ name: "Birthdate", label: "Birthdate", type: "date" }),
      f({ name: "LastActivityDate", label: "Last Activity", type: "datetime", updateable: false }),
      f({ name: "CreatedDate", label: "Created Date", type: "datetime", createable: false, updateable: false }),
      f({
        name: "OwnerId", label: "Owner ID", type: "reference", nillable: false,
        referenceTo: ["User"], relationshipName: "Owner",
      }),
      // Polymorphic reference (WhatId-style).
      f({
        name: "RelatedToId", label: "Related To", type: "reference",
        referenceTo: ["Account", "Opportunity"], relationshipName: "RelatedTo",
      }),
      f({ name: "Website", label: "Website", type: "url", length: 255 }),
      f({ name: "Description", label: "Description", type: "longtextarea", length: 32000 }),
      // Required lookup (custom object pattern).
      f({
        name: "Primary_Campaign__c", label: "Primary Campaign", type: "reference", nillable: false,
        referenceTo: ["Campaign"], relationshipName: "Primary_Campaign__r",
      }),
      f({ name: "External_Key__c", label: "External Key", type: "string", unique: true, externalId: true }),
    ],
  };
}
