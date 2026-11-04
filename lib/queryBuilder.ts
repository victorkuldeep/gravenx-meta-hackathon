/**
 * Interactive Data Query Builder core - pure, engine-free.
 * Numbered condition rows plus ALL AND / ALL OR / CUSTOM row logic compile
 * down to a JsonQL string, so the builder never duplicates engine semantics:
 * it only *writes* queries, the engine still *runs* them.
 */

export type BuilderOp =
  | "eq"
  | "neq"
  | "contains"
  | "starts"
  | "ends"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "notbetween"
  | "in"
  | "notin"
  | "isnull"
  | "isnotnull";

export interface BuilderRow {
  id: string;
  field: string;
  op: BuilderOp;
  value: string;
  value2: string;
}

export type BuilderLogicMode = "all-and" | "all-or" | "custom";

export interface BuilderLogic {
  mode: BuilderLogicMode;
  custom: string;
}

export type ConditionResult = { ok: true; sql: string } | { ok: false; error: string };
export type QueryResult = { ok: true; query: string } | { ok: false; error: string };

const NO_VALUE: BuilderOp[] = ["isnull", "isnotnull"];
const TWO_VALUES: BuilderOp[] = ["between", "notbetween"];

export const NUMERIC_OPS: ReadonlySet<BuilderOp> = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "notbetween",
  "in",
  "notin",
  "isnull",
  "isnotnull",
]);

export const TEXT_OPS: ReadonlySet<BuilderOp> = new Set([
  "eq",
  "neq",
  "contains",
  "starts",
  "ends",
  "in",
  "notin",
  "isnull",
  "isnotnull",
]);

const OP_LABELS: Record<BuilderOp, string> = {
  eq: "Equals",
  neq: "Not equals",
  contains: "Contains",
  starts: "Starts with",
  ends: "Ends with",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  between: "Between",
  notbetween: "Not between",
  in: "In list",
  notin: "Not in list",
  isnull: "Is null",
  isnotnull: "Is not null",
};

/** Operator choices for a field - range ops only make sense on numbers. */
export function opsFor(numeric: boolean): BuilderOp[] {
  return (numeric ? [...NUMERIC_OPS] : [...TEXT_OPS]);
}

export function opLabel(op: BuilderOp): string {
  return OP_LABELS[op];
}

/** Fresh empty row. Caller supplies unique ids. */
export function newBuilderRow(id: string): BuilderRow {
  return { id, field: "", op: "eq", value: "", value2: "" };
}

/** Double-quoted string literal with escaping for generated queries. */
function qstr(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function qnum(raw: string, n: number, what: string): { ok: true; v: string } | { ok: false; error: string } {
  const t = raw.trim();
  if (!t) return { ok: false, error: `Row ${n}: enter ${what}.` };
  const num = Number(t);
  if (!Number.isFinite(num)) return { ok: false, error: `Row ${n}: ${JSON.stringify(t)} isn't a number.` };
  return { ok: true, v: String(num) };
}

/**
 * Compile one row to JsonQL. NOT-variants expand to AND/OR combos on purpose:
 * `!=`, `<`, `>` and IN-lists are the engine's safest primitives, so the
 * builder never emits a negated form the engine might not parse.
 */
export function buildCondition(
  row: BuilderRow,
  numeric: boolean,
  n: number
): ConditionResult {
  const field = row.field.trim();
  if (!field) return { ok: false, error: `Row ${n}: pick a field.` };
  const pool = numeric ? NUMERIC_OPS : TEXT_OPS;
  if (!pool.has(row.op)) {
    return { ok: false, error: `Row ${n}: ${opLabel(row.op)} doesn't fit ${numeric ? "a numeric" : "a text"} field.` };
  }
  if (NO_VALUE.includes(row.op)) {
    return { ok: true, sql: row.op === "isnull" ? `${field} IS NULL` : `${field} IS NOT NULL` };
  }
  if (TWO_VALUES.includes(row.op)) {
    const a = qnum(row.value, n, "the range start");
    if (!a.ok) return a;
    const b = qnum(row.value2, n, "the range end");
    if (!b.ok) return b;
    return row.op === "between"
      ? { ok: true, sql: `${field} BETWEEN (${a.v}, ${b.v})` }
      : { ok: true, sql: `(${field} < ${a.v} OR ${field} > ${b.v})` };
  }
  if (row.op === "in" || row.op === "notin") {
    const parts = row.value
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p !== "");
    if (parts.length === 0) return { ok: false, error: `Row ${n}: enter at least one value.` };
    if (numeric) {
      const nums: string[] = [];
      for (const p of parts) {
        const q = qnum(p, n, "numbers only for this field");
        if (!q.ok) return q;
        nums.push(q.v);
      }
      return row.op === "in"
        ? { ok: true, sql: `${field} IN (${nums.join(", ")})` }
        : { ok: true, sql: `(${nums.map((x) => `${field} != ${x}`).join(" AND ")})` };
    }
    const lits = parts.map(qstr);
    return row.op === "in"
      ? { ok: true, sql: `${field} IN (${lits.join(", ")})` }
      : { ok: true, sql: `(${lits.map((x) => `${field} != ${x}`).join(" AND ")})` };
  }
  const t = row.value.trim();
  if (!t) return { ok: false, error: `Row ${n}: enter a value.` };
  const lit = numeric ? qnum(t, n, "a number for this field") : { ok: true as const, v: qstr(t) };
  if (!lit.ok) return lit;
  switch (row.op) {
    case "eq":
      return { ok: true, sql: `${field} = ${lit.v}` };
    case "neq":
      return { ok: true, sql: `${field} != ${lit.v}` };
    case "contains":
      return { ok: true, sql: `${field} LIKE ${qstr(`%${t}%`)}` };
    case "starts":
      return { ok: true, sql: `${field} LIKE ${qstr(`${t}%`)}` };
    case "ends":
      return { ok: true, sql: `${field} LIKE ${qstr(`%${t}`)}` };
    case "gt":
      return { ok: true, sql: `${field} > ${lit.v}` };
    case "gte":
      return { ok: true, sql: `${field} >= ${lit.v}` };
    case "lt":
      return { ok: true, sql: `${field} < ${lit.v}` };
    case "lte":
      return { ok: true, sql: `${field} <= ${lit.v}` };
    default:
      return { ok: false, error: `Row ${n}: unsupported operator.` };
  }
}

