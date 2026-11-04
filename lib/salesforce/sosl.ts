/**
 * SOSL helpers - the Query tab speaks SOQL by default; these power the SOSL
 * side of the toggle. Pure functions (tested); the thin proxy route lives at
 * app/api/salesforce/sosl.
 */

export const SOSL_STARTER =
  "FIND {Acme} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, FirstName, LastName, Email) LIMIT 20";

export const SOSL_TEMPLATES: { name: string; sosl: string }[] = [
  {
    name: "Everything mentioning Acme",
    sosl: "FIND {Acme} IN ALL FIELDS RETURNING Account(Id, Name), Contact(Id, FirstName, LastName, Email) LIMIT 20",
  },
  {
    name: "Name fields only",
    sosl: "FIND {Acme} IN NAME FIELDS RETURNING Account(Id, Name), Lead(Id, FirstName, LastName, Company) LIMIT 20",
  },
  {
    name: "Phone fields",
    sosl: "FIND {415-555-*} IN PHONE FIELDS RETURNING Account(Id, Name, Phone), Contact(Id, Name, Phone) LIMIT 20",
  },
];

/** A statement is SOSL when it opens with FIND (braces hold the term). */
export function looksLikeSosl(statement: string): boolean {
  return /^\s*FIND\s*\{/i.test(statement);
}

export function buildSearchUrl(instanceUrl: string, apiVersion: string, sosl: string): string {
  const origin = instanceUrl.replace(/\/+$/, "");
  const ver = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
  return `${origin}/services/data/${ver}/search?q=${encodeURIComponent(sosl)}`;
}

export interface SearchRecord {
  attributes: { type: string; url: string };
  [field: string]: unknown;
}

export function isSearchRecord(value: unknown): value is SearchRecord {
  if (typeof value !== "object" || value === null) return false;
  const attrs = (value as Record<string, unknown>).attributes;
  return (
    typeof attrs === "object" &&
    attrs !== null &&
    typeof (attrs as Record<string, unknown>).type === "string"
  );
}

/**
 * Search returns mixed object types in one flat array. Flatten to a single
 * table with a leading Object column so the existing result grid, CSV and
 * JSON export keep working unchanged.
 */
export function toObjectTable(records: unknown[]): { columns: string[]; rows: string[][] } {
  const columns: string[] = ["Object"];
  const seen = new Set<string>(["Object"]);
  const rows: string[][] = [];
  for (const rec of records) {
    if (!isSearchRecord(rec)) continue;
    const flat: Record<string, string> = { Object: rec.attributes.type };
    for (const [k, v] of Object.entries(rec)) {
      if (k === "attributes") continue;
      const s = v === null || v === undefined ? "" : String(v);
      flat[k] = s;
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
    }
    rows.push(columns.map((c) => flat[c] ?? ""));
  }
  return { columns, rows };
}

/** Per-object counts for the result header ("Account 12 · Contact 5"). */
export function countByObject(records: unknown[]): { type: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const rec of records) {
    if (!isSearchRecord(rec)) continue;
    counts.set(rec.attributes.type, (counts.get(rec.attributes.type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}
