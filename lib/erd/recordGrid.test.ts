"use client";

import { describe, it, expect } from "vitest";
import {
  gridColumns,
  filterGridRows,
  gridRowsToTsv,
  gridRowsToMatrix,
  type GridFilter,
} from "./recordGrid";

const rows = [
  { Id: "001A", Name: "Acme", Industry: "Tech", AnnualRevenue: 100 },
  { Id: "001B", Name: "Globex", Industry: "Finance", AnnualRevenue: null },
  { Id: "001C", attributes: { type: "Account" }, Name: "Initech", Custom__c: "x" },
];

const none: GridFilter = { search: "", cols: {}, hidden: new Set() };

describe("record grid helpers", () => {
  it("unions columns with Id first, then alphabetical, skipping the envelope", () => {
    expect(gridColumns(rows)).toEqual([
      "Id",
      "Name",
      "AnnualRevenue",
      "Custom__c",
      "Industry",
    ]);
  });

  it("pins required fields behind Id and Name, then alphabetical", () => {
    expect(gridColumns(rows, ["Industry", "Custom__c"])).toEqual([
      "Id",
      "Name",
      "Custom__c",
      "Industry",
      "AnnualRevenue",
    ]);
  });

  it("filters by global search across visible cells", () => {
    expect(filterGridRows(rows, gridColumns(rows), { ...none, search: "acme" })).toHaveLength(1);
    expect(filterGridRows(rows, gridColumns(rows), { ...none, search: "00" })).toHaveLength(3);
    expect(filterGridRows(rows, gridColumns(rows), { ...none, search: "zzz" })).toHaveLength(0);
  });

  it("filters per column and respects hidden columns in search", () => {
    const cols = gridColumns(rows);
    expect(filterGridRows(rows, cols, { ...none, cols: { Industry: "fin" } }).map((r) => r.Id)).toEqual([
      "001B",
    ]);
    const hidden = { ...none, search: "acme", hidden: new Set(["Name", "Id", "Industry", "AnnualRevenue", "Custom__c"]) };
    expect(filterGridRows(rows, cols, hidden)).toHaveLength(0);
  });

  it("exports TSV with quoting and nulls", () => {
    const tsv = gridRowsToTsv(rows.slice(0, 2), ["Id", "Name", "AnnualRevenue"]);
    const lines = tsv.split("\n");
    expect(lines[0]).toBe("Id\tName\tAnnualRevenue");
    expect(lines[1]).toBe("001A\tAcme\t100");
    expect(lines[2]).toBe("001B\tGlobex\tnull");
    expect(gridRowsToTsv([{ a: 'x\ty"z' }], ["a"])).toBe('a\n"x\ty""z"');
  });

  it("builds a string matrix for the workbook", () => {
    expect(gridRowsToMatrix([rows[0]], ["Id", "AnnualRevenue"])).toEqual([["001A", "100"]]);
  });
});
