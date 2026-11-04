import type { SalesforceObject } from "./types";

export type ObjectKind = "Standard" | "Custom" | "Custom Setting" | "Custom Metadata" | "Big Object";

/**
 * Classify an sObject into its family. Suffixes are contractual (`__mdt`,
 * `__b`); settings ride the describe `customSetting` flag, which vintage
 * caches may lack - fall back to plain Custom there.
 */
export function classifyObject(obj: Pick<SalesforceObject, "name" | "custom"> & { customSetting?: boolean }): ObjectKind {
  if (obj.name.endsWith("__mdt")) return "Custom Metadata";
  if (obj.name.endsWith("__b")) return "Big Object";
  if (obj.customSetting) return "Custom Setting";
  return obj.custom ? "Custom" : "Standard";
}

/** Kinds the Explorer can filter on; Big Object activates when one appears. */
export const OBJECT_KINDS: ObjectKind[] = ["Standard", "Custom", "Custom Setting", "Custom Metadata", "Big Object"];

/** EntityDefinition scan for big objects, which global describe omits.
 *  Suffix filtering happens client-side: `_` is a SOQL LIKE wildcard, so a
 *  server-side `%__b` also matches `*ob` names (verified live). */
export function bigObjectScanQuery(): string {
  return "SELECT QualifiedApiName, Label FROM EntityDefinition LIMIT 2000";
}

export interface BigObjectCandidate {
  QualifiedApiName?: string;
  Label?: string | null;
}

/** Merge true `__b` entities missing from global describe into the list. */
export function mergeBigObjects(
  objects: SalesforceObject[],
  candidates: BigObjectCandidate[]
): SalesforceObject[] {
  const known = new Set(objects.map((o) => o.name));
  const extra: SalesforceObject[] = [];
  for (const c of candidates ?? []) {
    const name = (c.QualifiedApiName ?? "").trim();
    if (!name.endsWith("__b") || !name || known.has(name)) continue;
    known.add(name);
    extra.push({
      name,
      label: c.Label?.trim() || name,
      labelPlural: c.Label?.trim() || name,
      custom: false,
      createable: false,
      updateable: false,
      queryable: true,
      deletable: false,
      urls: {},
    });
  }
  return [...objects, ...extra];
}
