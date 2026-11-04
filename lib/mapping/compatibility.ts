/**
 * Mapping Studio - type compatibility + constraint checks.
 *
 * Transparent diagnostics, never a vague score. Sample-value checks are
 * always labeled sample-based: a passing example proves nothing about
 * future values unless the source contract declares a maximum.
 */

import type { JsonType } from "./types";

export type Compatibility = "compatible" | "needs-decision" | "incompatible";

export interface CompatResult {
  level: Compatibility;
  reason: string;
}

/** Salesforce field types grouped by accepted JSON shapes. */
const STRING_LIKE = new Set(["string", "textarea", "phone", "email", "url", "picklist", "multipicklist", "reference", "id"]);
const INT_LIKE = new Set(["int", "long"]);
const DECIMAL_LIKE = new Set(["double", "currency", "percent"]);
const BOOL_LIKE = new Set(["boolean"]);
const DATE_LIKE = new Set(["date", "datetime", "time"]);

export function checkType(jsonType: JsonType, sfType: string): CompatResult {
  const t = sfType.toLowerCase();
  if (t === "anytype" || t === "json") return { level: "compatible", reason: "Target accepts any JSON value." };

  switch (jsonType) {
    case "string":
      if (STRING_LIKE.has(t) || DATE_LIKE.has(t))
        return { level: t === "reference" || t === "id" ? "needs-decision" : "compatible", reason: t === "reference" || t === "id" ? "String fits, but confirm the value is a valid Salesforce record/external ID." : "String to text-like field." };
      if (INT_LIKE.has(t) || DECIMAL_LIKE.has(t) || BOOL_LIKE.has(t))
        return { level: "needs-decision", reason: `Source is a string; target ${sfType} needs an explicit conversion decision.` };
      return { level: "incompatible", reason: `String cannot populate ${sfType} without a supported transformation.` };
    case "integer":
      if (INT_LIKE.has(t)) return { level: "compatible", reason: "Integer to integer-like field." };
      if (DECIMAL_LIKE.has(t)) return { level: "compatible", reason: "Integer fits decimal-like field (precision/scale still apply)." };
      if (STRING_LIKE.has(t)) return { level: "needs-decision", reason: "Number to text needs an explicit formatting decision." };
      if (BOOL_LIKE.has(t)) return { level: "incompatible", reason: "Number cannot populate a checkbox without a supported transformation." };
      return { level: "incompatible", reason: `Number cannot populate ${sfType} without a supported transformation.` };
    case "number":
      if (DECIMAL_LIKE.has(t)) return { level: "compatible", reason: "Decimal to decimal-like field (precision/scale still apply)." };
      if (INT_LIKE.has(t)) return { level: "needs-decision", reason: "Decimal to integer needs an explicit rounding decision." };
      if (STRING_LIKE.has(t)) return { level: "needs-decision", reason: "Number to text needs an explicit formatting decision." };
      return { level: "incompatible", reason: `Number cannot populate ${sfType} without a supported transformation.` };
    case "boolean":
      if (BOOL_LIKE.has(t)) return { level: "compatible", reason: "Boolean to checkbox." };
      if (STRING_LIKE.has(t)) return { level: "needs-decision", reason: "Boolean to text needs an explicit formatting decision." };
      return { level: "incompatible", reason: `Boolean cannot populate ${sfType} without a supported transformation.` };
    case "null":
      return { level: "needs-decision", reason: "Null sample: confirm target nillability and operation semantics." };
    case "object":
      return { level: "incompatible", reason: "Object cannot populate a scalar field - map its leaf paths or model a record plan." };
    case "array":
      return { level: "incompatible", reason: "Array cannot populate a scalar field - model repeated record creation via a record plan." };
  }
}

export interface LengthCheck {
  flag: boolean;
  message: string;
}

/** Sample-based string length check. Never claims contract guarantees. */
export function checkLength(example: unknown, maxLength: number): LengthCheck {
  if (typeof example !== "string" || !(maxLength > 0)) return { flag: false, message: "" };
  if (example.length > maxLength) {
    return { flag: true, message: `Sample value (${example.length} chars) exceeds target length ${maxLength}.` };
  }
  return { flag: false, message: `Sample value fits length ${maxLength} (sample-based - future values may differ).` };
}

export interface NumericCheck {
  flag: boolean;
  message: string;
}

/** Sample-based precision/scale check for numeric examples. */
export function checkNumeric(example: unknown, precision: number, scale: number): NumericCheck {
  if (typeof example !== "number" || !(precision > 0)) return { flag: false, message: "" };
  const digits = String(Math.abs(Math.trunc(example))).replace("-", "").length;
  if (digits > precision - scale) {
    return { flag: true, message: `Sample value ${example} exceeds precision ${precision} / scale ${scale}.` };
  }
  return { flag: false, message: "" };
}
