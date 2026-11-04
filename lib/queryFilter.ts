/**
 * JsonQL adapter for the Query tab: filter + aggregate SOQL/SOSL result
 * rows client-side with the vendored engine (lib/jsonql). Engines are
 * cached per result array so typing never rebuilds indexes.
 */
import { initEngine, validate, type SearchEngine } from "./jsonql/engine-class";
import type { AggSpec, JsonValue } from "./jsonql/types";

const engines = new WeakMap<object, SearchEngine>();

type Rec = Record<string, unknown>;

/** Strip Salesforce `attributes` envelopes recursively - they pollute search. */
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value !== null && typeof value === "object") {
    const out: Rec = {};
    for (const [k, v] of Object.entries(value as Rec)) {
      if (k === "attributes") continue;
      out[k] = clean(v);
    }
    return out;
  }
  return value;
}

function engineFor(records: unknown[]): SearchEngine {
  const cleaned = (records as Rec[]).map((r) => clean(r) as Rec);
  const key = records as unknown as object;
  let engine = engines.get(key);
  if (!engine) {
    engine = initEngine(cleaned as unknown as JsonValue[]);
    engines.set(key, engine);
  }
  return engine;
}

export type FilterOutcome = { ok: true; rows: unknown[] } | { ok: false; error: string };

/** Null when the query parses; otherwise a human syntax error. */
export function checkQuery(query: string): string | null {
  const q = query.trim();
  if (!q) return null;
  try {
    const v = validate(q);
    if (!v.ok) {
      const where = v.error ? ` (near position ${v.error.pos})` : "";
      return `${v.error?.message ?? "Invalid query"}${where}`;
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Invalid query";
  }
}

/** SQL-style filter over pulled rows. Empty query returns every row. */
export function filterRecords(records: unknown[], query: string): FilterOutcome {
  const q = query.trim();
  if (!q) return { ok: true, rows: records };
  const problem = checkQuery(q);
  if (problem) return { ok: false, error: problem };
  try {
    const engine = engineFor(records);
    const out = engine.search(q);
    return { ok: true, rows: out.data as unknown[] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Filter failed" };
  }
}

/** Group + SUM/AVG/MIN/MAX/COUNT over pulled rows. */
export function aggregateRecords(records: unknown[], spec: AggSpec): FilterOutcome {
  try {
    const engine = engineFor(records);
    const rows = engine.aggregate(spec);
    return { ok: true, rows: rows as unknown[] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Aggregate failed" };
  }
}

export { recordFields, valueChips, numericFields } from "./queryFieldStats";
export type { ValueChip } from "./queryFieldStats";

export type { AggSpec };
