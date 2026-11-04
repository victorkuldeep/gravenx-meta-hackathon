import { describe, expect, it } from "vitest";
import { computeChanges } from "./RecordEditModal";
import type { RecordFieldMeta } from "./RecordPopover";

const metas: RecordFieldMeta[] = [
  { name: "Id", label: "Record ID", type: "id", updateable: false },
  { name: "Name", label: "Account Name", type: "string", updateable: true },
  { name: "Employees", label: "Employees", type: "int", updateable: true },
  { name: "Rating", label: "Rating", type: "picklist", updateable: true, picklistValues: [{ label: "Hot", value: "Hot" }] },
  { name: "CreatedDate", label: "Created Date", type: "datetime", updateable: false },
];

const raw = { Id: "001x", Name: "Acme", Employees: 50, Rating: "Cold", CreatedDate: "2026-01-01" };

describe("computeChanges", () => {
  it("diffs edited fields with old and new display values", () => {
    const out = computeChanges(metas, raw, { Name: "Acme Inc", Employees: "60" });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ field: "Name", label: "Account Name", from: "Acme", to: "Acme Inc", body: { Name: "Acme Inc" } });
    expect(out[1]).toMatchObject({ field: "Employees", from: "50", to: "60", body: { Employees: 60 } });
  });

  it("skips unchanged, empty-to-empty, Id, and read-only fields", () => {
    expect(computeChanges(metas, raw, { Name: "Acme" })).toEqual([]);
    expect(computeChanges(metas, { ...raw, Rating: null }, { Rating: "" })).toEqual([]);
    expect(computeChanges(metas, raw, { Id: "002y" })).toEqual([]);
    expect(computeChanges(metas, raw, { CreatedDate: "2027-01-01" })).toEqual([]);
  });

  it("toggles booleans and drops blanked strings", () => {
    const boolMetas: RecordFieldMeta[] = [{ name: "Active", label: "Active", type: "boolean", updateable: true }];
    expect(computeChanges(boolMetas, { Active: false }, { Active: true })).toMatchObject([{ field: "Active", from: "false", to: "true" }]);
    expect(computeChanges(metas, raw, { Name: "  " })).toEqual([]);
  });
});
