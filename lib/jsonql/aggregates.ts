/**
 * JSON Search Engine - Aggregations
 * 
 * Provides aggregation functions: SUM, AVG, MIN, MAX, COUNT, GROUP BY.
 * 
 * Supported aggregations:
 * - COUNT(field) or COUNT(*) - Count rows/values
 * - SUM(field) - Sum of values
 * - AVG(field) - Average of values
 * - MIN(field) - Minimum value
 * - MAX(field) - Maximum value
 * 
 * GROUP BY groups results by one or more fields.
 * 
 * @module aggregates
 */

import { JsonValue, AggSpec } from "./types";
import { getPath } from "./utils";
import { parseQueryCached } from "./cache";
import { evalExpr } from "./engine";

/** Internal aggregation state per group */
interface AggState {
  count: number;
  sum: number;
  min: number | null;
  max: number | null;
}

/**
 * Aggregate data with optional filtering.
 * 
 * @param data - Data rows
 * @param spec - Aggregation specification
 * @returns Aggregation results
 * 
 * @example
 * ```typescript
 * // Count all
 * aggregateItems(data, { aggs: [{ op: "COUNT", field: "*" }] });
 * 
 * // Sum by group
 * aggregateItems(data, { groupBy: ["country"], aggs: [{ op: "SUM", field: "price" }] });
 * ```
 */
export function aggregateItems(data: JsonValue[], spec: AggSpec): JsonValue[] {
  if (spec.filter) {
    const filtered = filterData(data, spec.filter);
    return aggregateIndices(data, filtered, spec);
  }
  const indices = range(data.length);
  return aggregateIndices(data, indices, spec);
}

/**
 * Aggregate specific indices.
 */
export function aggregateIndices(
  data: JsonValue[],
  indices: number[],
  spec: AggSpec
): JsonValue[] {
  // Distinct query
  if (spec.distinctFields && spec.distinctFields.length > 0 && !spec.groupBy?.length && spec.aggs.length === 0) {
    return distinctIndices(data, indices, spec.distinctFields);
  }

  // Group by processing
  const groups = new Map<string, { keyParts: string[]; obj: Record<string, JsonValue> }>();
  const states = new Map<string, AggState>();

  for (const idx of indices) {
    const item = data[idx];
    const keyParts: string[] = [];
    const groupObj: Record<string, JsonValue> = {};

    // Build group key from GROUP BY fields
    if (spec.groupBy) {
      for (const field of spec.groupBy) {
        const v = getPath(item, field) ?? null;
        keyParts.push(JSON.stringify(v));
        groupObj[field] = v as JsonValue;
      }
    }

    const key = keyParts.join("|");
    if (!groups.has(key)) {
      groups.set(key, { keyParts, obj: groupObj });
      states.set(key, { count: 0, sum: 0, min: null, max: null });
    }

    const state = states.get(key)!;

    // Process each aggregation
    for (const agg of spec.aggs) {
      const op = agg.op.toUpperCase();
      switch (op) {
        case "COUNT":
          // COUNT(*) counts all rows
          if (!agg.field || agg.field === "*") {
            state.count++;
          } else if (getPath(item, agg.field)) {
            state.count++;
          }
          break;
        case "SUM":
        case "AVG":
        case "MIN":
        case "MAX": {
          const field = agg.field;
          if (!field) break;
          const v = getPath(item, field);
          if (typeof v === "number") {
            state.sum += v;
            state.min = state.min === null ? v : Math.min(state.min, v);
            state.max = state.max === null ? v : Math.max(state.max, v);
            state.count++;
          }
          break;
        }
      }
    }
  }

  // Build result rows
  const results: JsonValue[] = [];
  for (const [_key, group] of groups) {
    const state = states.get(_key)!;
    const row: Record<string, JsonValue> = { ...group.obj };

    for (const agg of spec.aggs) {
      const op = agg.op.toUpperCase();
      const alias = agg.alias ?? `${op}_${agg.field ?? "*"}`;
      let value: JsonValue = null;

      switch (op) {
        case "COUNT":
          value = state.count;
          break;
        case "SUM":
          value = state.sum;
          break;
        case "AVG":
          value = state.count > 0 ? state.sum / state.count : null;
          break;
        case "MIN":
          value = state.min;
          break;
        case "MAX":
          value = state.max;
          break;
      }

      row[alias] = value;
    }

    results.push(row);
  }

  return results;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Filter data using a query string.
 * Returns matching row indices.
 */
function filterData(data: JsonValue[], filter: string): number[] {
  const query = parseQueryCached(filter);
  const options = { caseSensitive: query.caseSensitive, strict: query.strict };

  const indices: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (evalExpr(query.expr, data[i], options, i)) {
      indices.push(i);
    }
  }
  return indices;
}

/**
 * Get distinct rows based on fields.
 */
function distinctIndices(
  data: JsonValue[],
  indices: number[],
  fields: string[]
): JsonValue[] {
  const seen = new Set<string>();
  const results: JsonValue[] = [];

  for (const idx of indices) {
    const item = data[idx];
    const keyParts: string[] = [];
    const obj: Record<string, JsonValue> = {};

    for (const f of fields) {
      const v = getPath(item, f) ?? null;
      keyParts.push(JSON.stringify(v));
      obj[f] = v as JsonValue;
    }

    const key = keyParts.join("|");
    if (!seen.has(key)) {
      seen.add(key);
      results.push(obj);
    }
  }

  return results;
}

/**
 * Create range array [0, 1, 2, ..., n-1]
 */
function range(n: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < n; i++) arr.push(i);
  return arr;
}

/**
 * Count rows matching a filter.
 */
export function countAll(data: JsonValue[], filter: string): number {
  return filterData(data, filter).length;
}