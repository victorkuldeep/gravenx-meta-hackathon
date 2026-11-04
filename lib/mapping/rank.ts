/**
 * Mapping Studio - relevance-ranked search over Salesforce names.
 *
 * A plain `contains` filter sorts alphabetically, so "AssessmentTaskOrder"
 * outranks an exact "Order" hit. Scores rank intent instead: exact name,
 * then prefix, then whole-token, then substring - across API name first
 * and label second. Deterministic, dependency-free, no stemming.
 */

export interface Rankable {
  name: string;
  label?: string | null;
}

/** Split camelCase / snake / digits into lowercase tokens: orderNumber -> [order, number]. */
function tokensOf(value: string): string[] {
  const spaced = value.replace(/__/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/**
 * Relevance of one item for a query. 0 = no match (neither name nor
 * label contains the query). Higher wins; ties break by shorter name,
 * then alphabetically, in rankByQuery.
 */
export function rankScore(query: string, name: string, label?: string | null): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const n = name.toLowerCase();
  const l = (label ?? "").toLowerCase();
  if (n === q) return 100;
  if (l === q && l.length > 0) return 90;
  if (n.startsWith(q)) return 80;
  if (l.startsWith(q) && l.length > 0) return 70;
  if (tokensOf(name).some((t) => t.startsWith(q))) return 60;
  if (l.length > 0 && tokensOf(label ?? "").some((t) => t.startsWith(q))) return 55;
  if (n.includes(q)) return 40;
  if (l.includes(q)) return 30;
  return 0;
}

/**
 * Filter to matches and sort by relevance (score desc, shorter name,
 * then alphabetical). Empty query returns the input order, capped.
 */
export function rankByQuery<T extends Rankable>(items: T[], query: string, limit = 200): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);
  return items
    .map((item) => ({ item, score: rankScore(q, item.name, item.label) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map((s) => s.item);
}
