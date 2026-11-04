/**
 * JSON Search Engine - Compiler
 * 
 * Provides compile() API for precompiling queries for reuse,
 * optimizer, execution planner, and plugin registries.
 * 
 * @module compile
 */

import { JsonValue, Query, CompileOptions, CompiledQuery, ExecutionPlan, OptimizerRule, OptimizationResult, OperatorRegistry, FunctionRegistry, EvalOptions, Expr, OrderBy, PagedResult } from "./types";
import { parseQueryCached } from "./cache";
import { evalExpr, compareForSort } from "./engine";

// ============================================================================
// Global Registries
// ============================================================================

const operators: Map<string, (value: JsonValue, compare: JsonValue, context?: JsonValue) => boolean> = new Map();
const functions: Map<string, (...args: JsonValue[]) => JsonValue> = new Map();

// ============================================================================
// Optimizer Rules
// ============================================================================

const OPTIMIZER_RULES: OptimizerRule[] = [
  {
    name: "constant-folding",
    optimize: (ast: Query): Query => foldConstants(ast)
  },
  {
    name: "simplify",
    optimize: (ast: Query): Query => simplifyPredicates(ast)
  }
];

/**
 * Fold constant expressions.
 */
function foldConstants(query: Query): Query {
  const expr = query.expr;
  if (!expr) return query;
  
  return {
    ...query,
    expr: foldExpr(expr)
  };
}

function foldExpr(expr: Expr): Expr {
  if (expr.type === "And") {
    const andParts = expr.parts.map(foldExpr);
    const filtered = andParts.filter(p => p.type !== "All");
    if (filtered.length === 0) return { type: "All" };
    if (filtered.length === 1) return filtered[0];
    return { type: "And", parts: filtered };
  }
  
  if (expr.type === "Or") {
    const orParts = expr.parts.map(foldExpr);
    const filtered = orParts.filter(p => p.type !== "All");
    if (filtered.length === 0) return { type: "All" };
    if (filtered.length === 1) return filtered[0];
    return { type: "Or", parts: filtered };
  }
  
  return expr;
}

/**
 * Simplify redundant predicates.
 */
function simplifyPredicates(query: Query): Query {
  const expr = query.expr;
  if (!expr) return query;
  
  return {
    ...query,
    expr: simplifyExpr(expr)
  };
}

function simplifyExpr(expr: Expr): Expr {
  if (expr.type === "And") {
    const parts = expr.parts.map(simplifyExpr);
    const seen = new Set<string>();
    const unique: Expr[] = [];
    for (const p of parts) {
      const key = JSON.stringify(p);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(p);
      }
    }
    if (unique.length === 0) return { type: "All" };
    if (unique.length === 1) return unique[0];
    return { type: "And", parts: unique };
  }
  
  if (expr.type === "Or") {
    const parts = expr.parts.map(simplifyExpr);
    const seen = new Set<string>();
    const unique: Expr[] = [];
    for (const p of parts) {
      const key = JSON.stringify(p);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(p);
      }
    }
    if (unique.length === 0) return { type: "All" };
    if (unique.length === 1) return unique[0];
    return { type: "Or", parts: unique };
  }
  
  return expr;
}

// ============================================================================
// Execution Planner
// ============================================================================

/**
 * Generate execution plan from AST.
 */
function plan(ast: Query, options: CompileOptions): ExecutionPlan {
  const plan: ExecutionPlan = {};
  
  if (ast.expr && ast.expr.type !== "All") {
    plan.filter = (item: JsonValue, idx: number): boolean => {
      const evalOpts: EvalOptions = {
        caseSensitive: options.caseSensitive ?? false,
        strict: options.strict ?? false
      };
      return evalExpr(ast.expr!, item, evalOpts, idx);
    };
  }
  
  if (ast.orderBy) {
    const orderBys = Array.isArray(ast.orderBy) ? ast.orderBy : [ast.orderBy];
    plan.sort = (a: JsonValue, b: JsonValue): number => {
      const cmp = compareForSort(a, b, orderBys as OrderBy[], { caseSensitive: options.caseSensitive ?? false, strict: options.strict ?? false });
      return cmp;
    };
  }
  
  plan.projection = ast.projection;
  plan.limit = ast.limit;
  plan.offset = ast.offset;
  
  return plan;
}

