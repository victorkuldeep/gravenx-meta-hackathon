import { describe, expect, it } from "vitest";
import {
  apiNameFromLabel,
  buildCustomFieldBody,
  buildCustomObjectBody,
  defaultFieldDraft,
  defaultObjectDraft,
  describeTypeFor,
  labelFromApiName,
  looksLikeSandbox,
  newAuthorId,
  parseToolingResult,
  relationshipNameFromField,
  syntheticDescribeForObject,
  toolingCreatePath,
  validateCustomApiName,
  validateFieldDraft,
  validateObjectDraft,
  validateRelationshipName,
  type FieldDraft,
} from "./design";

function draft(over: Partial<FieldDraft> = {}): FieldDraft {
  return { ...defaultFieldDraft(), label: "Risk Score", apiName: "Risk_Score__c", ...over };
}

describe("custom API name validation", () => {
  it("accepts well-formed names", () => {
    expect(validateCustomApiName("Risk_Score__c")).toBeNull();
    expect(validateCustomApiName("X1__c")).toBeNull();
  });

  it("rejects missing suffix, bad chars, length, and casing edge cases", () => {
    expect(validateCustomApiName("")).not.toBeNull();
    expect(validateCustomApiName("Risk")).toMatch(/__c/);
    expect(validateCustomApiName("9Lives__c")).not.toBeNull();
    expect(validateCustomApiName("Has Space__c")).not.toBeNull();
    expect(validateCustomApiName(`${"A".repeat(38)}__c`)).not.toBeNull();
  });
});

describe("relationship name validation", () => {
  it("rejects __c and __r suffixes", () => {
    expect(validateRelationshipName("Contacts")).toBeNull();
    expect(validateRelationshipName("Contacts__c")).not.toBeNull();
    expect(validateRelationshipName("Contacts__r")).not.toBeNull();
    expect(validateRelationshipName("")).not.toBeNull();
  });
});

describe("label/api derivations", () => {
  it("round-trips label and api name", () => {
    expect(apiNameFromLabel("Risk Score")).toBe("Risk_Score__c");
    expect(labelFromApiName("Risk_Score__c")).toBe("Risk Score");
    expect(relationshipNameFromField("Risk_Score__c")).toBe("Risk_Score");
  });
});

describe("field draft validation", () => {
  it("requires label, valid api, and picklist values", () => {
    expect(validateFieldDraft(draft({ label: "" }), { isRelationship: false })).not.toBeNull();
    expect(validateFieldDraft(draft({ apiName: "Nope" }), { isRelationship: false })).not.toBeNull();
    expect(
      validateFieldDraft(draft({ type: "Picklist", picklistValues: [] }), { isRelationship: false })
    ).not.toBeNull();
    expect(
      validateFieldDraft(
        draft({ type: "Picklist", picklistValues: ["A"], picklistDefault: "B" }),
        { isRelationship: false }
      )
    ).not.toBeNull();
    expect(
      validateFieldDraft(
        draft({ type: "Picklist", picklistValues: ["A", "B"], picklistDefault: "b" }),
        { isRelationship: false }
      )
    ).toBeNull();
  });

  it("bounds long-text length separately", () => {
    expect(
      validateFieldDraft(draft({ type: "LongTextArea", length: 255 }), { isRelationship: false })
    ).not.toBeNull();
    expect(
      validateFieldDraft(draft({ type: "LongTextArea", length: 32768 }), { isRelationship: false })
    ).toBeNull();
  });

  it("guards numeric bounds and relationship targets", () => {
    expect(
      validateFieldDraft(draft({ type: "Number", precision: 0 }), { isRelationship: false })
    ).not.toBeNull();
    expect(
      validateFieldDraft(draft({ type: "Number", precision: 10, scale: 11 }), {
        isRelationship: false,
      })
    ).not.toBeNull();
    expect(
      validateFieldDraft(draft({ type: "Lookup", referenceTo: "" }), { isRelationship: true })
    ).not.toBeNull();
    expect(
      validateFieldDraft(
        draft({
          type: "Lookup",
          referenceTo: "Contact",
          relationshipName: "Bad__c",
          relationshipLabel: "Rel",
        }),
        { isRelationship: true }
      )
    ).not.toBeNull();
    expect(
      validateFieldDraft(
        draft({
          type: "Lookup",
          referenceTo: "Contact",
          relationshipName: "Rel",
          relationshipLabel: "Rel",
        }),
        { isRelationship: true }
      )
    ).toBeNull();
  });
});

describe("object draft validation", () => {
  it("requires labels and a valid api name", () => {
    expect(validateObjectDraft({ ...defaultObjectDraft() })).not.toBeNull();
    expect(
      validateObjectDraft({
        ...defaultObjectDraft(),
        label: "Risk",
        pluralLabel: "Risks",
        apiName: "Risk__c",
      })
    ).toBeNull();
  });
});

