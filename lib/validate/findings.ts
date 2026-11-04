/**
 * Validate workspace - findings normalization.
 *
 * Converts AJV errors into UI-independent ValidationFindings with
 * canonical JSON Pointers, friendly display paths (via the shared
 * lib/json/path convention) and safely truncated actual values.
 */

import type { ErrorObject } from "ajv";
import { resolvePath, stringifyPath, type JsonPath } from "../json/path";
import type { ValidationFinding, ValidationTarget } from "./types";

let findingSeq = 0;

/** JSON Pointer ("/a/0/b") -> path segments. */
export function pointerToSegments(pointer: string): JsonPath {
  if (!pointer || pointer === "/") return [];
  return pointer
    .split("/")
    .slice(1)
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((seg) => (/^(0|[1-9][0-9]*)$/.test(seg) ? Number(seg) : seg));
}

/** JSON Pointer -> friendly "$.a[0].b" display path. */
export function pointerToFriendly(pointer: string): string {
  return stringifyPath(pointerToSegments(pointer));
}

function truncateActual(value: unknown): unknown {
  if (value === undefined) return undefined;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined || text.length <= 160) return value;
  return `${text.slice(0, 157)}…`;
}

function expectedOf(err: ErrorObject): unknown {
  const p = err.params as Record<string, unknown>;
  switch (err.keyword) {
    case "enum":
      return (p.allowedValues as unknown[])?.slice(0, 12);
    case "type":
      return p.type;
    case "required":
      return { missingProperty: p.missingProperty };
    case "additionalProperties":
      return { additionalProperty: p.additionalProperty };
    case "minimum":
    case "maximum":
    case "exclusiveMinimum":
    case "exclusiveMaximum":
      return { limit: p.limit, comparison: p.comparison };
    case "minLength":
    case "maxLength":
    case "minItems":
    case "maxItems":
    case "minProperties":
    case "maxProperties":
      return { limit: p.limit };
    case "pattern":
      return { pattern: p.pattern };
    case "format":
      return { format: p.format };
    case "const":
      return p.allowedValue;
    default:
      return undefined;
  }
}

function ruleOf(keyword: string): string {
  const rules: Record<string, string> = {
    required: "required property",
    type: "type",
    enum: "enum",
    additionalProperties: "additionalProperties",
    minimum: "minimum",
    maximum: "maximum",
    exclusiveMinimum: "exclusiveMinimum",
    exclusiveMaximum: "exclusiveMaximum",
    minLength: "minLength",
    maxLength: "maxLength",
    pattern: "pattern",
    format: "format",
    minItems: "minItems",
    maxItems: "maxItems",
    items: "items",
    properties: "properties",
    oneOf: "oneOf (exactly one)",
    anyOf: "anyOf (at least one)",
    allOf: "allOf (every branch)",
    if: "conditional",
    const: "const",
  };
  return rules[keyword] ?? keyword;
}

export function normalizeErrors(
  errors: ErrorObject[],
  payload: unknown,
  target: ValidationTarget
): ValidationFinding[] {
  return errors.map((err) => {
    // `required` / `additionalProperties` point AT the parent - extend the
    // pointer so the finding lands on the exact property.
    let pointer = err.instancePath || "/";
    const p = err.params as Record<string, unknown>;
    if (err.keyword === "required" && typeof p.missingProperty === "string") {
      pointer = `${pointer === "/" ? "" : pointer}/${p.missingProperty.replace(/~/g, "~0").replace(/\//g, "~1")}`;
    }
    if (err.keyword === "additionalProperties" && typeof p.additionalProperty === "string") {
      pointer = `${pointer === "/" ? "" : pointer}/${(p.additionalProperty as string).replace(/~/g, "~0").replace(/\//g, "~1")}`;
    }
    const segments = pointerToSegments(pointer);
    const resolved = resolvePath(payload, segments);
    return {
      id: `finding-${++findingSeq}`,
      severity: "error" as const,
      source: "schema" as const,
      path: pointer,
      keyword: err.keyword,
      rule: ruleOf(err.keyword),
      message: err.message ?? `Schema violation (${err.keyword}).`,
      expected: expectedOf(err),
      actual: truncateActual(resolved.found ? resolved.value : undefined),
      schemaPath: err.schemaPath,
      operationId: target.operationId,
      direction: target.direction,
      statusCode: target.statusCode,
      mediaType: target.mediaType,
    };
  });
}
