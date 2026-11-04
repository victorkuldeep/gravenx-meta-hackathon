/**
 * JSON Search Engine - Caching and Metrics
 * 
 * Provides caching for parsed queries and search results.
 * Also tracks performance metrics for optimization.
 * 
 * Two-level caching:
 * 1. Query parse cache - parsed Query AST
 * 2. Result cache - matching row indices
 * 
 * Metrics tracked:
 * - Query count and latency
 * - Cache hit/miss ratio
 * - p95 latency for adaptive caching
 * 
 * @module cache
 */

import { CacheStats, EngineMetricsSnapshot, Query } from "./types";
import { parseQuery } from "./parser";

/** Default result cache capacity */
const DEFAULT_RESULT_CACHE_CAP = 128;
/** Minimum hits before caching result */
const DEFAULT_RESULT_CACHE_MIN_HITS = 2;


// ============================================================================
// Result Cache
// ============================================================================

/**
 * Result cache - stores matching row indices.
 * 
 * Uses LRU eviction when full.
 * Only caches results after threshold hits for adaptive behavior.
 * 
 * @example
 * ```typescript
 * const cache = new ResultCache(128, 2);
 * 
 * // Cache hit
 * const rows = cache.get("country = 'USA'");
 * 
 * // Record match
 * cache.record("country = 'USA'", [0, 5, 10]);
 * ```
 */
export class ResultCache {
  private map = new Map<string, { hits: number; data: number[] | null }>();
  private order: string[] = [];
  private cap = DEFAULT_RESULT_CACHE_CAP;
  private minHits = DEFAULT_RESULT_CACHE_MIN_HITS;
  private hitsServed = 0;
  private misses = 0;

  constructor(cap = DEFAULT_RESULT_CACHE_CAP, minHits = DEFAULT_RESULT_CACHE_MIN_HITS) {
    this.cap = cap;
    this.minHits = minHits;
  }

  /** Set cache capacity */
  setCap(cap: number): void {
    this.cap = Math.max(1, cap);
    while (this.order.length > this.cap) {
      const old = this.order.shift();
      if (old) this.map.delete(old);
    }
  }

  /** Set minimum hits threshold */
  setMinHits(minHits: number): void {
    this.minHits = Math.max(1, minHits);
  }

  /**
   * Get cached result.
   * Returns null if not cached.
   * Updates LRU order on hit.
   */
  get(key: string): number[] | null {
    const entry = this.map.get(key);
    if (entry?.data) {
      this.hitsServed++;
      const pos = this.order.indexOf(key);
      if (pos !== -1) {
        this.order.splice(pos, 1);
        this.order.push(key);
      }
      return [...entry.data];
    }
    this.misses++;
    return null;
  }

  /**
   * Record a search result.
   * Only caches if hit threshold reached.
   */
  record(key: string, data: number[]): void {
    const entry = this.map.get(key);
    if (entry) {
      entry.hits++;
      if (entry.data) {
        // Already cached, update LRU
        const pos = this.order.indexOf(key);
        if (pos !== -1) {
          this.order.splice(pos, 1);
          this.order.push(key);
        }
        return;
      }
      // Threshold reached, cache it
      if (entry.hits >= this.minHits) {
        entry.data = [...data];
        this.order.push(key);
        while (this.order.length > this.cap) {
          const old = this.order.shift();
          if (old) {
            const e = this.map.get(old);
            if (e) e.data = null;
          }
        }
      }
    } else {
      this.map.set(key, { hits: 1, data: null });
      this.order.push(key);
    }
  }

  /** Get cache statistics */
  stats(): CacheStats {
    return {
      hits: this.hitsServed,
      misses: this.misses,
      entries: this.order.length,
      cap: this.cap,
    };
  }
}

// ============================================================================
// Query Parse Cache
// ============================================================================

/**
 * Query parse cache - stores parsed Query AST.
 * Avoids re-parsing the same query.
 */
class QueryCache {
  private map = new Map<string, Query>();
  private order: string[] = [];
  private cap = 512;

  setCap(cap: number): void {
    this.cap = Math.max(1, cap);
    while (this.order.length > this.cap) {
      const old = this.order.shift();
      if (old) this.map.delete(old);
    }
  }

  /** Get cached parsed query */
  get(key: string): Query | null {
    const q = this.map.get(key);
    if (q) {
      const pos = this.order.indexOf(key);
      if (pos !== -1) {
        this.order.splice(pos, 1);
        this.order.push(key);
      }
      return q;
    }
    return null;
  }

  /** Cache a parsed query */
  put(key: string, value: Query): void {
    if (this.map.has(key)) {
      const pos = this.order.indexOf(key);
      if (pos !== -1) {
        this.order.splice(pos, 1);
      }
      this.order.push(key);
      this.map.set(key, value);
      return;
    }
    this.map.set(key, value);
    this.order.push(key);
    while (this.order.length > this.cap) {
      const old = this.order.shift();
      if (old) this.map.delete(old);
    }
  }
}

// ============================================================================
// Engine Metrics
// ============================================================================

/**
 * Engine metrics - tracks performance.
 * 
 * Metrics collected:
 * - Total queries run
 * - Average latency
 * - p95 latency (for adaptive caching)
 * - Rows scanned
 * - Cache hit rate
 */
export class EngineMetrics {
  private queryCount = 0;
  private totalMs = 0;
  private latencySamples: number[] = [];
  private rowsScanned = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  /**
   * Record a query execution.
   */
  record(elapsedMs: number, scanned: number, cacheHit: boolean): void {
    this.queryCount++;
    this.totalMs += elapsedMs;
    this.rowsScanned += scanned;
    if (cacheHit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }
    this.latencySamples.push(elapsedMs);
    if (this.latencySamples.length > 200) {
      this.latencySamples.shift();
    }
  }

  /** Average query latency */
  avgLatency(): number {
    if (this.queryCount === 0) return 0;
    return this.totalMs / this.queryCount;
  }

  /** 95th percentile latency */
  p95Latency(): number {
    if (this.latencySamples.length === 0) return 0;
    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
  }

  /** Get metrics snapshot */
  snapshot(): EngineMetricsSnapshot {
    const totalCache = this.cacheHits + this.cacheMisses;
    return {
      queryCount: this.queryCount,
      avgLatencyMs: this.avgLatency(),
      p95LatencyMs: this.p95Latency(),
      rowsScanned: this.rowsScanned,
      cacheHitRate: totalCache === 0 ? 0 : this.cacheHits / totalCache,
    };
  }
}

// ============================================================================
// Global Query Cache
// ============================================================================

/** Global query parse cache (shared across engines) */
const globalQueryCache = new QueryCache();

/**
 * Set global query cache size.
 */
export function setQueryCacheSize(cap: number): void {
  globalQueryCache.setCap(cap);
}

/**
 * Parse query with caching.
 * Checks cache first, parses if needed.
 */
export function parseQueryCached(query: string): Query {
  const key = normalizeQueryKey(query);
  const cached = globalQueryCache.get(key);
  if (cached) return cached;

  const parsed = parseQuery(key);
  globalQueryCache.put(key, parsed);
  return parsed;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize query string for cache key.
 * Collapses whitespace, preserves quoted strings.
 */
function normalizeQueryKey(query: string): string {
  let out = "";
  let lastSpace = false;
  let inQuote: string | null = null;
  for (const ch of query) {
    if (inQuote) {
      out += ch;
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      out += ch;
      lastSpace = false;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (!lastSpace) {
        out += " ";
        lastSpace = true;
      }
    } else {
      out += ch;
      lastSpace = false;
    }
  }
  return out.trim();
}