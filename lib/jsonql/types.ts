/**
 * JSON Search Engine - Core Type Definitions
 * 
 * This file contains all type definitions used throughout the search engine.
 * It defines the query AST, token kinds, and configuration interfaces.
 * 
 * @module types
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * JSON value type representing any valid JSON data structure.
 * This is the fundamental data type used throughout the engine for both
 * indexed data and query literals.
 * 
 * @example
 * ```typescript
 * const valid: JsonValue = "hello";      // string
 * const valid: JsonValue = 42;          // number
 * const valid: JsonValue = true;       // boolean
 * const valid: JsonValue = null;     // null
 * const valid: JsonValue = [1,2,3]; // array
 * const valid: JsonValue = {a: 1};  // object
 * ```
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// ============================================================================
// Token Types - Lexer/Parser
// ============================================================================

/**
 * Token kinds recognized by the lexer.
 * These represent all valid lexical elements in query strings.
 * Keywords are case-insensitive in queries but stored as PascalCase here.
 */
export enum TokenKind {
  /** SELECT keyword - for field projection */
  Select = "Select",
  /** WHERE keyword - for condition start */
  Where = "Where",
  /** AND operator - logical AND */
  And = "And",
  /** OR operator - logical OR */
  Or = "Or",
  /** NOT operator - logical negation */
  Not = "Not",
  /** FUZZY operator - fuzzy text search */
  Fuzzy = "Fuzzy",
  /** IN operator - membership test */
  In = "In",
  /** LIKE operator - pattern matching */
  Like = "Like",
  /** REGEX operator - regex matching */
  Regex = "Regex",
  /** ORDER keyword - ordering start */
  Order = "Order",
  /** BY keyword - ordering direction */
  By = "By",
  /** LIMIT keyword - result limit */
  Limit = "Limit",
  /** OFFSET keyword - result offset */
  Offset = "Offset",
  /** ASC keyword - ascending order */
  Asc = "Asc",
  /** DESC keyword - descending order */
  Desc = "Desc",
  /** NULLS keyword - null ordering */
  Nulls = "Nulls",
  /** FIRST keyword - nulls first */
  First = "First",
  /** LAST keyword - nulls last */
  Last = "Last",
  /** SCORE keyword - relevance score */
  Score = "Score",
  /** CASE keyword - case sensitivity */
  Case = "Case",
  /** SENSITIVE keyword - case sensitive */
  Sensitive = "Sensitive",
  /** INSENSITIVE keyword - case insensitive */
  Insensitive = "Insensitive",
  /** STRICT keyword - strict mode */
  Strict = "Strict",
  /** BETWEEN operator - range test */
  Between = "Between",
  /** CONTAINS operator - substring test */
  Contains = "Contains",
  /** STARTS WITH operator - prefix test */
  Starts = "Starts",
  /** ENDS WITH operator - suffix test */
  Ends = "Ends",
  /** EXISTS operator - field existence */
  Exists = "Exists",
  /** IS keyword - null check */
  Is = "Is",
  /** WITH keyword - paired with other keywords */
  With = "With",
  /** = operator - equality */
  Eq = "Eq",
  /** != operator - inequality */
  Neq = "Neq",
  /** > operator - greater than */
  Gt = "Gt",
  /** >= operator - greater or equal */
  Gte = "Gte",
  /** < operator - less than */
  Lt = "Lt",
  /** <= operator - less or equal */
  Lte = "Lte",
  /** ( character - left parenthesis */
  LParen = "LParen",
  /** ) character - right parenthesis */
  RParen = "RParen",
  /** , character - comma separator */
  Comma = "Comma",
  /** [ character - left bracket */
  LBrack = "LBrack",
  /** ] character - right bracket */
  RBrack = "RBrack",
  /** Identifier - field names, keywords */
  Ident = "Ident",
  /** String literal - quoted text */
  String = "String",
  /** Number literal */
  Number = "Number",
  /** Boolean literal - true/false */
  Bool = "Bool",
  /** Null literal */
  Null = "Null",
  /** End of input marker */
  Eof = "Eof",
}

