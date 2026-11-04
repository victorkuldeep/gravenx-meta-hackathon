/**
 * JSON Search Engine - Lexer (Tokenizer)
 * 
 * The lexer converts a query string into a stream of tokens.
 * It's the first stage of query processing.
 * 
 * Tokenization process:
 * 1. Read characters one by one
 * 2. Identify token type (keyword, identifier, string, number, operator)
 * 3. Build token list with position information
 * 
 * @module lexer
 */

import { Token, TokenKind, QueryParseError } from "./types";

/**
 * Lexer class for tokenizing query strings.
 * 
 * Handles:
 * - Keywords (SELECT, WHERE, AND, OR, etc.)
 * - Identifiers (field names)
 * - String/number/boolean literals
 * - Operators (=, !=, >, <, etc.)
 * - Parentheses and commas
 * 
 * @example
 * ```typescript
 * const lexer = new Lexer();
 * const tokens = lexer.tokenize('country = "USA" AND age > 25');
 * // [
 * //   { kind: TokenKind.Ident, value: "country", pos: 0 },
 * //   { kind: TokenKind.Eq, value: null, pos: 8 },
 * //   { kind: TokenKind.String, value: "USA", pos: 10 },
 * //   { kind: TokenKind.And, value: null, pos: 16 },
 * //   { kind: TokenKind.Ident, value: "age", pos: 20 },
 * //   { kind: TokenKind.Gt, value: null, pos: 24 },
 * //   { kind: TokenKind.Number, value: 25, pos: 26 },
 * //   { kind: TokenKind.Eof, value: null, pos: 28 }
 * // ]
 * ```
 */
export class Lexer {
  /** Accumulated tokens */
  private tokens: Token[] = [];
  /** Current position in input */
  private pos = 0;
  /** Original input string */
  private input = "";

  /**
   * Tokenize a query string into a token stream.
   * 
   * @param input - Raw query string
   * @returns Array of tokens
   * @throws QueryParseError if query is too long or contains invalid characters
   */
  tokenize(input: string): Token[] {
    this.input = input;
    this.pos = 0;
    this.tokens = [];

    // Limit query length to prevent DoS
    if (input.length > 8192) {
      throw new QueryParseError(`Query length exceeds 8192 characters`, 0);
    }

    // Main tokenization loop
    while (this.pos < this.input.length) {
      const c = this.input[this.pos];
      
      // Skip whitespace
      if (isWhitespace(c)) {
        this.pos++;
        continue;
      }

      switch (c) {
        case "(":
          this.tokens.push({ kind: TokenKind.LParen, value: null, pos: this.pos });
          this.pos++;
          break;
        case ")":
          this.tokens.push({ kind: TokenKind.RParen, value: null, pos: this.pos });
          this.pos++;
          break;
        case ",":
          this.tokens.push({ kind: TokenKind.Comma, value: null, pos: this.pos });
          this.pos++;
          break;
        case "[":
          this.tokens.push({ kind: TokenKind.LBrack, value: null, pos: this.pos });
          this.pos++;
          break;
        case "]":
          this.tokens.push({ kind: TokenKind.RBrack, value: null, pos: this.pos });
          this.pos++;
          break;
        case "=":
          this.tokens.push({ kind: TokenKind.Eq, value: null, pos: this.pos });
          this.pos++;
          break;
        case "!":
          // Handle != operator
          if (this.input[this.pos + 1] === "=") {
            this.tokens.push({ kind: TokenKind.Neq, value: null, pos: this.pos });
            this.pos += 2;
          } else {
            throw new QueryParseError(`Unexpected character: !`, this.pos);
          }
          break;
        case ">":
          // Handle > and >= operators
          if (this.input[this.pos + 1] === "=") {
            this.tokens.push({ kind: TokenKind.Gte, value: null, pos: this.pos });
            this.pos += 2;
          } else {
            this.tokens.push({ kind: TokenKind.Gt, value: null, pos: this.pos });
            this.pos++;
          }
          break;
        case "<":
          // Handle < and <= operators
          if (this.input[this.pos + 1] === "=") {
            this.tokens.push({ kind: TokenKind.Lte, value: null, pos: this.pos });
            this.pos += 2;
          } else {
            this.tokens.push({ kind: TokenKind.Lt, value: null, pos: this.pos });
            this.pos++;
          }
          break;
        case "'":
        case "\"":
          // String literals
          this.readString(c);
          break;
        default:
          // Number or identifier (including * for wildcards like Prod*)
          if (isDigit(c) || (c === "." && isDigit(this.input[this.pos + 1]))) {
            this.readNumber();
          } else if (isAlpha(c) || c === "_" || c === "*") {
            this.readIdent();
          } else {
            throw new QueryParseError(`Unexpected character: ${c}`, this.pos);
          }
      }
    }

    // Add end-of-file marker
    this.tokens.push({ kind: TokenKind.Eof, value: null, pos: this.pos });
    return this.tokens;
  }

  /**
   * Read a string literal.
   * Handles both single and double quotes.
   * Supports escape sequences (\\, \", \').
   */
  private readString(quote: string): void {
    const start = this.pos;
    this.pos++;
    let s = "";
    while (this.pos < this.input.length) {
      const c = this.input[this.pos];
      if (c === quote) {
        this.pos++;
        this.tokens.push({ kind: TokenKind.String, value: s, pos: start });
        return;
      }
      // Handle escape sequences
      if (c === "\\" && this.pos + 1 < this.input.length) {
        this.pos++;
        s += this.input[this.pos];
        this.pos++;
        continue;
      }
      s += c;
      this.pos++;
    }
    throw new QueryParseError("Unterminated string literal", start);
  }

