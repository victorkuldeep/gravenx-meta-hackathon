/**
 * JSON Search Engine - SearchEngine Class
 * 
 * Main SearchEngine class that ties everything together.
 * 
 * Features:
 * - Field indexing for fast lookups
 * - Result caching with adaptive thresholds
 * - Metrics tracking
 * - Pagination support
 * - Aggregations
 * 
 * @module engine-class
 */

import {
  JsonValue,
  Query,
  PagedResult,
  EngineOptions,
  EngineDataSize,
  CacheStats,
  EngineMetricsSnapshot,
  IndexStats,
  ValidationResult,
  AggSpec,
  SearchResult,
} from "./types";
import { validateQuery } from "./parser";

import { evalExpr, compareForSort } from "./engine";
import { IndexSet } from "./indexes";
import { ResultCache, EngineMetrics, parseQueryCached, setQueryCacheSize } from "./cache";
import { aggregateItems } from "./aggregates";

/** Default fields to index */
const DEFAULT_INDEX_FIELDS = ["category", "country", "active"];
/** Default result cache capacity */
const DEFAULT_RESULT_CACHE_CAP = 128;
/** Minimum hits before caching result */
const DEFAULT_RESULT_CACHE_MIN_HITS = 2;
/** Maximum rows to process */
const MAX_RESULT_ROWS = 1_000_000;

/** Next engine ID */
let nextEngineId = 1;

/**
 * Main SearchEngine class.
 * 
 * Provides high-level API for searching JSON data.
 * Handles caching, indexing, and metrics internally.
 * 
 * @example
 * ```typescript
 * const engine = new SearchEngine(data);
 * 
 * // Simple search
 * const results = engine.search('country = "USA"');
 * 
 * // Paged search
 * const paged = engine.searchPaged('category = "software" LIMIT 10 OFFSET 20');
 * 
 * // Aggregations
 * const stats = engine.aggregate({ groupBy: ['country'], aggs: [{ op: 'COUNT', field: '*' }] });
 * ```
 */
export class SearchEngine {
  /** Unique engine ID */
  readonly id: number;
  /** Data rows */
  private data: JsonValue[] = [];
  /** Field indexes */
  private indexes = new IndexSet();
  /** Indexed field names */
  private indexFields: string[] = [];
  /** Result cache */
  private resultCache = new ResultCache(DEFAULT_RESULT_CACHE_CAP, DEFAULT_RESULT_CACHE_MIN_HITS);
  /** Performance metrics */
  private metrics = new EngineMetrics();
  /** Approximate memory usage */
  private approxBytes = 0;
  /** Document lengths for BM25 */
  private docLengths: Uint32Array = new Uint32Array(0);
  /** Average document length for BM25 */
  private avgdl = 0;

  /**
   * Create a new SearchEngine.
   * 
   * @param data - Array of JSON objects to search
   * @param options - Engine configuration
   */
  constructor(data: JsonValue[], options: EngineOptions = {}) {
    this.id = nextEngineId++;
    this.setData(data, options);
  }

  /**
   * Set or update data.
   * Rebuilds indexes and clears cache.
   */
  setData(data: JsonValue[], options: EngineOptions = {}): void {
    this.data = data;
    if (options.queryCacheCap) {
      setQueryCacheSize(options.queryCacheCap);
    }

    // Build indexes
    const indexFields = options.indexes?.length ? options.indexes! : DEFAULT_INDEX_FIELDS;
    this.indexFields = indexFields;
    this.indexes.buildAll(data, indexFields);
    
    // Calculate memory
    this.approxBytes = JSON.stringify(data).length;

    // Calculate document lengths and avgdl for scoring
    this.docLengths = new Uint32Array(data.length);
    let totalLen = 0;
    for (let i = 0; i < data.length; i++) {
      const len = JSON.stringify(data[i]).length;
      this.docLengths[i] = len;
      totalLen += len;
    }
    this.avgdl = data.length > 0 ? totalLen / data.length : 0;
    
    // Reset cache and metrics
    this.resultCache = new ResultCache(DEFAULT_RESULT_CACHE_CAP, DEFAULT_RESULT_CACHE_MIN_HITS);
    this.metrics = new EngineMetrics();
  }