/**
 * Token represent a single lexical element in a query string.
 * Created by the lexer from raw query text.
 */
export interface Token {
  /** The type of this token */
  kind: TokenKind;
  /** The literal value (string, number, boolean, or null) */
  value: string | number | boolean | null;
  /** Character position in original query string */
  pos: number;
}

// ============================================================================
// Expression Types - Query AST
// ============================================================================

/**
 * Expression AST node types.
 * These represent the parsed structure of WHERE clauses.
 * The query language supports:
 * - Boolean operators: AND, OR, NOT
 * - Term nodes: full-text search terms
 * - Predicate nodes: field comparisons
 * - All node: match everything
 */
export type Expr =
  | { type: "Or"; parts: Expr[] }
  | { type: "And"; parts: Expr[] }
  | { type: "Not"; inner: Expr }
  | { type: "Term"; value: string }
  | { type: "StartsWith"; value: string }
  | { type: "EndsWith"; value: string }
  | { type: "Contains"; value: string }
  | { type: "FuzzyTerm"; value: string }
  | { type: "NumericTerm"; value: string; op: string }
  | { type: "Predicate"; pred: Predicate }
  | { type: "All" };

/**
 * Comparison operators for predicates.
 * These map to SQL-like operators in queries.
 */
export enum Op {
  /** IN - value in list */
  In = "In",
  /** NOT IN - value not in list */
  NotIn = "NotIn",
  /** LIKE - pattern match */
  Like = "Like",
  /** NOT LIKE - negated pattern */
  NotLike = "NotLike",
  /** REGEX - regex match */
  Regex = "Regex",
  /** NOT REGEX - negated regex */
  NotRegex = "NotRegex",
  /** FUZZY - fuzzy match */
  Fuzzy = "Fuzzy",
  /** NOT FUZZY - negated fuzzy */
  NotFuzzy = "NotFuzzy",
  /** BETWEEN - value in range */
  Between = "Between",
  /** CONTAINS - substring */
  Contains = "Contains",
  /** STARTS WITH - prefix */
  StartsWith = "StartsWith",
  /** ENDS WITH - suffix */
  EndsWith = "EndsWith",
  /** EXISTS - field exists */
  Exists = "Exists",
  /** IS NULL - null check */
  IsNull = "IsNull",
  /** IS NOT NULL - not null check */
  IsNotNull = "IsNotNull",
  /** = - equality */
  Eq = "Eq",
  /** != - inequality */
  Neq = "Neq",
  /** > - greater than */
  Gt = "Gt",
  /** >= - greater or equal */
  Gte = "Gte",
  /** < - less than */
  Lt = "Lt",
  /** <= - less or equal */
  Lte = "Lte",
}

/**
 * A predicate represents a single field comparison.
 * Examples: `price > 100`, `name LIKE "%test%"`
 */
export interface Predicate {
  /** Field path (supports dotted notation like "meta.region") */
  field: string;
  /** Comparison operator */
  op: Op;
  /** Right-hand side values */
  values: ValueLit[];
}

/**
 * Literal value types in queries.
 * These are the constant values specified in queries.
 */
export type ValueLit =
  | { type: "Str"; value: string }     // String literal
  | { type: "Num"; value: number }     // Number literal
  | { type: "Bool"; value: boolean } // Boolean literal
  | { type: "Null" }              // Null literal
  | { type: "Arr"; value: JsonValue[] }    // Array literal
  | { type: "Field"; value: string } // Reference to another field
  | { type: "Regex"; value: string } // Regex pattern string
  | { type: "RegexCompiled"; value: RegExp }; // Compiled regex

/**
 * Complete parsed query structure.
 * Contains all components: WHERE, SELECT, ORDER BY, LIMIT, OFFSET.
 */
