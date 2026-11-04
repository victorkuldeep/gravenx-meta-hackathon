"use client";

/**
 * Schema review: deterministic fingerprints over relevant schema facts only,
 * plus human-readable diffs. Never the whole org - one entity or field at a
 * time. A mismatch prompts review, never automatic mutation or remapping.
 */

export interface FieldFacts {
  name: string;
  type: string;
  required: boolean;
  referenceTo: string[];
  label: string;
}

export interface EntityFacts {
  apiName: string;
  fieldCount: number;
  /** Sorted field names - detects add/remove without hashing everything. */
  fieldNames: string[];
  /** Sorted child relationship names. */
  childNames: string[];
}

function djb2(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

function canonical(value: unknown): string {
  return JSON.stringify(value);
}

export function fingerprintField(f: FieldFacts): string {
  return `f:${djb2(canonical({ t: f.type, r: f.required, to: [...f.referenceTo].sort() }))}`;
}

export function fingerprintEntity(e: EntityFacts): string {
  return `e:${djb2(canonical({ n: e.fieldNames.length, f: [...e.fieldNames].sort(), c: [...e.childNames].sort() }))}`;
}

/** Stored baseline vs live facts for a field anchor. Empty = identical. */
export function diffFieldFacts(
  stored: { type: string; required: boolean; referenceTo: string[]; label: string },
  live: FieldFacts
): string[] {
  const diffs: string[] = [];
  if (stored.type !== live.type) diffs.push(`type ${stored.type} → ${live.type}`);
  if (stored.required !== live.required)
    diffs.push(live.required ? "became required" : "became optional");
  const s = [...stored.referenceTo].sort().join(",");
  const l = [...live.referenceTo].sort().join(",");
  if (s !== l) diffs.push(`lookup target ${s || "none"} → ${l || "none"}`);
  if (stored.label !== live.label) diffs.push(`label “${stored.label}” → “${live.label}”`);
  return diffs;
}

/** Stored baseline vs live facts for an entity anchor. Empty = identical. */
export function diffEntityFacts(
  stored: { fieldNames: string[]; childNames: string[] },
  live: EntityFacts
): string[] {
  const diffs: string[] = [];
  const sFields = new Set(stored.fieldNames);
  const lFields = new Set(live.fieldNames);
  const added = [...lFields].filter((f) => !sFields.has(f));
  const removed = [...sFields].filter((f) => !lFields.has(f));
  if (added.length > 0) diffs.push(`+${added.length} field${added.length === 1 ? "" : "s"} (${added.slice(0, 3).join(", ")}${added.length > 3 ? "…" : ""})`);
  if (removed.length > 0) diffs.push(`−${removed.length} field${removed.length === 1 ? "" : "s"} (${removed.slice(0, 3).join(", ")}${removed.length > 3 ? "…" : ""})`);
  const sChild = [...stored.childNames].sort().join(",");
  const lChild = [...live.childNames].sort().join(",");
  if (sChild !== lChild) diffs.push("child relationships changed");
  return diffs;
}