  /**
   * Execute a search query.
   * 
   * @param query - Query string
   * @returns SearchResult with matching rows
   */
  search(query: string): SearchResult {
    const started = performance.now();
    const parsed = parseQueryCached(query);
    const options = {
      caseSensitive: parsed.caseSensitive,
      strict: parsed.strict,
    };

    // Check result cache
    const cached = this.resultCache.get(query);
    let indices: number[];
    let scores: Map<number, number> | undefined;

    if (cached) {
      indices = cached;
      this.metrics.record(0, 0, true);
    } else {
          // Execute search
      const res = this.executeSearchIndices(parsed, options);
      indices = res.indices;
      scores = res.scores;
      const maxScore = res.maxScore;
      this.resultCache.record(query, indices);
      const elapsed = performance.now() - started;
      this.metrics.record(elapsed, indices.length, false);

      // Adaptive caching based on latency
      if (this.metrics.p95Latency() > 50) {
        this.resultCache.setMinHits(1);
      } else {
        this.resultCache.setMinHits(DEFAULT_RESULT_CACHE_MIN_HITS);
      }

      // Map indices to rows and attach scores if requested
      const offset = parsed.offset ?? 0;
      const limit = parsed.limit ?? MAX_RESULT_ROWS;
      const pagedIndices = indices.slice(offset, offset + limit);

      const rows = pagedIndices.map(i => {
        const row = this.data[i];
        if (parsed.scoreNeeded && scores) {
          const score = scores.get(i) || 0;
          return { ...(row as object), SCORE: score } as JsonValue;
        }
        return row;
      });

      return { data: rows, total: indices.length, maxScore };
    }

    // Map indices to rows (Cache hit case)
    const offset = parsed.offset ?? 0;
    const limit = parsed.limit ?? MAX_RESULT_ROWS;
    const pagedIndices = indices.slice(offset, offset + limit);
    const rows = pagedIndices.map(i => this.data[i]);
    return { data: rows, total: indices.length };
  }

  /**
   * Execute a paged search.
   * 
   * @param query - Query string with LIMIT/OFFSET
   * @returns PagedResult with rows and total count
   */
  searchPaged(query: string): PagedResult {
    const parsed = parseQueryCached(query);
    const options = {
      caseSensitive: parsed.caseSensitive,
      strict: parsed.strict,
    };

    // Create cache key without pagination for caching
    let cacheKey = query.toUpperCase().replace(/LIMIT\s+\d+\s*\d*/i, "").trim();
    if (!parsed.orderBy.length) {
      cacheKey = query;
    }
    const cached = this.resultCache.get(cacheKey);
    let indices: number[];
    let scores: Map<number, number> | undefined;
    let maxScore: number | undefined;

    if (cached) {
      indices = cached;
      this.metrics.record(0, 0, true);
    } else {
      const res = this.executeSearchIndices(parsed, options);
      indices = res.indices;
      scores = res.scores;
      maxScore = res.maxScore;
      if (cacheKey) {
        this.resultCache.record(cacheKey, indices);
      }
    }

    // Apply pagination
    const offset = parsed.offset ?? 0;
    const limit = parsed.limit ?? MAX_RESULT_ROWS;
    const paged = indices.slice(offset, offset + limit);

    const rows = paged.map(i => {
      const row = this.data[i];
      if (parsed.scoreNeeded && scores) {
        const score = scores.get(i) || 0;
        return { ...(row as object), SCORE: score } as JsonValue;
      }
      return row;
    });
    return { totalMatches: indices.length, rows, maxScore };
  }