export interface Query {
  /** Parsed WHERE clause expression */
  expr: Expr;
  /** SELECT clause - fields to return, null = all */
  projection: string[] | null;
  /** ORDER BY specifications */
  orderBy: OrderBy[];
  /** LIMIT value, null = no limit */
  limit: number | null;
  /** OFFSET value, null = no offset */
  offset: number | null;
  /** Case sensitivity for string comparisons */
  caseSensitive: boolean;
  /** Strict mode for type matching */
  strict: boolean;
  /** Whether relevance score is needed */
  scoreNeeded: boolean;
}

/**
 * ORDER BY specification.
 * Controls result ordering.
 */
export interface OrderBy {
  /** Field to order by */
  field: string;
  /** Sort descending if true */
  desc: boolean;
  /** Null ordering preference */
  nullsFirst: boolean | null;
}

/**
 * Context for tracking term frequencies (TF) and document frequencies (DF)
 * during query evaluation for BM25 scoring.
 */
export interface ScoreContext {
  /** Term frequencies in current document: term -> count */
  tfs: Map<string, number>;
  /** Global document frequencies: term -> count of docs containing term */
  dfs: Map<string, number>;
}

/**
 * Evaluation context options.
 * Passed through evaluation chain.
 */
export interface EvalOptions {
  /** Case sensitive string comparison */
  caseSensitive: boolean;
  /** Strict type matching */
  strict: boolean;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Query parse error with position information.
 * Thrown when query syntax is invalid.
 */
export class QueryParseError extends Error {
  constructor(public message: string, public pos: number) {
    super(message);
    this.name = "QueryParseError";
  }
}

/**
 * Validation result from validateQuery().
 */
export interface ValidationResult {
  /** Whether query is valid */
  ok: boolean;
  /** Normalized query string (lowercase keywords) */
  normalized: string | null;
  /** Error details if invalid */
  error: { message: string; pos: number } | null;
}

// ============================================================================
// Index Types
// ============================================================================

/**
 * Index statistics for diagnostics.
 */
export interface IndexStats {
  /** Indexed field name */
  field: string;
  /** Number of unique keys */
  keys: number;
  /** Total index entries */
  entries: number;
}

// ============================================================================
// Pagination Types
// ============================================================================
/**
 * Paged search result.
 */
export interface PagedResult {
  /** Total matching records */
  totalMatches: number;
  /** This page's records */
  rows: JsonValue[];
  /** Maximum relevance score found in this search */
  maxScore?: number;
}

// ============================================================================
// Cache Types
// ============================================================================

/**
 * Cache statistics.
 */
export interface CacheStats {
  /** Cache hits */
  hits: number;
  /** Cache misses */
  misses: number;
  /** Current entries */
  entries: number;
  /** Cache capacity */
  cap: number;
}

/**
 * Engine performance snapshot.
 */
export interface EngineMetricsSnapshot {
  /** Total queries executed */
  queryCount: number;
  /** Average query latency in ms */
  avgLatencyMs: number;
  /** 95th percentile latency in ms */
  p95LatencyMs: number;
  /** Average rows scanned per query */
  rowsScanned: number;
  /** Cache hit rate (0-1) */
  cacheHitRate: number;
}

/**
 * Data size information.
 */
export interface EngineDataSize {
  /** Number of data rows */
  rowCount: number;
  /** Approximate memory in bytes */
  approxBytes: number;
}

// ============================================================================
// Aggregation Types
// ============================================================================

/**
 * Aggregation specification.
 */
export interface AggSpec {
  /** Fields to group by */
  groupBy?: string[];
  /** Aggregations to compute */
  aggs: AggDef[];
  /** Fields to count distinct */
  distinctFields?: string[];
  /** Filter expression */
  filter?: string;
}

/**
 * Single aggregation definition.
 */
export interface AggDef {
  /** Aggregation operation (SUM, AVG, MIN, MAX, COUNT) */
  op: string;
  /** Source field */
  field?: string;
  /** Output alias */
  alias?: string;
}

// ============================================================================
// Engine Configuration
// ============================================================================

/**
 * SearchEngine initialization options.
 */
export interface EngineOptions {
  /** Fields to index on creation */
  indexes?: string[];
  /** Query parse cache size */
  queryCacheCap?: number;
  /** Enable columnar storage */
  columnar?: boolean;
  /** Fields for columnar storage */
  columnarFields?: string[];
}

// ============================================================================
// Search Result Types
// ============================================================================

/**
 * Search result from engine.search().
 */
export interface SearchResult {
  /** Matching records */
  data: JsonValue[];
  /** Total matches (before limit) */
  total: number;
  /** Maximum relevance score found in this search */
  maxScore?: number;
}

/**
 * Index hit with relevance score.
 * Used for scoring-based searches.
 */
export interface IndexHit {
  /** Row index */
  idx: number;
  /** Relevance score */
  score: number;
}

// ============================================================================
// Compiler Types
// ============================================================================

/**
 * Compiled query ready for execution.
 * Returned by compile() function.
 */
export interface CompiledQuery {
  /** Original query string */
  query: string;
  /** Parsed AST */
  ast: Query;
  /** Execution plan */
  plan: ExecutionPlan;
  /** Options used */
  options: CompileOptions;
  /** Execute against data */
  exec(data: JsonValue[]): JsonValue[];
  /** Execute with pagination */
  execPaged(data: JsonValue[], limit?: number, offset?: number): PagedResult;
}

/**
 * Execution plan with steps.
 * Describes how to execute the query.
 */
export interface ExecutionPlan {
  /** Filter step */
  filter?: (item: JsonValue, idx: number) => boolean;
  /** Sort comparator */
  sort?: (a: JsonValue, b: JsonValue) => number;
  /** Projection fields */
  projection?: string[] | null;
  /** Limit count */
  limit?: number | null;
  /** Offset count */
  offset?: number | null;
  /** Post-filter sort for scoring */
  scoreSort?: boolean;
}

/**
 * Options for compile().
 */
export interface CompileOptions {
  /** Case sensitive string comparison */
  caseSensitive?: boolean;
  /** Strict type matching */
  strict?: boolean;
  /** Enable scoring */
  score?: boolean;
  /** Field indexes */
  indexes?: string[];
}

// ============================================================================
// Optimizer Types
// ============================================================================

/**
 * Optimizer rule.
 * Takes AST, returns optimized AST.
 */
export interface OptimizerRule {
  name: string;
  optimize(ast: Query): Query;
}

/**
 * Optimization result.
 */
export interface OptimizationResult {
  /** Original AST */
  original: Query;
  /** Optimized AST */
  optimized: Query;
  /** Rules applied */
  rulesApplied: string[];
}

// ============================================================================
// Plugin Types
// ============================================================================

/**
 * Custom operator function.
 * (value, compare, context) => boolean
 */
export type OperatorFn = (value: JsonValue, compare: JsonValue, context?: JsonValue) => boolean;

/**
 * Custom function.
 * (...args) => JsonValue
 */
export type CustomFn = (...args: JsonValue[]) => JsonValue;

/**
 * Operator registry.
 */
export interface OperatorRegistry {
  /** Register custom operator */
  register(name: string, fn: OperatorFn): void;
  /** Get operator */
  get(name: string): OperatorFn | undefined;
  /** List operators */
  list(): string[];
  /** Clear all */
  clear(): void;
}

/**
 * Function registry.
 */
export interface FunctionRegistry {
  /** Register custom function */
  register(name: string, fn: CustomFn): void;
  /** Get function */
  get(name: string): CustomFn | undefined;
  /** List functions */
  list(): string[];
  /** Clear all */
  clear(): void;
}

// ============================================================================
// Registry Types
// ============================================================================

/**
 * Index registry.
 */
export interface IndexRegistry {
  /** Register index for field */
  register(field: string, index: unknown): void;
  /** Get index for field */
  get(field: string): unknown | undefined;
  /** List indexed fields */
  list(): string[];
  /** Clear all */
  clear(): void;
}