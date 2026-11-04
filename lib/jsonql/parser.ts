/**
 * JSON Search Engine - Parser
 * 
 * The parser converts token stream into a Query AST (Abstract Syntax Tree).
 * It's the second stage of query processing.
 * 
 * Grammar supported:
 * - SELECT field1, field2 - Field projection
 * - WHERE expr - Boolean search expression
 * - ORDER BY field [ASC|DESC] [NULLS FIRST|LAST] - Sorting
 * - LIMIT n - Result limit
 * - OFFSET n - Result offset
 * - CASE SENSITIVE/INSENSITIVE - String comparison mode
 * - STRICT - Type strict mode
 * 
 * Boolean operators: AND, OR, NOT
 * Comparison operators: =, !=, >, >=, <, <=, LIKE, IN, BETWEEN, CONTAINS, etc.
 * 
 * @module parser
 */

import { Token, TokenKind, Expr, Op, Predicate, Query, OrderBy, ValueLit, QueryParseError, ValidationResult } from "./types";
import { Lexer, isValidFieldName, validateRegexPattern } from "./lexer";

/**
 * Detect wildcard pattern and return expression type.
 * - *suffix → EndsWith
 * - prefix* → StartsWith
 * - *prefix* → Contains
 * Returns null for plain term.
 */
function detectWildcard(value: string): { type: "EndsWith" | "StartsWith" | "Contains"; value: string } | null {
  if (!value.includes("*") || value.length < 2) return null;
  
  if (value.startsWith("*") && value.endsWith("*")) {
    return { type: "Contains", value: value.slice(1, -1) };
  }
  if (value.startsWith("*")) {
    return { type: "EndsWith", value: value.slice(1) };
  }
  if (value.endsWith("*")) {
    return { type: "StartsWith", value: value.slice(0, -1) };
  }
  return null;
}

/** Maximum nesting depth for expressions to prevent stack overflow */
const MAX_NESTING_DEPTH = 100;

/**
 * Parser class for building Query AST from tokens.
 * 
 * Recursive descent parser supporting the full query grammar.
 * Parses in order: OR → AND → NOT → Primary → Predicate
 * 
 * @example
 * ```typescript
 * const parser = new Parser();
 * const query = parser.parseFull('country = "USA" AND age > 25 ORDER BY name');
 * // Returns:
 * // {
 * //   expr: { type: "And", parts: [...] },
 * //   projection: null,
 * //   orderBy: [{ field: "name", desc: false, nullsFirst: null }],
 * //   ...
 * // }
 * ```
 */
export class Parser {
  /** Token stream */
  private tokens: Token[] = [];
  /** Current position in token stream */
  private pos = 0;
  /** Current nesting depth for parentheses */
  private depth = 0;

  /**
   * Parse tokens into an expression (WHERE clause only).
   * Used internally for sub-expressions.
   */
  parse(tokens: Token[]): Expr {
    this.tokens = tokens;
    this.pos = 0;
    this.depth = 0;
    return this.parseOr();
  }

