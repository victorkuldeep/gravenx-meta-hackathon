import { describe, expect, it } from "vitest";
import { buildFieldDictionaryWorkbook } from "./fieldDictionary";
import type { SalesforceDescribeResult, SalesforceField } from "./types";

const field = (f: Partial<SalesforceField> & { name: string }): SalesforceField => ({
  label: f.name,
  type: "string",
  length: 0,
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
  ...f,
});

const describeOf = (
  name: string,
  fields: SalesforceField[],
  childRelationships: SalesforceDescribeResult["childRelationships"] = [],
): SalesforceDescribeResult => ({
  name,
  label: name,
  labelPlural: name,
  custom: false,
  createable: true,
  updateable: true,
  fields,
  childRelationships,
});

describe("field dictionary", () => {
  const account = describeOf(
    "Account",
    [
      field({ name: "Name", label: "Account Name", type: "string", nillable: false, length: 255 }),
      field({
        name: "Industry",
        label: "Industry",
        type: "picklist",
        picklistValues: [
          { active: true, defaultValue: false, label: "Technology", value: "Technology", validFor: null },
          { active: true, defaultValue: false, label: "Banking", value: "Banking", validFor: null },
          { active: false, defaultValue: false, label: "Old", value: "Old", validFor: null },
        ],
      }),
    ],
    [{ childSObject: "Contact", field: "AccountId", relationshipName: "Contacts", cascadeDelete: false }],
  );
  const contact = describeOf("Contact", [
    field({ name: "AccountId", label: "Account ID", type: "reference", referenceTo: ["Account"], relationshipName: "Account" }),
  ]);

  it("covers the canvas with summary, relationships, and one sheet per object", async () => {
    const wb = await buildFieldDictionaryWorkbook(new Map([["Account", account], ["Contact", contact]]).values(), {
      org: "demo@org",
      exportedAt: "2026-01-01",
    });
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Relationships", "Account", "Contact"]);
    const summary = wb.getWorksheet("Summary")!;
    expect(summary.getRow(4).values).toEqual([undefined, "Objects", 2]);
    const rel = wb.getWorksheet("Relationships")!;
    expect(rel.getRow(2).values).toEqual([undefined, "Account", "Contact", "AccountId", "Lookup", "Contacts"]);
    const acc = wb.getWorksheet("Account")!;
    expect(acc.getRow(1).values).toEqual([
      undefined, "Field Label", "API Name", "Type", "Length", "Required", "Unique",
      "External ID", "Reference To", "Picklist Values", "Default Value", "Help Text",
    ]);
    expect(acc.getRow(2).values).toEqual([
      undefined, "Account Name", "Name", "string", 255, "Y", "no", "no", "", "", "", "",
    ]);
    expect(acc.getRow(3).getCell(9).value).toBe("Technology; Banking [+1 inactive]");
    const con = wb.getWorksheet("Contact")!;
    expect(con.getRow(2).getCell(8).value).toBe("Account");
  });
});
