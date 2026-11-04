/**
 * JSON Search Engine - Utility Functions
 * 
 * Common utility functions used throughout the engine.
 * Includes path navigation, cloning, type checking, and normalization.
 * 
 * @module utils
 */

import { JsonValue } from "./types";

/**
 * Get a value from a nested object using dotted path.
 * 
 * Supports:
 * - Object properties: "name" → obj.name
 * - Nested properties: "meta.region" → obj.meta.region
 * - Array indices: "items[0]" → obj.items[0]
 * - Mixed: "items[0].name" → obj.items[0].name
 * 
 * @param value - Object to navigate
 * @param path - Dotted path (e.g., "meta.region")
 * @returns The value at path, or undefined if not found
 * 
 * @example
 * ```typescript
 * const obj = { meta: { region: "APAC" } };
 * getPath(obj, "meta.region"); // "APAC"
 * ```
 */
export function getPath(value: JsonValue, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const part of path.split(".")) {
    if (current === undefined || current === null) return undefined;

    const idx = parseInt(part, 10);
    if (!isNaN(idx)) {
      // Array index
      if (Array.isArray(current)) {
        current = current[idx];
      } else {
        return undefined;
      }
    } else if (typeof current === "object" && current !== null) {
      // Object property
      current = (current as Record<string, JsonValue>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Set a value in a nested object, creating intermediate objects as needed.
 * 
 * @param obj - Root object to modify
 * @param path - Dotted path
 * @param value - Value to set
 */
export function setPath(obj: Record<string, JsonValue>, path: string, value: JsonValue): void {
  const parts = path.split(".");
  let current: Record<string, JsonValue> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part] as Record<string, JsonValue>;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Deep clone a JSON value using JSON round-trip.
 * 
 * @param value - Value to clone
 * @returns Deep copy of the value
 */
export function cloneJson(value: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Type guard: check if value is a plain object (not array, not null).
 */
export function isObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Type guard: check if value is an array.
 */
export function isArray(value: JsonValue): value is JsonValue[] {
  return Array.isArray(value);
}

/**
 * Normalize a value for comparison/indexing.
 * Returns a string representation that preserves type information.
 */
export function normalizeValue(value: JsonValue, caseSensitive: boolean): string {
  if (typeof value === "string") {
    return caseSensitive ? value : value.toLowerCase();
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
  return "";
}

/**
 * Normalize a string for comparison.
 */
export function normalizeString(s: string, caseSensitive: boolean): string {
  return caseSensitive ? s : s.toLowerCase();
}

/**
 * Create a normalized string key for indexing.
 */
export function stringifyKey(value: JsonValue, caseSensitive: boolean): string {
  return normalizeValue(value, caseSensitive);
}