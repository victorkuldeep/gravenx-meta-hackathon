import { describe, it, expect } from "vitest";
import { checkQuery, filterRecords, aggregateRecords, recordFields, valueChips, numericFields } from "./queryFilter";

const rows = () => [
  { Id: "001A", Name: "Acme", Industry: "Tech", AnnualRevenue: 900000 },
  { Id: "001B", Name: "Globex", Industry: "Finance", AnnualRevenue: 400000 },
  { Id: "001C", Name: "Initech", Industry: "Tech", AnnualRevenue: 1200000 },
  { Id: "001D", Name: "Umbrella", Industry: null, AnnualRevenue: 100000 },
];

describe("checkQuery", () => {
  it("accepts empty and valid queries", () => {
    expect(checkQuery("")).toBeNull();
    expect(checkQuery('Industry = "Tech" AND AnnualRevenue > 500000')).toBeNull();
  });

  it("rejects broken syntax with a message", () => {
    expect(checkQuery("Industry =")).not.toBeNull();
    expect(checkQuery("(((unclosed")).not.toBeNull();
  });
});

describe("filterRecords", () => {
  it("AND/OR with parens", () => {
    const r = filterRecords(rows(), 'Industry = "Tech" OR (Industry = "Finance" AND AnnualRevenue > 500000)');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows.map((x) => (x as { Name: string }).Name).sort()).toEqual(["Acme", "Initech"]);
  });

  it("comparison, IN, BETWEEN and IS NULL", () => {
    expect((filterRecords(rows(), "AnnualRevenue >= 900000").ok && true)).toBe(true);
    const between = filterRecords(rows(), "AnnualRevenue BETWEEN (100000, 900000)");
    expect(between.ok).toBe(true);
    if (between.ok) expect(between.rows).toHaveLength(3);
    const nulled = filterRecords(rows(), "Industry IS NULL");
    expect(nulled.ok).toBe(true);
    if (nulled.ok) expect((nulled.rows[0] as { Name: string }).Name).toBe("Umbrella");
  });

  it("LIKE, CONTAINS and free-text smart mode", () => {
    const like = filterRecords(rows(), "Name LIKE \"Glo%\"");
    expect(like.ok).toBe(true);
    if (like.ok) expect(like.rows).toHaveLength(1);
    const free = filterRecords(rows(), "acme");
    expect(free.ok).toBe(true);
    if (free.ok) expect(free.rows).toHaveLength(1);
  });

  it("ORDER BY re-sorts", () => {
    const r = filterRecords(rows(), "AnnualRevenue > 0 ORDER BY AnnualRevenue DESC");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.rows[0] as { AnnualRevenue: number }).AnnualRevenue).toBe(1200000);
    }
  });

  it("surfaces engine errors instead of throwing", () => {
    const r = filterRecords(rows(), "Industry =");
    expect(r.ok).toBe(false);
  });
});

describe("aggregateRecords", () => {
  it("groups and counts", () => {
    const r = aggregateRecords(rows(), {
      groupBy: ["Industry"],
      aggs: [{ op: "COUNT", alias: "n" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const tech = (r.rows as { Industry: string; n: number }[]).find((x) => x.Industry === "Tech");
      expect(tech?.n).toBe(2);
    }
  });

  it("groups and sums", () => {
    const r = aggregateRecords(rows(), {
      groupBy: ["Industry"],
      aggs: [{ op: "SUM", field: "AnnualRevenue", alias: "revenue" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const tech = (r.rows as { Industry: string; revenue: number }[]).find((x) => x.Industry === "Tech");
      expect(tech?.revenue).toBe(2100000);
    }
  });

  it("counts everything without groupBy", () => {
    const r = aggregateRecords(rows(), { aggs: [{ op: "COUNT", alias: "n" }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toHaveLength(1);
  });
});

describe("recordFields", () => {
  it("unions top-level keys minus attributes", () => {
    expect(recordFields([{ a: 1, attributes: {} }, { b: 2 }] as unknown[])).toEqual(["a", "b"]);
  });
});

describe("valueChips", () => {
  it("mines low-cardinality string values with counts", () => {
    const chips = valueChips(rows());
    const tech = chips.find((c) => c.field === "Industry" && c.value === "Tech");
    expect(tech?.count).toBe(2);
    // every chip round-trips as a valid filter
    for (const c of chips) {
      expect(checkQuery(`${c.field} = "${c.value}"`)).toBeNull();
    }
  });

  it("skips single-value, high-cardinality, non-string and attributes", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ Group: `g${i}`, Solo: "only", N: i, attributes: {} }));
    const chips = valueChips(many as unknown[]);
    expect(chips.find((c) => c.field === "Group")).toBeUndefined();
    expect(chips.find((c) => c.field === "Solo")).toBeUndefined();
    expect(chips.find((c) => c.field === "N")).toBeUndefined();
    expect(chips.find((c) => c.field === "attributes")).toBeUndefined();
  });

  it("caps fields and values", () => {
    const wide = Array.from({ length: 10 }, (_, i) =>
      Object.fromEntries(Array.from({ length: 10 }, (_, j) => [`F${j}`, (i + j) % 2 ? "a" : "b"]))
    );
    expect(valueChips(wide as unknown[], 2).filter((c) => c.field === "F0")).toHaveLength(2);
    expect(valueChips(wide as unknown[], 2)).toHaveLength(4);
  });
});

describe("numericFields", () => {
  it("keeps only fields with numeric samples", () => {
    expect(numericFields(rows())).toEqual(["AnnualRevenue"]);
  });

  it("rejects mixed-type fields", () => {
    expect(numericFields([{ v: 1 }, { v: "x" }] as unknown[])).toEqual([]);
  });
});