// ============================================================================
// Compile API
// ============================================================================

/**
 * Compile a query string for reuse.
 * 
 * @example
 * ```typescript
 * const compiled = compile('price > 100 ORDER BY name');
 * const result = compiled.exec(data);
 * ```
 */
export function compile(query: string, options?: CompileOptions): CompiledQuery {
  const opts: CompileOptions = {
    caseSensitive: false,
    strict: false,
    score: false,
    ...options
  };
  
  const ast = parseQueryCached(query);

  const execPlan = plan(ast, opts);
  
  return {
    query,
    ast,
    plan: execPlan,
    options: opts,
    exec(data: JsonValue[]): JsonValue[] {
      let result = data;
      
      if (this.plan.filter) {
        const indices: number[] = [];
        for (let i = 0; i < result.length; i++) {
          if (this.plan.filter!(result[i], i)) {
            indices.push(i);
          }
        }
        result = indices.map(i => data[i]);
      }
      
      if (this.plan.sort) {
        result = [...result].sort(this.plan.sort);
      }
      
      const offset = this.plan.offset ?? 0;
      if (offset > 0) {
        result = result.slice(offset);
      }
      
      const limit = this.plan.limit;
      if (limit != null) {
        result = result.slice(0, limit);
      }
      
      return result;
    },
    execPaged(data: JsonValue[], limit?: number, offset?: number): PagedResult {
      let result = data;
      let total = 0;
      
      if (this.plan.filter) {
        const indices: number[] = [];
        for (let i = 0; i < result.length; i++) {
          if (this.plan.filter!(result[i], i)) {
            indices.push(i);
          }
        }
        total = indices.length;
        result = indices.map(i => data[i]);
      } else {
        total = result.length;
      }
      
      if (this.plan.sort) {
        result = [...result].sort(this.plan.sort);
      }
      
      const off = offset ?? this.plan.offset ?? 0;
      if (off > 0) {
        result = result.slice(off);
      }
      
      const lim = limit ?? this.plan.limit ?? result.length;
      result = result.slice(0, lim);
      
      return { totalMatches: total, rows: result };
    }
  };
}

/**
 * Optimize a query AST.
 */
export function optimize(query: Query): OptimizationResult {
  let optimized = query;
  const rulesApplied: string[] = [];
  
  for (const rule of OPTIMIZER_RULES) {
    const before = JSON.stringify(optimized);
    optimized = rule.optimize(optimized);
    const after = JSON.stringify(optimized);
    
    if (before !== after) {
      rulesApplied.push(rule.name);
    }
  }
  
  return {
    original: query,
    optimized,
    rulesApplied
  };
}

// ============================================================================
// Plugin System
// ============================================================================

export const operatorRegistry: OperatorRegistry = {
  register(name: string, fn: (value: JsonValue, compare: JsonValue, context?: JsonValue) => boolean): void {
    operators.set(name.toUpperCase(), fn);
  },
  
  get(name: string): ((value: JsonValue, compare: JsonValue, context?: JsonValue) => boolean) | undefined {
    return operators.get(name.toUpperCase());
  },
  
  list(): string[] {
    return Array.from(operators.keys());
  },
  
  clear(): void {
    operators.clear();
  }
};

export const functionRegistry: FunctionRegistry = {
  register(name: string, fn: (...args: JsonValue[]) => JsonValue): void {
    functions.set(name.toUpperCase(), fn);
  },
  
  get(name: string): ((...args: JsonValue[]) => JsonValue) | undefined {
    return functions.get(name.toUpperCase());
  },
  
  list(): string[] {
    return Array.from(functions.keys());
  },
  
  clear(): void {
    functions.clear();
  }
};

// Pre-register default operators
operatorRegistry.register("ILIKE", (a, b) => {
  if (typeof a === "string" && typeof b === "string") {
    return a.toLowerCase().includes(b.toLowerCase());
  }
  return false;
});

operatorRegistry.register("STARTSWITH", (a, b) => {
  if (typeof a === "string" && typeof b === "string") {
    return a.toLowerCase().startsWith(b.toLowerCase());
  }
  return false;
});

operatorRegistry.register("ENDSWITH", (a, b) => {
  if (typeof a === "string" && typeof b === "string") {
    return a.toLowerCase().endsWith(b.toLowerCase());
  }
  return false;
});