describe("tooling payload builders", () => {
  it("builds a text field body with FullName + Metadata", () => {
    const body = buildCustomFieldBody(draft({ length: 120 }), "Account");
    expect(body.FullName).toBe("Account.Risk_Score__c");
    const meta = body.Metadata as Record<string, unknown>;
    expect(meta).toMatchObject({ label: "Risk Score", type: "Text", length: 120 });
  });

  it("builds a lookup field with reference target and delete constraint", () => {
    const body = buildCustomFieldBody(
      draft({
        type: "Lookup",
        referenceTo: "Contact",
        relationshipName: "Primary_Contact",
        relationshipLabel: "Primary Contact",
      }),
      "Account"
    );
    const meta = body.Metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      type: "Lookup",
      referenceTo: "Contact",
      relationshipName: "Primary_Contact",
      deleteConstraint: "SetNull",
    });
  });

  it("builds a master-detail field with reparentable flag", () => {
    const body = buildCustomFieldBody(
      draft({
        type: "MasterDetail",
        referenceTo: "Account",
        relationshipName: "Parent_Account",
        relationshipLabel: "Parent Account",
      }),
      "Invoice__c"
    );
    const meta = body.Metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      type: "MasterDetail",
      referenceTo: "Account",
      reparentableMasterDetail: true,
    });
  });

  it("builds a picklist with valueset and default", () => {
    const body = buildCustomFieldBody(
      draft({ type: "Picklist", picklistValues: ["Low", "High"], picklistDefault: "Low" }),
      "Case"
    );
    const meta = body.Metadata as Record<string, unknown>;
    const valueSet = meta.valueSet as {
      valueSetDefinition: { value: { fullName: string; default: boolean }[] };
    };
    expect(valueSet.valueSetDefinition.value.map((v) => v.fullName)).toEqual(["Low", "High"]);
    expect(valueSet.valueSetDefinition.value.find((v) => v.fullName === "Low")?.default).toBe(true);
  });

  it("builds a custom object body", () => {
    const body = buildCustomObjectBody({
      ...defaultObjectDraft(),
      label: "Invoice",
      pluralLabel: "Invoices",
      apiName: "Invoice__c",
    });
    expect(body.FullName).toBe("Invoice__c");
    const meta = body.Metadata as Record<string, unknown>;
    expect(meta).toMatchObject({
      label: "Invoice",
      pluralLabel: "Invoices",
      deploymentStatus: "Deployed",
      sharingModel: "ReadWrite",
    });
    expect(meta.nameField).toMatchObject({ type: "Text" });
  });

  it("versions tooling paths with or without a v prefix", () => {
    expect(toolingCreatePath("v66.0", "CustomField")).toBe(
      "/services/data/v66.0/tooling/sobjects/CustomField"
    );
    expect(toolingCreatePath("66.0", "CustomObject")).toBe(
      "/services/data/v66.0/tooling/sobjects/CustomObject"
    );
  });
});

describe("tooling result parsing", () => {
  it("accepts success with id and joins error messages", () => {
    expect(parseToolingResult({ id: "abc", success: true, errors: [] }, true, 201)).toEqual({
      ok: true,
      id: "abc",
      message: "Deployed.",
    });
    const failed = parseToolingResult(
      { success: false, errors: [{ message: "Bad label" }, { message: "Bad type" }] },
      true,
      400
    );
    expect(failed.ok).toBe(false);
    expect(failed.message).toBe("Bad label; Bad type");
  });

  it("falls back to HTTP status on empty bodies", () => {
    expect(parseToolingResult(null, false, 403).message).toMatch(/403/);
  });
});

describe("sandbox heuristic, type mapping, and sketch describes", () => {
  it("spots sandbox-like orgs", () => {
    expect(looksLikeSandbox("https://acme.sandbox.my.salesforce.com")).toBe(true);
    expect(looksLikeSandbox("https://test.salesforce.com")).toBe(true);
    expect(looksLikeSandbox("https://login.salesforce.com")).toBe(false);
    expect(looksLikeSandbox("https://acme.my.salesforce.com")).toBe(false);
  });

  it("maps design types to describe types", () => {
    expect(describeTypeFor("Text")).toBe("string");
    expect(describeTypeFor("Checkbox")).toBe("boolean");
    expect(describeTypeFor("Lookup")).toBe("reference");
    expect(describeTypeFor("MasterDetail")).toBe("reference");
    expect(describeTypeFor("Picklist")).toBe("picklist");
  });

  it("builds a flagged synthetic describe for object sketches", () => {
    const d = syntheticDescribeForObject({
      ...defaultObjectDraft(),
      label: "Invoice",
      pluralLabel: "Invoices",
      apiName: "Invoice__c",
      nameFieldLabel: "Invoice No",
    });
    expect(d.__authorSketch).toBe(true);
    expect(d.name).toBe("Invoice__c");
    expect(d.custom).toBe(true);
    expect(d.fields.map((f) => f.name)).toEqual(["Id", "Name"]);
  });
});

describe("author ids", () => {
  it("mints unique ids", () => {
    const ids = new Set([newAuthorId(), newAuthorId(), newAuthorId()]);
    expect(ids.size).toBe(3);
  });
});
