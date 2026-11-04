import { stringify as yamlStringify, parse as yamlParse } from "yaml";

/**
 * Deterministic serialization. Key order = insertion order, which the
 * compiler fully controls (sorted operations, profile-ordered fields).
 */

export function toJsonString(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function toYamlString(document: unknown): string {
  return yamlStringify(document, { lineWidth: 0 });
}

export function parseYaml(text: string): unknown {
  return yamlParse(text);
}

/** FNV-1a 32-bit content hash (change detection, not cryptographic). */
export function contentHash(canonical: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** Stable stringify with sorted object keys (for hashing). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}
