/**
 * Mapping Studio - named constants (hardcoded values) shared by Guide
 * and Grid. A constant is a free row (no source node) carrying a label
 * in notes and the literal in hardcodedValue. Guide leaves map onto a
 * constant by copying its value; the constant itself stays put.
 */

import { FREE_SOURCE_PATH, type MappingRow } from "./types";

export interface ConstantInput {
  label: string;
  value: string;
}

/** Free rows only - the maintained constants list. */
export function freeConstants(mappings: MappingRow[]): MappingRow[] {
  return mappings.filter((m) => m.sourcePath === FREE_SOURCE_PATH);
}

function cleanLabel(label: string, value: string): string | undefined {
  const clean = label.trim().slice(0, 80);
  return clean || value.trim().slice(0, 80) || undefined;
}

/** Create a new constant or update one by id. Pure - caller persists. */
export function upsertConstant(
  mappings: MappingRow[],
  input: ConstantInput,
  opts: { id?: string | null; planId: string | null; uid: () => string; now: string }
): MappingRow[] {
  const value = input.value;
  const notes = cleanLabel(input.label, value);
  if (opts.id) {
    return mappings.map((m) =>
      m.id === opts.id ? { ...m, notes, hardcodedValue: value, kind: "hardcoded" as const, updatedAt: opts.now } : m
    );
  }
  const row: MappingRow = {
    id: opts.uid(),
    sourcePath: FREE_SOURCE_PATH,
    planId: opts.planId,
    objectName: "",
    fieldName: "",
    kind: "hardcoded",
    status: "hardcoded",
    hardcodedValue: value,
    notes,
    updatedAt: opts.now,
  };
  return [...mappings, row];
}

/**
 * Map a source leaf onto an existing constant: the leaf row copies the
 * constant's value and label, so editing the constant later does not
 * rewrite history on already-mapped rows.
 */
export function mapLeafToConstant(
  mappings: MappingRow[],
  sourcePath: string,
  constantId: string,
  opts: { planId: string | null; uid: () => string; now: string }
): MappingRow[] {
  const constant = mappings.find((m) => m.id === constantId && m.sourcePath === FREE_SOURCE_PATH);
  if (!constant) return mappings;
  const patch = {
    kind: "hardcoded" as const,
    status: "hardcoded" as const,
    hardcodedValue: constant.hardcodedValue,
    notes: constant.notes,
    objectName: "",
    fieldName: "",
    updatedAt: opts.now,
  };
  const existing = mappings.find((m) => m.sourcePath === sourcePath);
  if (existing) {
    return mappings.map((m) => (m.id === existing.id ? { ...m, ...patch } : m));
  }
  return [
    ...mappings,
    { id: opts.uid(), sourcePath, planId: opts.planId, ...patch },
  ];
}
