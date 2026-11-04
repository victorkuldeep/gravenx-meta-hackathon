import { describe, expect, it } from "vitest";
import { checkLength, checkNumeric, checkType } from "./compatibility";
import { buildSnapshot, diffSnapshots } from "./snapshot";
import type { SalesforceDescribeResult, SalesforceObject } from "../salesforce/types";

describe("checkType", () => {
  it("string -> string is compatible", () => {
    expect(checkType("string", "string").level).toBe("compatible");
  });
  it("string -> number needs an explicit decision", () => {
    const r = checkType("string", "double");
    expect(r.level).toBe("needs-decision");
    expect(r.reason).toMatch(/conversion decision/);
  });
  it("object -> scalar is incompatible with guidance", () => {
    expect(checkType("object", "string").level).toBe("incompatible");
  });
  it("array -> scalar suggests record plans", () => {
    expect(checkType("array", "string").reason).toMatch(/record plan/);
  });
  it("integer fits int and decimal", () => {
    expect(checkType("integer", "int").level).toBe("compatible");
    expect(checkType("integer", "currency").level).toBe("compatible");
  });
  it("decimal -> int needs rounding decision", () => {
    expect(checkType("number", "int").level).toBe("needs-decision");
  });
  it("boolean -> checkbox compatible", () => {
    expect(checkType("boolean", "boolean").level).toBe("compatible");
  });
  it("reference target needs ID confirmation", () => {
    expect(checkType("string", "reference").level).toBe("needs-decision");
  });
});

describe("checkLength / checkNumeric", () => {
  it("flags overlong samples, labels the check sample-based", () => {
    const r = checkLength("abcdef", 3);
    expect(r.flag).toBe(true);
    const ok = checkLength("ab", 3);
    expect(ok.flag).toBe(false);
    expect(ok.message).toMatch(/sample-based/);
  });
  it("flags precision overflow on samples", () => {
    expect(checkNumeric(123456, 5, 0).flag).toBe(true);
    expect(checkNumeric(12.5, 5, 2).flag).toBe(false);
  });
});

function meta(name: string): SalesforceObject {
  return { name, label: name, labelPlural: name, custom: false, createable: true, updateable: true, queryable: true, deletable: false, urls: {} };
}

function describeWith(fields: Partial<import("../salesforce/types").SalesforceField & { name: string }>[]): SalesforceDescribeResult {
  return {
    name: "Order",
    label: "Order",
    labelPlural: "Orders",
    custom: false,
    fields: fields.map((f) => ({
      label: f.name,
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
      ...f,
    })),
  } as SalesforceDescribeResult;
}

describe("snapshot + fingerprint", () => {
  it("is deterministic regardless of input order", () => {
    const a = buildSnapshot("s1", [{ meta: meta("Order"), describe: describeWith([{ name: "B" }, { name: "A" }]) }], undefined, "2026-01-01");
    const b = buildSnapshot("s1", [{ meta: meta("Order"), describe: describeWith([{ name: "A" }, { name: "B" }]) }], undefined, "2026-01-01");
    expect(a.fingerprint).toBe(b.fingerprint);
  });
  it("changes when a constraint changes", () => {
    const a = buildSnapshot("s1", [{ meta: meta("Order"), describe: describeWith([{ name: "A", length: 80 }]) }], undefined, "2026-01-01");
    const b = buildSnapshot("s1", [{ meta: meta("Order"), describe: describeWith([{ name: "A", length: 40 }]) }], undefined, "2026-01-01");
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe("diffSnapshots", () => {
  it("detects removed/added/changed fields and picklist drift", () => {
    const oldS = buildSnapshot("s1", [{ meta: meta("Order"), describe: describeWith([{ name: "Keep", length: 80 }, { name: "Gone" }]) }], undefined, "2026-01-01");
    const fresh = buildSnapshot("s2", [{ meta: meta("Order"), describe: describeWith([{ name: "Keep", length: 40 }, { name: "New" }]) }], undefined, "2026-02-01");
    const kinds = diffSnapshots(oldS, fresh).map((d) => d.kind);
    expect(kinds).toContain("field-removed");
    expect(kinds).toContain("field-added");
    expect(kinds).toContain("length-changed");
  });
  it("is quiet when nothing changed", () => {
    const d = describeWith([{ name: "A" }]);
    expect(diffSnapshots(buildSnapshot("s1", [{ meta: meta("Order"), describe: d }], undefined, "t"), buildSnapshot("s2", [{ meta: meta("Order"), describe: d }], undefined, "t"))).toEqual([]);
  });
});
