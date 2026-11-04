import { describe, expect, it } from "vitest";
import { decodeValidFor, objectInfoPath, parseDependencyGraph } from "./picklistDeps";

describe("decodeValidFor", () => {
  it("decodes LSB-first bit positions", () => {
    // 0b00000101 -> bits 0 and 2.
    const bytes = String.fromCharCode(0b00000101);
    const b64 = btoa(bytes);
    expect(decodeValidFor(b64)).toEqual([0, 2]);
  });

  it("returns empty for null, empty or garbage", () => {
    expect(decodeValidFor(null)).toEqual([]);
    expect(decodeValidFor("")).toEqual([]);
    expect(decodeValidFor("!!!")).toEqual([]);
  });
});

describe("parseDependencyGraph", () => {
  it("maps controller values to dependent labels", () => {
    const info = {
      fields: {
        Region__c: { apiName: "Region__c", label: "Region" },
        Country__c: {
          apiName: "Country__c",
          label: "Country",
          controllingFields: ["Region__c"],
          controllerValues: { EMEA: 0, APAC: 1 },
          values: [
            { label: "France", value: "FR", validFor: btoa(String.fromCharCode(0b00000001)) },
            { label: "Japan", value: "JP", validFor: btoa(String.fromCharCode(0b00000010)) },
            { label: "Global", value: "GBL", validFor: btoa(String.fromCharCode(0b00000011)) },
          ],
        },
        Industry: { apiName: "Industry", label: "Industry", values: [{ label: "Tech", value: "Tech" }] },
      },
    };
    const edges = parseDependencyGraph(info, { Region__c: "Region", Country__c: "Country" });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ controller: "Region__c", dependent: "Country__c" });
    expect(edges[0].map).toEqual([
      { controller: "EMEA", values: ["France", "Global"] },
      { controller: "APAC", values: ["Japan", "Global"] },
    ]);
  });

  it("skips independent fields and empty mappings", () => {
    expect(parseDependencyGraph({ fields: {} }, {})).toEqual([]);
    expect(
      parseDependencyGraph(
        { fields: { A__c: { apiName: "A__c", controllingFields: ["B__c"], values: [] } } },
        {}
      )
    ).toEqual([]);
  });
});

describe("objectInfoPath", () => {
  it("points at the UI API object-info endpoint", () => {
    expect(objectInfoPath("v66.0", "Account")).toBe("/services/data/v66.0/ui-api/object-info/Account");
  });
});
