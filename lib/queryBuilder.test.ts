import { describe, it, expect } from "vitest";
import {
  buildCondition,
  buildQuery,
  newBuilderRow,
  opsFor,
  validateCustom,
  type BuilderRow,
} from "./queryBuilder";
import { filterRecords } from "./queryFilter";

const row = (patch: Partial<BuilderRow> & { field: string }): BuilderRow => ({
  ...newBuilderRow("x"),
  ...patch,
});

const isNum = (f: string) => f === "AnnualRevenue";

const sample = () => [
  { Name: "Acme", Industry: "Tech", AnnualRevenue: 900000 },
  { Name: "Globex", Industry: "Finance", AnnualRevenue: 400000 },
  { Name: "Initech", Industry: "Tech", AnnualRevenue: null },
];

/** Generated SQL must actually run - this doubles as engine support proof. */
function run(rows: BuilderRow[], logic: { mode: "all-and" | "all-or" | "custom"; custom: string }) {
  const built = buildQuery(rows, logic, isNum);
  expect(built.ok).toBe(true);
  if (!built.ok) throw new Error(built.error);
  const out = filterRecords(sample(), built.query);
  expect(out.ok).toBe(true);
  if (!out.ok) throw new Error(out.error);
  return { query: built.query, names: (out.rows as { Name: string }[]).map((r) => r.Name).sort() };
}

describe("opsFor", () => {
  it("gives range ops to numbers and text ops to strings", () => {
    expect(opsFor(true)).toContain("between");
    expect(opsFor(true)).not.toContain("contains");
    expect(opsFor(false)).toContain("contains");
    expect(opsFor(false)).not.toContain("between");
  });
});

describe("buildCondition", () => {
  it("equals / not-equals with quoting and escaping", () => {
    expect(buildCondition(row({ field: "Industry", op: "eq", value: "Tech" }), false, 1)).toEqual({
      ok: true,
      sql: 'Industry = "Tech"',
    });
    expect(buildCondition(row({ field: "Industry", op: "neq", value: 'a"b' }), false, 2)).toEqual({
      ok: true,
      sql: 'Industry != "a\\"b"',
    });
  });

  it("rejects mismatched operators and bad numbers", () => {
    expect(buildCondition(row({ field: "AnnualRevenue", op: "contains", value: "x" }), true, 1).ok).toBe(false);
    expect(buildCondition(row({ field: "AnnualRevenue", op: "gt", value: "lots" }), true, 2)).toEqual({
      ok: false,
      error: 'Row 2: "lots" isn\'t a number.',
    });
    expect(buildCondition(row({ field: "", op: "eq", value: "x" }), false, 3)).toEqual({
      ok: false,
      error: "Row 3: pick a field.",
    });
  });

  it("between emits ranges, not-between expands to OR", () => {
    expect(
      buildCondition(row({ field: "AnnualRevenue", op: "between", value: "100", value2: "500" }), true, 1)
    ).toEqual({ ok: true, sql: "AnnualRevenue BETWEEN (100, 500)" });
    expect(
      buildCondition(row({ field: "AnnualRevenue", op: "notbetween", value: "100", value2: "500" }), true, 1)
    ).toEqual({ ok: true, sql: "(AnnualRevenue < 100 OR AnnualRevenue > 500)" });
  });

  it("in-lists quote strings and stay raw for numbers; not-in expands to AND", () => {
    expect(buildCondition(row({ field: "Industry", op: "in", value: "Tech, Finance" }), false, 1)).toEqual({
      ok: true,
      sql: 'Industry IN ("Tech", "Finance")',
    });
    expect(buildCondition(row({ field: "AnnualRevenue", op: "in", value: "1, 2" }), true, 1)).toEqual({
      ok: true,
      sql: "AnnualRevenue IN (1, 2)",
    });
    expect(buildCondition(row({ field: "Industry", op: "notin", value: "Tech" }), false, 1)).toEqual({
      ok: true,
      sql: '(Industry != "Tech")',
    });
  });

  it("null checks need no value", () => {
    expect(buildCondition(row({ field: "AnnualRevenue", op: "isnull" }), true, 1)).toEqual({
      ok: true,
      sql: "AnnualRevenue IS NULL",
    });
    expect(buildCondition(row({ field: "Industry", op: "isnotnull" }), false, 1)).toEqual({
      ok: true,
      sql: "Industry IS NOT NULL",
    });
  });
});

describe("validateCustom", () => {
  it("accepts nested logic and rejects junk", () => {
    expect(validateCustom("1 AND 2 AND (3 OR 4 OR 5)", 5)).toBeNull();
    expect(validateCustom("NOT 1", 1)).toBeNull();
    expect(validateCustom("1 AND (2 OR", 2)).not.toBeNull();
    expect(validateCustom("1 XOR 2", 2)).not.toBeNull();
    expect(validateCustom("1 AND 7", 2)).toContain("Row 7");
    expect(validateCustom("1 AND 1", 2)).toContain("Row 2");
    expect(validateCustom("", 2)).not.toBeNull();
  });
});

describe("buildQuery engine round-trips", () => {
  const AND = { mode: "all-and" as const, custom: "" };

  it("all-and, all-or and custom nestings return the right rows", () => {
    const a = run(
      [row({ field: "Industry", op: "eq", value: "Tech" }), row({ field: "AnnualRevenue", op: "gte", value: "500000" })],
      AND
    );
    expect(a.names).toEqual(["Acme"]);

    const b = run(
      [row({ field: "Industry", op: "eq", value: "Tech" }), row({ field: "Industry", op: "eq", value: "Finance" })],
      { mode: "all-or", custom: "" }
    );
    expect(b.names).toEqual(["Acme", "Globex", "Initech"]);

    const c = run(
      [
        row({ field: "Industry", op: "eq", value: "Tech" }),
        row({ field: "AnnualRevenue", op: "isnull" }),
        row({ field: "Industry", op: "eq", value: "Finance" }),
      ],
      { mode: "custom", custom: "1 AND (2 OR 3)" }
    );
    expect(c.names).toEqual(["Initech"]);
    expect(c.query).toBe('(Industry = "Tech") AND ((AnnualRevenue IS NULL) OR (Industry = "Finance"))');
  });

  it("like, between, in and not-variants all execute", () => {
    expect(run([row({ field: "Name", op: "starts", value: "Ac" })], AND).names).toEqual(["Acme"]);
    expect(run([row({ field: "AnnualRevenue", op: "between", value: "300000", value2: "950000" })], AND).names).toEqual([
      "Acme",
      "Globex",
    ]);
    expect(run([row({ field: "AnnualRevenue", op: "notbetween", value: "300000", value2: "950000" })], AND).names).toEqual([]);
    expect(run([row({ field: "Industry", op: "in", value: "Tech" })], AND).names).toEqual(["Acme", "Initech"]);
    expect(run([row({ field: "Industry", op: "notin", value: "Tech, Finance" })], AND).names).toEqual([]);
    expect(run([row({ field: "AnnualRevenue", op: "isnotnull" })], AND).names).toEqual(["Acme", "Globex"]);
  });
});
