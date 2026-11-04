import { describe, expect, it } from "vitest";
import { classifyObject, mergeBigObjects } from "./objectKind";

describe("classifyObject", () => {
  it("separates standard, custom, settings, metadata and big objects", () => {
    expect(classifyObject({ name: "Account", custom: false })).toBe("Standard");
    expect(classifyObject({ name: "Invoice__c", custom: true })).toBe("Custom");
    expect(classifyObject({ name: "Flags__c", custom: true, customSetting: true })).toBe("Custom Setting");
    expect(classifyObject({ name: "Rule__mdt", custom: true })).toBe("Custom Metadata");
    expect(classifyObject({ name: "Archive__b", custom: false })).toBe("Big Object");
  });

  it("falls back to Custom when the setting flag is absent", () => {
    expect(classifyObject({ name: "Flags__c", custom: true })).toBe("Custom");
  });

  it("merges only true __b entities missing from describe", () => {
    const base = [
      {
        name: "Account",
        label: "Account",
        labelPlural: "Accounts",
        custom: false,
        createable: true,
        updateable: true,
        queryable: true,
        deletable: false,
        urls: {},
      },
    ];
    const merged = mergeBigObjects(base, [
      { QualifiedApiName: "Archive__b", Label: "Archive" },
      { QualifiedApiName: "AsyncApexJob", Label: "Apex Job" },
      { QualifiedApiName: "Account", Label: "Account" },
      { QualifiedApiName: "", Label: "Empty" },
    ]);
    expect(merged.map((o) => o.name)).toEqual(["Account", "Archive__b"]);
    expect(classifyObject(merged[1])).toBe("Big Object");
  });
});