  /**
   * Parse full query including SELECT, WHERE, ORDER BY, LIMIT, OFFSET.
   * Main entry point for query parsing.
   * 
   * @param input - Normalized query string
   * @returns Complete Query object
   */
  parseFull(input: string): Query {
    const normalized = normalizeQuery(input);
    const lexer = new Lexer();
    const tokens = lexer.tokenize(normalized);
    this.tokens = tokens;
    this.pos = 0;
    this.depth = 0;

    // Empty query - match all
    if (this.peek().kind === TokenKind.Eof) {
      return {
        expr: { type: "All" },
        projection: null,
        orderBy: [],
        limit: null,
        offset: null,
        caseSensitive: false,
        strict: false,
        scoreNeeded: false,
      };
    }

    let expr: Expr;
    let projection: string[] | null = null;

    // Handle SELECT clause
    if (this.peek().kind === TokenKind.Select) {
      this.next();
      projection = this.parseProjectionList();
      if (this.peek().kind === TokenKind.Where) {
        this.next();
        expr = this.parseOr();
      } else {
        expr = { type: "All" };
      }
    } else if (isQueryModifier(this.peek().kind)) {
      // No WHERE clause, start with "All"
      expr = { type: "All" };
    } else {
      // Bare WHERE expression
      expr = this.parseOr();
    }

    // Parse ORDER BY, LIMIT, OFFSET clauses
    const orderBy: OrderBy[] = [];
    let limit: number | null = null;
    let offset: number | null = null;
    let caseSensitive = false;
    let strict = false;

    while (this.peek().kind !== TokenKind.Eof) {
      const tok = this.peek();
      switch (tok.kind) {
        case TokenKind.Case:
          this.next();
          const cs = this.peek();
          if (cs.kind === TokenKind.Sensitive) {
            caseSensitive = true;
            this.next();
          } else if (cs.kind === TokenKind.Insensitive) {
            caseSensitive = false;
            this.next();
          } else {
            throw new QueryParseError("Expected SENSITIVE or INSENSITIVE after CASE", this.peek().pos);
          }
          break;
        case TokenKind.Strict:
          this.next();
          strict = true;
          break;
        case TokenKind.Order:
          this.next();
          this.expect(TokenKind.By, "Expected BY after ORDER");
          orderBy.push(...this.parseOrderByList());
          break;
        case TokenKind.Limit:
          this.next();
          const ln = this.peek();
          if (ln.kind !== TokenKind.Number) {
            throw new QueryParseError("Expected number after LIMIT", this.peek().pos);
          }
          limit = ln.value as number;
          if (limit < 0) {
            throw new QueryParseError("LIMIT must be non-negative", this.peek().pos);
          }
          this.next();
          break;
        case TokenKind.Offset:
          this.next();
          const os = this.peek();
          if (os.kind !== TokenKind.Number) {
            throw new QueryParseError("Expected number after OFFSET", this.peek().pos);
          }
          offset = os.value as number;
          if (offset < 0) {
            throw new QueryParseError("OFFSET must be non-negative", this.peek().pos);
          }
          this.next();
          break;
        case TokenKind.Eof:
          break;
        default:
          throw new QueryParseError("Unexpected trailing input", this.peek().pos);
      }
    }

    // Compile regex patterns
    compileRegexes(expr);
    const projectionHasScore = projection?.some(f => f.toUpperCase() === "SCORE") ?? false;
    const orderHasScore = orderBy.some(o => o.field.toUpperCase() === "SCORE");
    const scoreNeeded = projectionHasScore || orderHasScore;

    return { expr, projection, orderBy, limit, offset, caseSensitive, strict, scoreNeeded };
  }

  // ============================================================================
  // Token Stream Navigation
  // ============================================================================

  /** Peek at current token without consuming */
  private peek(): Token {
    return this.tokens[this.pos];
  }

  /** Consume and return current token */
  private next(): Token {
    const tok = this.tokens[this.pos];
    this.pos++;
    return tok;
  }

  /** Expect a specific token kind, throw if not found */
  private expect(kind: TokenKind, msg: string): void {
    const tok = this.peek();
    if (tok.kind === kind) {
      this.next();
    } else {
      throw new QueryParseError(msg, tok.pos);
    }
  }

  // ============================================================================
  // Expression Parsing - Recursive Descent
  // ============================================================================

  /**
   * Parse OR expression.
   * OR has lowest precedence, parsed first.
   * a OR b OR c → { type: "Or", parts: [a, b, c] }
   */
  private parseOr(): Expr {
    const parts: Expr[] = [this.parseAnd()];
    while (this.peek().kind === TokenKind.Or) {
      this.next();
      parts.push(this.parseAnd());
    }
    if (parts.length === 1) return parts[0];
    return { type: "Or", parts };
  }

  /**
   * Parse AND expression.
   * AND has higher precedence than OR.
   * a AND b AND c → { type: "And", parts: [a, b, c] }
   */
  private parseAnd(): Expr {
    const parts: Expr[] = [this.parseNot()];
    for (;;) {
      if (this.peek().kind === TokenKind.And) {
        this.next();
        parts.push(this.parseNot());
        continue;
      }
      if (this.isImplicitAndContinuance()) {
        parts.push(this.parseNot());
        continue;
      }
      break;
    }
    if (parts.length === 1) return parts[0];
    return { type: "And", parts };
  }