  /**
   * Read a numeric literal.
   * Handles integers and decimals.
   */
  private readNumber(): void {
    const start = this.pos;
    let s = "";
    // Check if starts with 0 followed by more digits (like 000001 or 001)
    let hasLeadingZeros = false;
    while (this.pos < this.input.length && (isDigit(this.input[this.pos]) || this.input[this.pos] === ".")) {
      if (this.input[this.pos] === "0" && s === "") {
        hasLeadingZeros = true;
      }
      s += this.input[this.pos];
      this.pos++;
    }
    // If has leading zeros like 000001, treat entire thing as identifier
    // Product codes like "000001" should be treated as string
    if (hasLeadingZeros && s.length > 1) {
      // Read as identifier instead
      this.pos = start;
      this.readIdent();
      return;
    }
    const num = parseFloat(s);
    if (isNaN(num)) {
      throw new QueryParseError("Invalid number", start);
    }
    this.tokens.push({ kind: TokenKind.Number, value: num, pos: start });
  }

  /**
   * Read an identifier or keyword.
   * Converts to uppercase to match against keywords.
   * Handles TRUE, FALSE, NULL as boolean/null literals.
   */
  private readIdent(): void {
    const start = this.pos;
    let s = "";
    while (this.pos < this.input.length && isAlphaNum(this.input[this.pos])) {
      s += this.input[this.pos];
      this.pos++;
    }
    const upper = s.toUpperCase();
    const kind = keywordKind(upper);
    if (kind) {
      // It's a keyword
      this.tokens.push({ kind, value: null, pos: start });
    } else if (upper === "TRUE") {
      this.tokens.push({ kind: TokenKind.Bool, value: true, pos: start });
    } else if (upper === "FALSE") {
      this.tokens.push({ kind: TokenKind.Bool, value: false, pos: start });
    } else if (upper === "NULL") {
      this.tokens.push({ kind: TokenKind.Null, value: null, pos: start });
    } else {
      // It's a field identifier
      this.tokens.push({ kind: TokenKind.Ident, value: s, pos: start });
    }
  }
}

// ============================================================================
// Character Classification
// ============================================================================

/**
 * Check if character is whitespace.
 */
function isWhitespace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\r";
}

/**
 * Check if character is a digit (0-9).
 */
function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

/**
 * Check if character is alphabetic (a-z, A-Z).
 */
function isAlpha(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");
}

/**
 * Check if character is alphanumeric or underscore/dot.
 * Used for field name validation.
 */
function isAlphaNum(c: string): boolean {
  return isAlpha(c) || isDigit(c) || c === "_" || c === "." || c === "*";
}

// ============================================================================
// Keyword Lookup
// ============================================================================

/**
 * Map uppercase keyword to TokenKind.
 * Returns null if not a keyword.
 */
function keywordKind(s: string): TokenKind | null {
  const keywords: Record<string, TokenKind> = {
    SELECT: TokenKind.Select,
    WHERE: TokenKind.Where,
    AND: TokenKind.And,
    OR: TokenKind.Or,
    NOT: TokenKind.Not,
    FUZZY: TokenKind.Fuzzy,
    IN: TokenKind.In,
    LIKE: TokenKind.Like,
    REGEX: TokenKind.Regex,
    ORDER: TokenKind.Order,
    BY: TokenKind.By,
    LIMIT: TokenKind.Limit,
    OFFSET: TokenKind.Offset,
    ASC: TokenKind.Asc,
    DESC: TokenKind.Desc,
    NULLS: TokenKind.Nulls,
    FIRST: TokenKind.First,
    LAST: TokenKind.Last,
    SCORE: TokenKind.Score,
    CASE: TokenKind.Case,
    SENSITIVE: TokenKind.Sensitive,
    INSENSITIVE: TokenKind.Insensitive,
    STRICT: TokenKind.Strict,
    BETWEEN: TokenKind.Between,
    CONTAINS: TokenKind.Contains,
    STARTS: TokenKind.Starts,
    ENDS: TokenKind.Ends,
    EXISTS: TokenKind.Exists,
    IS: TokenKind.Is,
  };
  return keywords[s] || null;
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Check if a string is a valid field name.
 * Must be non-empty and contain only alphanumeric, underscore, or dot.
 */
export function isValidFieldName(field: string): boolean {
  if (field.length === 0) return false;
  for (const c of field) {
    if (!isAlphaNum(c) && c !== "_" && c !== ".") return false;
  }
  return true;
}

/**
 * Validate a regex pattern for safety.
 * Prevents ReDoS (Regular Expression Denial of Service) attacks.
 * 
 * @param pattern - The regex pattern string
 * @param pos - Position in query for error reporting
 * @throws QueryParseError if pattern is unsafe
 */
export function validateRegexPattern(pattern: string, pos: number): void {
  // Limit pattern length
  if (pattern.length > 256) {
    throw new QueryParseError(`REGEX pattern too long (max 256)`, pos);
  }
  //Reject potentially dangerous patterns
  const banned = [")+", ")*", "){", ")+?", ")*?"];
  for (const b of banned) {
    if (pattern.includes(b)) {
      throw new QueryParseError("REGEX pattern rejected (potential ReDoS)", pos);
    }
  }
  // Additional dangerous patterns
  if (pattern.includes("++") || pattern.includes("**") || pattern.includes("{,")) {
    throw new QueryParseError("REGEX pattern rejected (potential ReDoS)", pos);
  }
}