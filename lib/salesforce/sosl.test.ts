import { describe, expect, it } from "vitest";
import {
  buildSearchUrl,
  countByObject,
  isSearchRecord,
  looksLikeSosl,
  toObjectTable,
} from "./sosl";

const RECORDS = [
  { attributes: { type: "Account", url: "/a/1" }, Id: "001", Name: "Acme" },
  { attributes: { type: "Contact", url: "/c/1" }, Id: "003", FirstName: "Ada", Email: "a@x.com" },
  { attributes: { type: "Account", url: "/a/2" }, Id: "002", Name: "Acme Labs" },
  { junk: true },
];

describe("sosl helpers", () => {
  it("recognizes FIND statements", () => {
    expect(looksLikeSosl("FIND {Acme} IN ALL FIELDS RETURNING Account(Id)")).toBe(true);
    expect(looksLikeSosl("  find {x} returning Lead(Id)")).toBe(true);
    expect(looksLikeSosl("SELECT Id FROM Account")).toBe(false);
    expect(looksLikeSosl("")).toBe(false);
  });

  it("builds the search URL", () => {
    expect(buildSearchUrl("https://x.my.salesforce.com/", "v75.0", "FIND {a} RETURNING Account(Id)")).toBe(
      "https://x.my.salesforce.com/services/data/v75.0/search?q=FIND%20%7Ba%7D%20RETURNING%20Account(Id)"
    );
    expect(buildSearchUrl("https://x.my.salesforce.com", "75.0", "FIND {a}")).toContain("/v75.0/search?q=");
  });

  it("flattens mixed records with a leading Object column", () => {
    const table = toObjectTable(RECORDS);
    expect(table.columns[0]).toBe("Object");
    expect(table.columns).toContain("Email");
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0][0]).toBe("Account");
    expect(table.rows[1][0]).toBe("Contact");
    // Union columns: Contact row has blanks under Account-only fields.
    expect(table.rows[1][table.columns.indexOf("Name")]).toBe("");
  });

  it("counts per object type, skipping junk", () => {
    expect(countByObject(RECORDS)).toEqual([
      { type: "Account", count: 2 },
      { type: "Contact", count: 1 },
    ]);
    expect(isSearchRecord({ junk: true })).toBe(false);
  });
});