  /**
   * Adjacent full-text operands without the AND keyword (smart-search / implicit AND).
   */
  private isImplicitAndContinuance(): boolean {
    const k = this.peek().kind;
    return (
      k === TokenKind.Ident ||
      k === TokenKind.String ||
      k === TokenKind.Number ||
      k === TokenKind.LParen ||
      k === TokenKind.Fuzzy ||
      k === TokenKind.Not
    );
  }

  /**
   * Parse NOT expression.
   * Unary operator with highest precedence.
   * NOT a → { type: "Not", inner: a }
   */
  private parseNot(): Expr {
    if (this.peek().kind === TokenKind.Not) {
      this.next();
      this.enterDepth();
      const inner = this.parseNot();
      this.exitDepth();
      return { type: "Not", inner };
    }
    return this.parsePrimary();
  }

  /**
   * Parse primary expression.
   * Handles: parentheses, terms, predicates.
   * 
   * (expr) - Grouped expression
   * "text" - Full-text term
   * FUZZY "text" - Fuzzy search term
   * field = value - Predicate
   */
  private parsePrimary(): Expr {
    const tok = this.peek();
    switch (tok.kind) {
      case TokenKind.LParen:
        this.next();
        this.enterDepth();
        const expr = this.parseOr();
        this.exitDepth();
        this.expect(TokenKind.RParen, "Expected ')'");
        return expr;
      case TokenKind.Eof:
        return { type: "All" };
      case TokenKind.Ident: {
        const identValue = tok.value as string;
        if (this.isPredicateStart()) {
          const pred = this.parsePredicate();
          return { type: "Predicate", pred };
        }
        const wt = detectWildcard(identValue);
        this.next();
        if (wt) return wt as Expr;
        return { type: "Term", value: identValue };
      }
      case TokenKind.Number: {
        const numStr = String(tok.value);
        const nextT = this.tokens[this.pos + 1];
        if (nextT && nextT.kind === TokenKind.Ident && !isPredicateOp(nextT.kind)) {
          const combined = numStr + " " + String(nextT.value);
          this.next();
          this.next();
          const cwt = detectWildcard(combined);
          if (cwt) return cwt as Expr;
          return { type: "Term" as const, value: combined };
        }
        this.next();
        const nwt = detectWildcard(numStr);
        if (nwt) return nwt as Expr;
        return { type: "Term" as const, value: numStr };
      }
      case TokenKind.Fuzzy:
        this.next();
        return { type: "FuzzyTerm", value: this.parseTerm() };
      case TokenKind.String: {
        const s = tok.value as string;
        this.next();
        const swt = detectWildcard(s);
        if (swt) return swt as Expr;
        return { type: "Term", value: s };
      }
      case TokenKind.Gt:
      case TokenKind.Gte:
      case TokenKind.Lt:
      case TokenKind.Lte:
        // Bare comparison operator at start -> numeric comparison across all fields
        // Create a special expression that checks ALL numeric fields
        const optok = this.next();
        const numVal = this.peek();
        if (numVal.kind === TokenKind.Number) {
          const num = numVal.value as number;
          this.next();
          // Return a special term that evaluator will treat as numeric comparison
          // Format: >N for >, <N for <, etc.
          const opChar = optok.kind === TokenKind.Gt ? ">" : 
                      optok.kind === TokenKind.Gte ? ">=" : 
                      optok.kind === TokenKind.Lt ? "<" : "<=";
          return { type: "NumericTerm" as const, value: String(num), op: opChar };
        }
        throw new QueryParseError("Expected number after comparison operator", this.peek().pos);
      case TokenKind.Neq:
        // Could be prefix NOT or !=
        this.next();
        const notVal = this.peek();
        if (notVal.kind === TokenKind.Number) {
          const term = { type: "Term" as const, value: String(notVal.value) };
          this.next();
          return term;
        }
        throw new QueryParseError("Expected value after !", this.peek().pos);
      default:
        throw new QueryParseError("Expected term, predicate, or '('", tok.pos);
    }
  }

  // ============================================================================
  // Predicate Parsing
  // ============================================================================

  /**
   * Check if current position starts a predicate.
   * Looks for: field operator value pattern.
   */
  private isPredicateStart(): boolean {
    const tok = this.peek();
    if (tok.kind !== TokenKind.Ident) return false;
    const next = this.tokens[this.pos + 1];
    if (!next) return false;
    return isPredicateOp(next.kind);
  }