  /**
   * Execute search and return row indices and scores.
   * Applies sorting if ORDER BY specified.
   */
  executeSearchIndices(query: Query, options: { caseSensitive: boolean; strict: boolean }): { indices: number[]; scores?: Map<number, number>; maxScore?: number } {
    const indices: number[] = [];
    const hits: { idx: number; score: number }[] = [];
    const dfMap = new Map<string, number>();
    const tfList: Map<string, number>[] = [];
    const scoreMap = new Map<number, number>();
    let maxScore = 0;

    // Pass 1: Filter and collect TFs/DFs if scoring needed
    for (let i = 0; i < this.data.length; i++) {
      if (query.scoreNeeded) {
        const scoreCtx = { tfs: new Map<string, number>(), dfs: dfMap };
        if (evalExpr(query.expr, this.data[i], options, i, scoreCtx)) {
          indices.push(i);
          tfList.push(scoreCtx.tfs);
          // Update global DFs for terms found in this doc
          for (const term of scoreCtx.tfs.keys()) {
            dfMap.set(term, (dfMap.get(term) || 0) + 1);
          }
        }
      } else {
        if (evalExpr(query.expr, this.data[i], options, i)) {
          indices.push(i);
        }
      }
    }

    // Pass 2: Calculate BM25 scores if needed
    if (query.scoreNeeded) {
      const k1 = 1.2;
      const b = 0.75;
      const N = this.data.length;

      for (let j = 0; j < indices.length; j++) {
        const idx = indices[j];
        const tfs = tfList[j];
        const dl = this.docLengths[idx];
        let score = 0;

        for (const [term, tf] of tfs.entries()) {
          const df = dfMap.get(term) || 0;
          const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
          // BM25 Formula
          const termScore = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / this.avgdl)));
          score += termScore;
        }
        hits.push({ idx, score });
        scoreMap.set(idx, score);
        if (score > maxScore) maxScore = score;
      }
    }

    // Apply sorting
    if (query.orderBy.length > 0) {
      const sortHits = query.scoreNeeded 
        ? hits.map(h => ({ idx: h.idx, item: this.data[h.idx], score: h.score }))
        : indices.map(idx => ({ idx, item: this.data[idx], score: 0 }));

      sortHits.sort((a, b) => compareForSort(a.item, b.item, query.orderBy, options, a.score, b.score));

      const offset = query.offset ?? 0;
      const limit = query.limit ?? MAX_RESULT_ROWS;
      const finalIndices = sortHits.slice(offset, offset + limit).map(h => h.idx);
      return { 
        indices: finalIndices, 
        scores: query.scoreNeeded ? scoreMap : undefined,
        maxScore: query.scoreNeeded ? maxScore : undefined
      };
    }

    return { 
      indices, 
      scores: query.scoreNeeded ? scoreMap : undefined,
      maxScore: query.scoreNeeded ? maxScore : undefined
    };
  }

  /**
   * Run aggregations on data.
   * 
   * @param spec - Aggregation specification
   * @returns Aggregation results
   */
  aggregate(spec: AggSpec): JsonValue[] {
    return aggregateItems(this.data, spec);
  }

  /**
   * Validate a query string.
   * 
   * @param query - Query string
   * @returns Validation result
   */
  validate(query: string): ValidationResult {
    return validateQuery(query);
  }

  /**
   * Get result cache statistics.
   */
  getCacheStats(): CacheStats {
    return this.resultCache.stats();
  }

  /**
   * Get performance metrics.
   */
  getMetrics(): EngineMetricsSnapshot {
    return this.metrics.snapshot();
  }

  /**
   * Get data size information.
   */
  getDataSize(): EngineDataSize {
    return {
      rowCount: this.data.length,
      approxBytes: this.approxBytes,
    };
  }

  /**
   * Get index statistics.
   */
  getIndexes(): IndexStats[] {
    return this.indexes.list();
  }

  /**
   * Create index for a field.
   */
  createIndex(field: string): void {
    this.indexes.create(field, this.data);
    if (!this.indexFields.includes(field)) {
      this.indexFields.push(field);
    }
  }

  /**
   * Drop index for a field.
   */
  dropIndex(field: string): void {
    this.indexes.drop(field);
    this.indexFields = this.indexFields.filter(f => f !== field);
  }

  /**
   * Update engine data.
   */
  update(data: JsonValue[]): void {
    this.setData(data, { indexes: this.indexFields });
  }

  // ============================================================================
  // Static Methods
  // ============================================================================

  /**
   * Static: Search data without creating engine.
   */
  static searchJson(items: JsonValue[], query: string): JsonValue[] {
    const engine = new SearchEngine(items);
    return engine.search(query).data;
  }

  /**
   * Static: Paged search without creating engine.
   */
  static searchJsonPaged(items: JsonValue[], query: string): PagedResult {
    const engine = new SearchEngine(items);
    return engine.searchPaged(query);
  }

  /**
   * Static: Validate query without engine.
   */
  static validate(query: string): ValidationResult {
    return validateQuery(query);
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new SearchEngine.
 * 
 * @param json - JSON data or string
 * @param options - Engine options
 * @returns Configured SearchEngine
 */
export function initEngine(json: JsonValue[] | string, options: EngineOptions = {}): SearchEngine {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  return new SearchEngine(data, options);
}

/**
 * Quick search function.
 * Creates temporary engine.
 */
export function searchJson(items: JsonValue[], query: string): JsonValue[] {
  return SearchEngine.searchJson(items, query);
}

/**
 * Quick paged search function.
 */
export function searchJsonPaged(items: JsonValue[], query: string): PagedResult {
  return SearchEngine.searchJsonPaged(items, query);
}

/**
 * Quick validation function.
 */
export function validate(query: string): ValidationResult {
  return validateQuery(query);
}

/**
 * Set global query cache size.
 */
export function setCacheSize(cap: number): void {
  setQueryCacheSize(cap);
}