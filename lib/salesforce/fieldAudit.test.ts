import { describe, expect, it } from "vitest";
import { buildExplorerSheets, fieldAuditQuery, parseAuditEnvelope, parseFieldAudit } from "./fieldAudit";
import type { SalesforceDescribeResult } from "./types";

describe("fieldAuditQuery", () => {
  it("targets CustomField rows for the object", () => {
    const q = fieldAuditQuery("Invoice__c");
    expect(q).toContain("FROM CustomField");
    expect(q).toContain("EntityDefinition.QualifiedApiName = 'Invoice__c'");
    expect(q).toContain("CreatedBy.Name");
  });

  it("escapes quotes in the object name", () => {
    expect(fieldAuditQuery("O'Brien__c")).toContain("O\\'Brien__c");
  });
});

describe("parseFieldAudit", () => {
  it("indexes rows by describe-style API name", () => {
    const out = parseFieldAudit([
      {
        DeveloperName: "Risk_Level",
        NamespacePrefix: null,
        CreatedDate: "2024-01-02T00:00:00.000+0000",
        CreatedBy: { Name: "Kuldeep Singh" },
        LastModifiedDate: "2024-02-03T00:00:00.000+0000",
        LastModifiedBy: { Name: "Archana" },
      },
      { DeveloperName: "Ext_Id", NamespacePrefix: "acme", CreatedDate: "2023-05-01T00:00:00.000+0000" },
    ]);
    expect(out["Risk_Level__c"]).toMatchObject({ createdBy: "Kuldeep Singh", modifiedBy: "Archana" });
    expect(out["acme__Ext_Id__c"]?.createdDate).toContain("2023-05-01");
    expect(out["Risk_Level__c"]?.modifiedDate).toContain("2024-02-03");
  });

  it("skips rows without a developer name and keeps the first duplicate", () => {
    const out = parseFieldAudit([
      { DeveloperName: "", CreatedDate: "2024-01-01T00:00:00.000+0000" },
      { DeveloperName: "X", CreatedBy: { Name: "first" } },
      { DeveloperName: "X", CreatedBy: { Name: "second" } },
    ]);
    expect(out["X__c"]?.createdBy).toBe("first");
    expect(Object.keys(out)).toEqual(["X__c"]);
  });
});

const invoiceDescribe: SalesforceDescribeResult = {
  name: "Invoice__c",
  label: "Invoice",
  labelPlural: "Invoices",
  custom: true,
  createable: true,
  updateable: true,
  fields: [
    {
      name: "Risk_Level__c",
      label: "Risk Level",
      custom: true,
      type: "picklist",
      length: 255,
      precision: 0,
      scale: 0,
      nillable: false,
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
    },
  ],
  childRelationships: [],
};

describe("parseAuditEnvelope", () => {
  const row = {
    DeveloperName: "AM_Service",
    NamespacePrefix: null,
    CreatedDate: "2025-03-03T10:10:16.000+0000",
    CreatedBy: { Name: "Kuldeep Singh" },
    LastModifiedDate: "2025-03-04T10:10:16.000+0000",
    LastModifiedBy: { Name: "Kuldeep Singh" },
  };

  it("unwraps the REST-proxy envelope into the audit map", () => {
    const out = parseAuditEnvelope({ success: true, status: 200, body: { records: [row] } });
    expect(out["AM_Service__c"]).toMatchObject({ createdBy: "Kuldeep Singh", modifiedBy: "Kuldeep Singh" });
  });

  it("throws with the proxy message on failure so the UI explains the blanks", () => {
    expect(() => parseAuditEnvelope({ success: false, status: 400, error: "No such column" })).toThrow("No such column");
  });

  it("treats a missing body as no rows rather than crashing", () => {
    expect(parseAuditEnvelope({ success: true, status: 200 })).toEqual({});
  });
});

describe("buildExplorerSheets", () => {
  it("adds audit columns with Salesforce fallback for unaudited fields", () => {
    const sheets = buildExplorerSheets(invoiceDescribe, {
      Risk_Level__c: { createdDate: "2024-01-02", createdBy: "Kuldeep Singh", modifiedDate: null, modifiedBy: null },
    });
    const fields = sheets.find((s) => s.name === "Invoice");
    expect(fields?.header).toContain("Created By");
    expect(fields?.header).toContain("Modified Date");
    const row = fields?.rows[0] as unknown[];
    expect(row.slice(-4)).toEqual(["Kuldeep Singh", "2024-01-02", "—", "—"]);
    const summary = sheets.find((s) => s.name === "Summary");
    expect(summary?.rows).toContainEqual(["With audit", 1]);
  });
});