  /**
   * Parse a predicate (field comparison).
   * 
   * Examples:
   * - country = "USA"
   * - age > 25
   * - name LIKE "%test%"
   * - status IN ("a", "b")
   * - price BETWEEN (100, 200)
   */
  private parsePredicate(): Predicate {
    const tok = this.next();
    const field = tok.value as string;
    if (!isValidFieldName(field)) {
      throw new QueryParseError("Invalid field name", tok.pos);
    }

    let pred: Predicate;
    const opTok = this.peek();
    const op = parseOperator(opTok.kind);
    this.next();

    switch (op) {
      case Op.In:
        pred = { field, op, values: this.parseList() };
        break;
      case Op.Like:
      case Op.Contains:
      case Op.Fuzzy:
      case Op.StartsWith:
      case Op.EndsWith:
        // STARTS WITH and ENDS WITH need "WITH" keyword
        if (op === Op.StartsWith) {
          this.expect(TokenKind.With, "Expected WITH after STARTS");
        } else if (op === Op.EndsWith) {
          this.expect(TokenKind.With, "Expected WITH after ENDS");
        }
        pred = { field, op, values: [this.parseValue()] };
        break;
      case Op.Between:
        pred = { field, op, values: this.parseBetween() };
        break;
      case Op.Exists:
        pred = { field, op, values: [] };
        break;
      case Op.IsNull:
      case Op.IsNotNull: {
        const next = this.peek();
        if (next.kind === TokenKind.Not) {
          this.next(); // Consume NOT
          this.expect(TokenKind.Null, "Expected NULL after IS NOT");
          pred = { field, op: Op.IsNotNull, values: [] };
        } else {
          this.expect(TokenKind.Null, "Expected NULL after IS");
          pred = { field, op: Op.IsNull, values: [] };
        }
        break;
      }
      case Op.Regex:
      case Op.NotRegex: {
        const lit = this.parseValue();
        if (lit.type !== "Str") {
          throw new QueryParseError("REGEX expects a string literal", this.peek().pos);
        }
        validateRegexPattern(lit.value, this.peek().pos);
        pred = { field, op, values: [{ type: "Regex", value: lit.value }] };
        break;
      }
      case Op.Eq: {
        const val = this.parseValueFieldable();
        if (val.type === "Str") {
          const wt = detectWildcard(val.value);
          if (wt) {
            const newOp = wt.type === "StartsWith" ? Op.StartsWith : 
                          wt.type === "EndsWith" ? Op.EndsWith : Op.Contains;
            pred = { field, op: newOp, values: [{ type: "Str", value: wt.value }] };
            break;
          }
        }
        pred = { field, op, values: [val] };
        break;
      }
      default:
        pred = { field, op, values: [this.parseValueFieldable()] };
    }

    return pred;
  }

  /**
   * Parse a search term (full-text or fuzzy).
   */
  private parseTerm(): string {
    const tok = this.next();
    if (tok.kind === TokenKind.Ident || tok.kind === TokenKind.String) {
      return tok.value as string;
    }
    throw new QueryParseError("Expected term", tok.pos);
  }

  /**
   * Parse a literal value.
   */
  private parseValue(): ValueLit {
    const tok = this.peek();
    if (tok.kind === TokenKind.LBrack) {
      this.next(); // Consume [
      this.expect(TokenKind.RBrack, "Expected ']' after '['");
      return { type: "Arr", value: [] };
    }
    
    const nextTok = this.next();
    switch (nextTok.kind) {
      case TokenKind.String:
        return { type: "Str", value: nextTok.value as string };
      case TokenKind.Ident:
        return { type: "Str", value: nextTok.value as string };
      case TokenKind.Number:
        return { type: "Num", value: nextTok.value as number };
      case TokenKind.Bool:
        return { type: "Bool", value: nextTok.value as boolean };
      case TokenKind.Null:
        return { type: "Null" };
      default:
        throw new QueryParseError("Expected value", nextTok.pos);
    }
  }

