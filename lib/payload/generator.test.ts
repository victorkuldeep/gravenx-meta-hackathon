import { describe, it, expect } from "vitest";
import type { SalesforceField } from "../salesforce/types";
import {
  generatePayload,
  deriveReferenceId,
  uniqueReferenceId,
  generateCompositePayload,
  generateEndpoint,
} from "./generator";

const field = (over: Partial<SalesforceField>): SalesforceField => ({
  name: "X",
  label: "X",
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
  idLookup: true,
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

describe("deriveReferenceId", () => {
  it("lowercases standard objects", () => {
    expect(deriveReferenceId("Account")).toBe("account");
  });
  it("drops __c from custom objects", () => {
    expect(deriveReferenceId("Pricing_Request__c")).toBe("pricingRequest");
  });
  it("handles __r separator", () => {
    expect(deriveReferenceId("Big_Object__c")).toBe("bigObject");
  });
  it("collapses double underscores into single", () => {
    expect(deriveReferenceId("A__B__c")).toBe("aB");
  });
});

describe("generatePayload", () => {
  const fields = [
    field({ name: "Name", type: "string", createable: true, updateable: true }),
    field({ name: "Amount", type: "double", createable: true, updateable: true }),
    field({ name: "Count", type: "int", createable: true, updateable: true }),
    field({ name: "Active", type: "boolean", createable: true, updateable: true }),
    field({ name: "Id", createable: false, updateable: false }),
    field({ name: "SkipMe", type: "string", createable: true, updateable: true }),
  ];

  it("includes only writable fields with values", () => {
    const out = generatePayload(
      fields,
      { Name: "Acme", Amount: "10.5", Count: "3", Active: true, SkipMe: "" },
      "POST"
    );
    expect(out).toEqual({
      Name: "Acme",
      Amount: 10.5,
      Count: 3,
      Active: true,
    });
  });

  it("PATCH honors updateable", () => {
    const out = generatePayload(fields, { Name: "Acme" }, "PATCH");
    expect(out).toEqual({ Name: "Acme" });
  });

  it("coerces boolean from string", () => {
    const out = generatePayload([field({ name: "B", type: "boolean", createable: true })], { B: "true" }, "POST");
    expect(out.B).toBe(true);
  });

  it("skips NaN numerics gracefully", () => {
    const out = generatePayload(
      [field({ name: "N", type: "double", createable: true })],
      { N: "abc" },
      "POST"
    );
    expect(out).toEqual({});
  });
});

describe("generateEndpoint", () => {
  it("POST omits id", () => {
    expect(
      generateEndpoint("https://x.com/", "v66.0", "Account", "POST")
    ).toBe("https://x.com/services/data/v66.0/sobjects/Account");
  });
  it("PATCH requires id", () => {
    expect(
      generateEndpoint("https://x.com/", "66.0", "Account", "PATCH", "001ABC")
    ).toBe("https://x.com/services/data/v66.0/sobjects/Account/001ABC");
  });
  it("prepends v when missing", () => {
    expect(generateEndpoint("https://x.com/", "66.0", "Account", "POST")).toContain(
      "/v66.0/"
    );
  });
});

describe("generateCompositePayload", () => {
  it("builds ordered compositeRequest with allOrNone", () => {
    const describe = { name: "Account", fields: [field({ name: "Name", createable: true })] } as never;
    const payload = generateCompositePayload(
      [
        {
          id: "1",
          referenceId: "newAcct",
          method: "POST",
          objectName: "Account",
          describe,
          selectedFieldNames: new Set(["Name"]),
          fieldValues: { Name: "Acme" },
          recordId: "",
        },
      ],
      "v66.0",
      true
    );
    expect(payload.allOrNone).toBe(true);
    expect(payload.compositeRequest).toHaveLength(1);
    expect(payload.compositeRequest[0]).toMatchObject({
      method: "POST",
      referenceId: "newAcct",
      url: "/services/data/v66.0/sobjects/Account",
    });
    expect(payload.compositeRequest[0].body).toEqual({ Name: "Acme" });
  });

  it("skips sub-requests without describe", () => {
    const payload = generateCompositePayload(
      [
        {
          id: "1",
          referenceId: "x",
          method: "POST",
          objectName: "Account",
          describe: null,
          selectedFieldNames: new Set(),
          fieldValues: {},
          recordId: "",
        },
      ],
      "v66.0",
      false
    );
    expect(payload.compositeRequest).toEqual([]);
  });

  it("PATCH includes id in URL and body", () => {
    const describe = { name: "Account", fields: [field({ name: "Name", updateable: true })] } as never;
    const payload = generateCompositePayload(
      [
        {
          id: "1",
          referenceId: "upd",
          method: "PATCH",
          objectName: "Account",
          describe,
          selectedFieldNames: new Set(["Name"]),
          fieldValues: { Name: "New" },
          recordId: "001ABC",
        },
      ],
      "v66.0",
      false
    );
    expect(payload.compositeRequest[0]).toMatchObject({
      method: "PATCH",
      url: "/services/data/v66.0/sobjects/Account/001ABC",
    });
  });

  it("GET / DELETE have no body", () => {
    const describe = { name: "Account", fields: [] } as never;
    const payload = generateCompositePayload(
      [
        {
          id: "1",
          referenceId: "g",
          method: "GET",
          objectName: "Account",
          describe,
          selectedFieldNames: new Set(),
          fieldValues: {},
          recordId: "001",
        },
      ],
      "v66.0",
      false
    );
    expect(payload.compositeRequest[0].body).toBeUndefined();
  });
});

describe("uniqueReferenceId", () => {
  it("always suffixes, starting at _1", () => {
    expect(uniqueReferenceId("pricingRequest", new Set())).toBe("pricingRequest_1");
    expect(uniqueReferenceId("requestTerm", ["requestTerm_1"])).toBe("requestTerm_2");
    expect(uniqueReferenceId("requestTerm", ["requestTerm_1", "requestTerm_2"])).toBe(
      "requestTerm_3"
    );
  });
  it("falls back for empty base", () => {
    expect(uniqueReferenceId("", new Set())).toBe("request_1");
  });
});
