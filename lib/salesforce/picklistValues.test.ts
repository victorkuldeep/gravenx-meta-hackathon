import { describe, expect, it } from "vitest";
import {
  buildCustomFieldPatch,
  buildFieldCopyTable,
  buildFieldDataCopyTable,
  buildGlobalValueSetPatch,
  buildPicklistCopyTable,
  buildRecordTypePatch,
  fieldIdQuery,
  isMasterRecordType,
  parseAvailability,
  parseFieldValueSet,
  parseGlobalValueSet,
  parseRtPicklists,
  splitNewValues,
  validateNewValues,
  withAdditions,
} from "./picklistValues";

describe("picklist add-values contract", () => {
  it("splits pasted values on lines, commas and semicolons", () => {
    expect(splitNewValues("High\nMedium, Low; Critical")).toEqual(["High", "Medium", "Low", "Critical"]);
    expect(splitNewValues("  \n ")).toEqual([]);
  });

  it("dedupes case-insensitively against the current set", () => {
    const current = [{ fullName: "High", label: "High", isDefault: false, isActive: true }];
    const { ok, problems } = validateNewValues(current, ["high", "HIGH ", "Fresh"]);
    expect(ok).toEqual(["Fresh"]);
    expect(problems).toHaveLength(2);
  });

  it("parses CustomField metadata, detecting global backing", () => {
    const local = parseFieldValueSet({
      valueSet: {
        restricted: true,
        valueSetDefinition: { value: [{ fullName: "A", label: "A", default: true, isActive: true }] },
      },
    });
    expect(local?.globalSetName).toBeUndefined();
    expect(local?.restricted).toBe(true);
    expect(local?.values).toEqual([{ fullName: "A", label: "A", isDefault: true, isActive: true }]);
    const global = parseFieldValueSet({ valueSet: { valueSetName: "RiskLevels" } });
    expect(global?.globalSetName).toBe("RiskLevels");
    expect(global?.values).toEqual([]);
    expect(parseFieldValueSet({})).toBeNull();
  });

  it("parses GlobalValueSet metadata", () => {
    const values = parseGlobalValueSet({ customValue: [{ fullName: "A" }] });
    expect(values).toEqual([{ fullName: "A", label: "A", isDefault: false, isActive: true }]);
    expect(parseGlobalValueSet({})).toBeNull();
  });

  it("builds total (never delta) field patches", () => {
    const merged = withAdditions(
      [{ fullName: "A", label: "A", isDefault: true, isActive: true }],
      ["B"],
    );
    const patch = buildCustomFieldPatch(merged) as { Metadata: { valueSet: { valueSetDefinition: { value: unknown[] } } } };
    expect(patch.Metadata.valueSet.valueSetDefinition.value).toHaveLength(2);
    const global = buildGlobalValueSetPatch(merged) as { Metadata: { customValue: unknown[] } };
    expect(global.Metadata.customValue).toHaveLength(2);
  });

  it("extends only our field in the RecordType patch", () => {
    const existing = [
      { picklist: "Risk_Level__c", values: [{ fullName: "High", isDefault: false }] },
      { picklist: "Other__c", values: [{ fullName: "X", isDefault: true }] },
    ];
    const patch = buildRecordTypePatch(existing, "Risk_Level__c", ["Critical", "High"]) as {
      Metadata: { picklistValues: { picklist: string; values: { fullName: string }[] }[] };
    };
    const ours = patch.Metadata.picklistValues.find((p) => p.picklist === "Risk_Level__c")!;
    expect(ours.values.map((v) => v.fullName)).toEqual(["High", "Critical"]);
    const other = patch.Metadata.picklistValues.find((p) => p.picklist === "Other__c")!;
    expect(other.values).toHaveLength(1);
  });

  it("creates the entry when the record type never listed the field", () => {
    const patch = buildRecordTypePatch([], "Risk_Level__c", ["Critical"]) as {
      Metadata: { picklistValues: { picklist: string; values: unknown[] }[] };
    };
    expect(patch.Metadata.picklistValues).toHaveLength(1);
  });

  it("parses RecordType metadata and spots the master type", () => {
    expect(isMasterRecordType("012000000000000AAA")).toBe(true);
    expect(isMasterRecordType("012ABC")).toBe(false);
    const entries = parseRtPicklists({ picklistValues: [{ picklist: "F__c", values: [{ fullName: "A" }] }] });
    expect(entries).toEqual([{ picklist: "F__c", values: [{ fullName: "A", isDefault: false }] }]);
    expect(parseRtPicklists({})).toEqual([]);
  });

  it("reads per-record-type availability from the UI API", () => {
    const payload = {
      picklistFieldValues: {
        Risk_Level__c: { values: [{ value: "High", active: true }, { value: "Old", active: false }] },
      },
    };
    expect(parseAvailability(payload, "Risk_Level__c")).toEqual(["High"]);
    expect(parseAvailability({}, "Risk_Level__c")).toEqual([]);
  });

  it("builds the field id query", () => {
    expect(fieldIdQuery("Account", "Risk_Level")).toContain("TableEnumOrId = 'Account'");
  });

  it("builds a copy-all table with HTML escaping", () => {
    const { html, text } = buildPicklistCopyTable([
      { label: "High & Dry", value: "High" },
      { label: "Low", value: "Low<Value>" },
    ]);
    expect(html).toContain("<th>Label</th><th>API Name</th>");
    expect(html).toContain("High &amp; Dry");
    expect(html).toContain("Low&lt;Value&gt;");
    expect(text).toBe("Label\tAPI Name\nHigh & Dry\tHigh\nLow\tLow<Value>");
  });

  it("builds a DB-level field table: type, description, Required Y/N", () => {
    const { html, text } = buildFieldCopyTable([
      { label: "Account Name", name: "Name", type: "string", description: "Legal & name", required: true },
      { label: "Annual Revenue", name: "AnnualRevenue", type: "currency", description: "Line1\nLine2\tTabbed", required: false },
    ]);
    expect(html).toContain("<th>Label</th><th>API Name</th><th>Data Type</th><th>Description</th><th>Required</th>");
    expect(html).toContain("<td>Account Name</td><td>Name</td><td>string</td><td>Legal &amp; name</td><td>Y</td>");
    expect(html).toContain("<td>Line1 Line2 Tabbed</td><td>N</td>");
    expect(text).toBe(
      "Label\tAPI Name\tData Type\tDescription\tRequired\nAccount Name\tName\tstring\tLegal & name\tY\nAnnual Revenue\tAnnualRevenue\tcurrency\tLine1 Line2 Tabbed\tN",
    );
  });

  it("builds a Label | API Name | Value table with live record data", () => {
    const { html, text } = buildFieldDataCopyTable([
      { label: "Account Name", name: "Name", value: "Acme & Sons" },
      { label: "Annual Revenue", name: "AnnualRevenue", value: 1200000 },
      { label: "Active", name: "Active__c", value: true },
      { label: "Missing", name: "Missing__c", value: null },
      { label: "Address", name: "BillingAddress", value: { city: "Austin" } },
    ]);
    expect(html).toContain("<th>Label</th><th>API Name</th><th>Value</th>");
    expect(html).toContain("<td>Acme &amp; Sons</td>");
    expect(html).toContain("<td>{&quot;city&quot;:&quot;Austin&quot;}</td>");
    expect(text).toBe(
      "Label\tAPI Name\tValue\nAccount Name\tName\tAcme & Sons\nAnnual Revenue\tAnnualRevenue\t1200000\nActive\tActive__c\ttrue\nMissing\tMissing__c\t\nAddress\tBillingAddress\t{\"city\":\"Austin\"}",
    );
  });
});