  /**
   * Parse a value that can also be a field reference.
   */
  private parseValueFieldable(): ValueLit {
    const tok = this.peek();
    if (tok.kind === TokenKind.LBrack) {
      this.next(); // Consume [
      this.expect(TokenKind.RBrack, "Expected ']' after '['");
      return { type: "Arr", value: [] };
    }

    const nextTok = this.next();
    switch (nextTok.kind) {
      case TokenKind.String:
        return { type: "Str", value: nextTok.value as string };
      case TokenKind.Ident:
        return { type: "Field", value: nextTok.value as string };
      case TokenKind.Number:
        return { type: "Num", value: nextTok.value as number };
      case TokenKind.Bool:
        return { type: "Bool", value: nextTok.value as boolean };
      case TokenKind.Null:
        return { type: "Null" };
      default:
        throw new QueryParseError("Expected value", nextTok.pos);
    }
  }

  /**
   * Parse comma-separated list in parentheses.
   * Used for IN clause.
   */
  private parseList(): ValueLit[] {
    this.expect(TokenKind.LParen, "Expected '(' after IN");
    const values: ValueLit[] = [];
    if (this.peek().kind === TokenKind.RParen) {
      this.next();
      return values;
    }
    while (true) {
      values.push(this.parseValue());
      if (this.peek().kind === TokenKind.Comma) {
        this.next();
        continue;
      }
      if (this.peek().kind === TokenKind.RParen) {
        this.next();
        break;
      }
      throw new QueryParseError("Expected ',' or ')'", this.peek().pos);
    }
    return values;
  }

  /**
   * Parse BETWEEN clause.
   * Supports both: BETWEEN (a, b) and BETWEEN a AND b
   */
  private parseBetween(): ValueLit[] {
    if (this.peek().kind === TokenKind.LParen) {
      this.next();
      const first = this.parseValueFieldable();
      this.expect(TokenKind.Comma, "Expected ',' in BETWEEN");
      const second = this.parseValueFieldable();
      this.expect(TokenKind.RParen, "Expected ')' after BETWEEN");
      return [first, second];
    }
    const first = this.parseValueFieldable();
    this.expect(TokenKind.And, "Expected AND in BETWEEN");
    const second = this.parseValueFieldable();
    return [first, second];
  }

  /**
   * Parse SELECT field list.
   */
  private parseProjectionList(): string[] {
    const fields: string[] = [];
    while (true) {
      const tok = this.peek();
      if (tok.kind === TokenKind.Ident) {
        fields.push(tok.value as string);
        this.next();
      } else if (tok.kind === TokenKind.Score) {
        fields.push("SCORE");
        this.next();
      } else {
        throw new QueryParseError("Expected field in SELECT", tok.pos);
      }
      if (this.peek().kind === TokenKind.Comma) {
        this.next();
        continue;
      }
      break;
    }
    return fields;
  }

  /**
   * Parse ORDER BY clause with support for multiple comma-separated fields.
   */
  private parseOrderByList(): OrderBy[] {
    const list: OrderBy[] = [];
    while (true) {
      list.push(this.parseOrderBy());
      if (this.peek().kind === TokenKind.Comma) {
        this.next();
        continue;
      }
      break;
    }
    return list;
  }

  /**
   * Parse a single sort specification in ORDER BY.
   */
  private parseOrderBy(): OrderBy {
    const tok = this.peek();
    let field: string;
    if (tok.kind === TokenKind.Ident) {
      field = tok.value as string;
      this.next();
    } else if (tok.kind === TokenKind.Score) {
      field = "SCORE";
      this.next();
    } else {
      throw new QueryParseError("Expected field after ORDER BY", tok.pos);
    }

    let desc = false;
    if (this.peek().kind === TokenKind.Desc) {
      desc = true;
      this.next();
    } else if (this.peek().kind === TokenKind.Asc) {
      this.next();
    }

    let nullsFirst: boolean | null = null;
    if (this.peek().kind === TokenKind.Nulls) {
      this.next();
      const nf = this.peek();
      if (nf.kind === TokenKind.First) {
        nullsFirst = true;
        this.next();
      } else if (nf.kind === TokenKind.Last) {
        nullsFirst = false;
        this.next();
      } else {
        throw new QueryParseError("Expected FIRST or LAST after NULLS", this.peek().pos);
      }
    }

    return { field, desc, nullsFirst };
  }

  // ============================================================================
  // Depth Tracking
  // ============================================================================

