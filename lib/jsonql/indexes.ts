/**
 * JSON Search Engine - Field Indexing
 * 
 * Field indexing provides fast lookups for exact value queries.
 * Uses inverted indexes - maps values to row indices.
 * 
 * How it works:
 * 1. Index stores: Map<ValueKey → RowIndices[]>
 * 2. When querying with = or IN, we lookup the index
 * 3. Instead of scanning all rows, we use index directly
 * 
 * @module indexes
 */

import { JsonValue, IndexStats } from "./types";
import { getPath, normalizeValue } from "./utils";

/** Inverted index: maps normalized value to row indices */
export type Index = Map<string, number[]>;

/**
 * Single field index.
 * Creates an inverted index for fast exact lookups.
 * 
 * @example
 * ```typescript
 * const idx = new FieldIndex();
 * idx.build(data, "country");
 * 
 * // Fast lookup for country = "USA"
 * const usaRows = idx.get("USA");
 * ```
 */
export class FieldIndex {
  /** Inverted index: value key → row indices */
  private index: Index = new Map();
  /** Whether index is case-sensitive */
  private caseSensitive = false;

  /**
   * Build index from data array.
   * Iterates all rows and indexes the specified field.
   */
  build(data: JsonValue[], field: string, caseSensitive = false): void {
    this.index = new Map();
    this.caseSensitive = caseSensitive;

    for (let i = 0; i < data.length; i++) {
      const value = getPath(data[i], field);
      if (value === undefined) continue;
      this.addValue(value, i);
    }
  }

  /**
   * Add a value to index.
   * Handles arrays by adding each element.
   */
  private addValue(value: JsonValue, idx: number): void {
    if (Array.isArray(value)) {
      for (const v of value) {
        this.addSingleValue(v, idx);
      }
    } else {
      this.addSingleValue(value, idx);
    }
  }

  /**
   * Add a single (non-array) value to index.
   */
  private addSingleValue(value: JsonValue, idx: number): void {
    const key = this.makeKey(value);
    if (!key) return;

    let list = this.index.get(key);
    if (!list) {
      list = [];
      this.index.set(key, list);
    }
    list.push(idx);
  }

  /**
   * Create normalized index key from value.
   * Includes type prefix to avoid collisions.
   */
  private makeKey(value: JsonValue): string | null {
    const normalized = normalizeValue(value, this.caseSensitive);
    if (typeof value === "string") {
      return `s:${normalized}`;
    }
    if (typeof value === "number") {
      return `n:${value}`;
    }
    if (typeof value === "boolean") {
      return `b:${value}`;
    }
    if (value === null) {
      return "null";
    }
    return null;
  }

  /**
   * Get row indices for a value.
   * Fast O(1) lookup instead of O(n) scan.
   */
  get(value: JsonValue): number[] {
    const key = this.makeKey(value);
    if (!key) return [];
    return this.index.get(key) || [];
  }

  /** Get all unique keys in index */
  keys(): string[] {
    return Array.from(this.index.keys());
  }

  /** Get index statistics */
  stats(): { field: string; keys: number; entries: number } {
    let entries = 0;
    for (const list of this.index.values()) {
      entries += list.length;
    }
    return {
      field: "",
      keys: this.index.size,
      entries,
    };
  }
}

/**
 * Collection of field indexes.
 * Manages multiple indexes and provides combined queries.
 */
export class IndexSet {
  /** Map of field name → field index */
  private indexes: Map<string, FieldIndex> = new Map();

  /**
   * Build indexes for multiple fields.
   */
  buildAll(data: JsonValue[], fields: string[]): void {
    for (const field of fields) {
      const idx = new FieldIndex();
      idx.build(data, field);
      this.indexes.set(field, idx);
    }
  }

  /** Get index for a field */
  get(field: string): FieldIndex | undefined {
    return this.indexes.get(field);
  }

  /** Check if field is indexed */
  has(field: string): boolean {
    return this.indexes.has(field);
  }

  /** Get all indexed fields */
  fields(): string[] {
    return Array.from(this.indexes.keys());
  }

  /** List all index statistics */
  list(): IndexStats[] {
    const stats: IndexStats[] = [];
    for (const [field, idx] of this.indexes) {
      let entries = 0;
      for (const list of idx["index"].values()) {
        entries += list.length;
      }
      stats.push({
        field,
        keys: idx["index"].size,
        entries,
      });
    }
    return stats;
  }

  /**
   * Create index for a field.
   */
  create(field: string, data: JsonValue[]): void {
    const idx = new FieldIndex();
    idx.build(data, field);
    this.indexes.set(field, idx);
  }

  /** Drop index for a field */
  drop(field: string): void {
    this.indexes.delete(field);
  }
}

// ============================================================================
// Index-Based Query Optimization
// ============================================================================

/**
 * Extract potential index filters from expression.
 * Finds predicates that can use indexes (= or IN).
 */
export function collectIndexFilters(expr: unknown): { field: string; values: unknown[] }[] {
  const filters: { field: string; values: unknown[] }[] = [];

  function walk(e: unknown): void {
    if (!e) return;
    const expr = e as { type: string; parts?: unknown[]; inner?: unknown; pred?: unknown };
    
    if (expr.type === "And" && expr.parts) {
      // AND: walk all parts
      for (const p of expr.parts) walk(p);
    } else if (expr.type === "Predicate" && expr.pred) {
      const pred = expr.pred as { field: string; op: string; values: unknown[] };
      // Only use = and IN operators
      if (pred.op === "Eq" || pred.op === "In") {
        filters.push({ field: pred.field, values: pred.values });
      }
    }
  }

  walk(expr);
  return filters;
}

/**
 * Use indexes to find matching rows.
 * Intersects results from multiple index lookups.
 * 
 * @returns Row indices that match all filters, or null if not optimizable
 */
export function useIndexes(
  indexes: IndexSet,
  filters: { field: string; values: unknown[] }[]
): number[] | null {
  if (filters.length === 0) return null;

  const sets: number[][] = [];

  for (const filter of filters) {
    const idx = indexes.get(filter.field);
    if (!idx) return null;

    // Collect all row indices from filter values
    const list: number[] = [];
    for (const v of filter.values) {
      const matches = idx.get(v as JsonValue);
      if (matches) list.push(...matches);
    }

    if (list.length > 0) {
      // Sort and deduplicate
      list.sort((a, b) => a - b);
      const deduped: number[] = [];
      let prev = -1;
      for (const x of list) {
        if (x !== prev) {
          deduped.push(x);
          prev = x;
        }
      }
      sets.push(deduped);
    }
  }

  if (sets.length === 0) return null;

  // Intersect sets (smallest first for efficiency)
  sets.sort((a, b) => a.length - b.length);

  let result = sets[0];
  for (let i = 1; i < sets.length; i++) {
    const next: number[] = [];
    let j = 0;
    let k = 0;
    // Merge intersection
    while (j < result.length && k < sets[i].length) {
      if (result[j] === sets[i][k]) {
        next.push(result[j]);
        j++;
        k++;
      } else if (result[j] < sets[i][k]) {
        j++;
      } else {
        k++;
      }
    }
    result = next;
    if (result.length === 0) return null;
  }

  return result;
}