/**
 * Validate CUSTOM row logic like `1 AND (2 OR 3)`. Only row numbers, AND,
 * OR, NOT and parentheses are allowed; every row 1..count must be used.
 */
export function validateCustom(custom: string, count: number): string | null {
  const t = custom.trim();
  if (!t) return "Type the row order, e.g. 1 AND (2 OR 3).";
  const junk = t.replace(/\(|\)|\bAND\b|\bOR\b|\bNOT\b|\d+|\s+/gi, "");
  if (junk) {
    return `Only rows, AND, OR, NOT and ( ) allowed - ${JSON.stringify(junk.slice(0, 12))} isn't.`;
  }
  const tokens = t.match(/\(|\)|\bAND\b|\bOR\b|\bNOT\b|\d+/gi) ?? [];
  let pos = 0;
  const used = new Set<number>();
  const peek = (): string | undefined => tokens[pos];

  function parseExpr(): boolean {
    return parseOr();
  }
  function parseOr(): boolean {
    if (!parseAnd()) return false;
    while (peek()?.toUpperCase() === "OR") {
      pos++;
      if (!parseAnd()) return false;
    }
    return true;
  }
  function parseAnd(): boolean {
    if (!parseUnary()) return false;
    while (peek()?.toUpperCase() === "AND") {
      pos++;
      if (!parseUnary()) return false;
    }
    return true;
  }
  function parseUnary(): boolean {
    if (peek()?.toUpperCase() === "NOT") {
      pos++;
      return parseUnary();
    }
    return parsePrimary();
  }
  function parsePrimary(): boolean {
    const tok = peek();
    if (tok === "(") {
      pos++;
      if (parseExpr() !== true) return false;
      if (peek() !== ")") return false;
      pos++;
      return true;
    }
    if (tok !== undefined && /^\d+$/.test(tok)) {
      const n = Number(tok);
      if (!Number.isInteger(n) || n < 1 || n > count) return false;
      used.add(n);
      pos++;
      return true;
    }
    return false;
  }

  if (!parseExpr()) {
    const at = peek();
    if (at !== undefined && /^\d+$/.test(at)) {
      return `Row ${at} doesn't exist - there ${count === 1 ? "is" : "are"} only ${count} row${count === 1 ? "" : "s"}.`;
    }
    if (pos === 0) return `Expected a row number or ( but found ${JSON.stringify(at ?? "nothing")}.`;
    return "Unbalanced expression - check the AND/OR placement and parentheses.";
  }
  if (pos < tokens.length) {
    if (peek() === ")") return "Unbalanced ) - an opening ( is missing.";
    return `Trailing ${JSON.stringify(peek())} after the expression.`;
  }
  for (let i = 1; i <= count; i++) {
    if (!used.has(i)) return `Row ${i} isn't used - include it or delete the row.`;
  }
  return null;
}

/**
 * Compile rows + logic to a JsonQL string. Numbers in CUSTOM logic are
 * replaced by their row conditions, so `(1 AND 2 AND (3 OR 4))` works.
 */
export function buildQuery(
  rows: BuilderRow[],
  logic: BuilderLogic,
  isNumeric: (field: string) => boolean
): QueryResult {
  if (rows.length === 0) return { ok: false, error: "Add a row first." };
  const conds: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const c = buildCondition(rows[i], isNumeric(rows[i].field), i + 1);
    if (!c.ok) return c;
    conds.push(c.sql);
  }
  if (logic.mode === "all-and") {
    return { ok: true, query: conds.length === 1 ? conds[0] : conds.map((s) => `(${s})`).join(" AND ") };
  }
  if (logic.mode === "all-or") {
    return { ok: true, query: conds.length === 1 ? conds[0] : conds.map((s) => `(${s})`).join(" OR ") };
  }
  const problem = validateCustom(logic.custom, rows.length);
  if (problem) return { ok: false, error: problem };
  const query = logic.custom.replace(/\d+/g, (m) => `(${conds[Number(m) - 1]})`);
  return { ok: true, query };
}