  /** Track nesting depth for parentheses */
  private enterDepth(): void {
    this.depth++;
    if (this.depth > MAX_NESTING_DEPTH) {
      throw new QueryParseError(`Max nesting depth exceeded (${MAX_NESTING_DEPTH})`, this.peek().pos);
    }
  }

  private exitDepth(): void {
    if (this.depth > 0) this.depth--;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if token kind starts a predicate.
 */
function isPredicateOp(kind: TokenKind): boolean {
  return (
    kind === TokenKind.In ||
    kind === TokenKind.Like ||
    kind === TokenKind.Regex ||
    kind === TokenKind.Fuzzy ||
    kind === TokenKind.Not ||
    kind === TokenKind.Between ||
    kind === TokenKind.Contains ||
    kind === TokenKind.Starts ||
    kind === TokenKind.Ends ||
    kind === TokenKind.Exists ||
    kind === TokenKind.Is ||
    kind === TokenKind.Eq ||
    kind === TokenKind.Neq ||
    kind === TokenKind.Gt ||
    kind === TokenKind.Gte ||
    kind === TokenKind.Lt ||
    kind === TokenKind.Lte
  );
}

/**
 * Check if token kind is a query modifier (ORDER, LIMIT, etc.)
 */
function isQueryModifier(kind: TokenKind): boolean {
  return (
    kind === TokenKind.Order ||
    kind === TokenKind.Limit ||
    kind === TokenKind.Offset ||
    kind === TokenKind.Case ||
    kind === TokenKind.Strict ||
    kind === TokenKind.Eof
  );
}

/**
 * Convert TokenKind to Op enum.
 */
function parseOperator(kind: TokenKind): Op {
  switch (kind) {
    case TokenKind.In: return Op.In;
    case TokenKind.Like: return Op.Like;
    case TokenKind.Regex: return Op.Regex;
    case TokenKind.Fuzzy: return Op.Fuzzy;
    case TokenKind.Between: return Op.Between;
    case TokenKind.Contains: return Op.Contains;
    case TokenKind.Starts: return Op.StartsWith;
    case TokenKind.Ends: return Op.EndsWith;
    case TokenKind.Exists: return Op.Exists;
    case TokenKind.Is: return Op.IsNull;
    case TokenKind.Eq: return Op.Eq;
    case TokenKind.Neq: return Op.Neq;
    case TokenKind.Gt: return Op.Gt;
    case TokenKind.Gte: return Op.Gte;
    case TokenKind.Lt: return Op.Lt;
    case TokenKind.Lte: return Op.Lte;
    default:
      throw new QueryParseError("Expected operator", 0);
  }
}

/**
 * Normalize query string.
 * Collapses multiple whitespace into single space.
 * Preserves spaces inside quoted strings.
 */
function normalizeQuery(query: string): string {
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
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
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

/**
 * Compile regex string patterns to RegExp objects.
 * Called after parsing, before evaluation.
 */
function compileRegexes(expr: Expr): void {
  if (expr.type === "Or" || expr.type === "And") {
    for (const p of expr.parts) compileRegexes(p);
  } else if (expr.type === "Not") {
    compileRegexes(expr.inner);
  } else if (expr.type === "Predicate") {
    const pred = expr.pred;
    if (pred.op === Op.Regex || pred.op === Op.NotRegex) {
      if (pred.values[0]?.type === "Regex") {
        try {
          pred.values[0] = { type: "RegexCompiled", value: new RegExp(pred.values[0].value) };
        } catch {
          throw new QueryParseError("Invalid REGEX pattern", 0);
        }
      }
    }
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a query string into a Query object.
 * Main entry point for query parsing.
 * 
 * @param query - Query string
 * @returns Parsed Query AST
 * @throws QueryParseError if query is invalid
 */
export function parseQuery(query: string): Query {
  const parser = new Parser();
  const normalized = normalizeQuery(query);
  return parser.parseFull(normalized);
}

/**
 * Validate a query string without fully parsing.
 * 
 * @param query - Query string
 * @returns Validation result with normalized query or error
 */
export function validateQuery(query: string): ValidationResult {
  const normalized = normalizeQuery(query);
  try {
    parseQuery(normalized);
    return { ok: true, normalized, error: null };
  } catch (e) {
    const err = e as Error;
    return { ok: false, normalized: null, error: { message: err.message, pos: 0 } };
  }
}
