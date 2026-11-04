/**
 * Validate workspace - AJV engine.
 *
 * Deterministic payload validation. No coercion, no defaults, no
 * additional-property removal, no payload mutation. Compiled validators
 * are cached by schema identity + dialect; compiled functions never
 * enter serializable state.
 */

import { Ajv2020 } from "ajv/dist/2020";
import type { ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { normalizeErrors } from "./findings";
import type { ValidationReport, ValidationTarget } from "./types";

/**
 * Strictness rationale: `strict: false` because OpenAPI 3.1 passthrough
 * schemas may carry annotation keywords AJV does not know. Unknown
 * keywords are stripped or flagged by the adapter with diagnostics, so
 * nothing is silently skipped - check the contract diagnostics panel.
 * Schema structure itself is still validated (`validateSchema: true`).
 */
function createAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateSchema: true });
  addFormats(ajv);
  return ajv;
}

const ajv = createAjv();
const cache = new Map<string, ValidateFunction>();

function cacheKey(target: ValidationTarget): string {
  return `${target.schemaId}|${target.dialect}`;
}

export interface EngineResult {
  report?: ValidationReport;
  /** Schema could not be compiled - a contract problem, not a payload failure. */
  compileError?: string;
}

export function validatePayload(target: ValidationTarget, payload: unknown): EngineResult {
  const key = cacheKey(target);
  let fn = cache.get(key);
  if (!fn) {
    try {
      fn = ajv.compile(target.schema as never);
      cache.set(key, fn);
    } catch (err) {
      return { compileError: err instanceof Error ? err.message : String(err) };
    }
  }
  const t0 = performance.now();
  const valid = fn(payload);
  const durationMs = performance.now() - t0;
  const errors = valid ? [] : [...(fn.errors ?? [])];
  const findings = normalizeErrors(errors, payload, target);
  const errorCount = findings.filter((f) => f.severity === "error").length;
  return {
    report: {
      outcome: errorCount > 0 ? "invalid" : "valid",
      findings,
      errors: errorCount,
      warnings: findings.filter((f) => f.severity === "warning").length,
      infos: findings.filter((f) => f.severity === "info").length,
      durationMs,
      target,
      stale: false,
    },
  };
}

/** Test hook: clear the compiled-validator cache. */
export function clearEngineCache(): void {
  cache.clear();
}
