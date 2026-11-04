/**
 * Pure field statistics over pulled Query rows. Engine-free on purpose:
 * components import this statically (bytes, no lazy chunk) while the heavy
 * JsonQL engine behind queryFilter.ts stays lazy-loaded.
 */

type Rec = Record<string, unknown>;

/** Top-level field names for pickers, minus Salesforce `attributes` envelopes. */
export function recordFields(records: unknown[]): string[] {
  const seen = new Set<string>();
  for (const r of records) {
    if (r !== null && typeof r === "object" && !Array.isArray(r)) {
      for (const k of Object.keys(r as Rec)) {
        if (k !== "attributes" && !seen.has(k)) seen.add(k);
      }
    }
  }
  return [...seen].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/** A clickable quick-filter suggestion mined from actual row values. */
export interface ValueChip {
  field: string;
  value: string;
  count: number;
}

/**
 * Data-driven quick filters: low-cardinality string fields (2..8 distinct
 * values) with their top values by frequency. Nothing is hardcoded - every
 * chip comes from the pulled rows, so the strip always matches the query.
 */
export function valueChips(records: unknown[], maxFields = 6, maxValues = 6): ValueChip[] {
  const per = new Map<string, Map<string, number>>();
  for (const r of records) {
    if (r === null || typeof r !== "object" || Array.isArray(r)) continue;
    for (const [k, v] of Object.entries(r as Rec)) {
      if (k === "attributes") continue;
      if (typeof v !== "string" || v === "") continue;
      let m = per.get(k);
      if (!m) {
        m = new Map<string, number>();
        per.set(k, m);
      }
      m.set(v, (m.get(v) ?? 0) + 1);
    }
  }
  return [...per.entries()]
    .filter(([, m]) => m.size >= 2 && m.size <= 8)
    .sort((a, b) => a[1].size - b[1].size)
    .slice(0, Math.max(0, maxFields))
    .flatMap(([field, m]) =>
      [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, Math.max(0, maxValues))
        .map(([value, count]) => ({ field, value, count }))
    );
}

/**
 * Fields whose sampled values are all numeric - the only valid
 * SUM/AVG/MIN/MAX targets. Names and Ids never qualify, so the quick-stats
 * strip can disable those ops instead of failing after the click.
 */
export function numericFields(records: unknown[]): string[] {
  return recordFields(records).filter((f) => {
    let seen = 0;
    for (const r of records) {
      if (r === null || typeof r !== "object" || Array.isArray(r)) continue;
      const v = (r as Rec)[f];
      if (v === null || v === undefined || v === "") continue;
      if (typeof v !== "number") return false;
      if (++seen >= 5) break;
    }
    return seen > 0;
  });
}
