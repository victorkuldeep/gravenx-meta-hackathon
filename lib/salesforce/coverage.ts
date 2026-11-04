/**
 * Apex test coverage lens: per-class/per-trigger covered lines, bucketed for
 * leadership (<75 risk, 75-85 watch, >85 healthy), plus the org-wide rollup.
 *
 * Data comes from Tooling in three cheap queries: the trigger roster, the
 * class roster, and the coverage aggregate. Classes/triggers missing from the
 * aggregate ran no covered lines - they report 0%, never "unknown".
 */

export type CoverageBucket = "risk" | "watch" | "healthy" | "no-lines";

export interface CoverageRow {
  id: string;
  name: string;
  kind: "trigger" | "class";
  objectName: string;
  covered: number;
  uncovered: number;
  total: number;
  pct: number | null;
  bucket: CoverageBucket;
}

export interface CoverageReport {
  rows: CoverageRow[];
  orgCovered: number;
  orgUncovered: number;
  orgTotal: number;
  orgPct: number | null;
  counts: Record<CoverageBucket, number>;
}

export interface CoverageRunner {
  (soql: string): Promise<{ ok: boolean; records?: Record<string, unknown>[]; totalSize?: number; error?: string }>;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function bucketFor(pct: number | null): CoverageBucket {
  if (pct === null) return "no-lines";
  if (pct < 75) return "risk";
  if (pct <= 85) return "watch";
  return "healthy";
}

export const BUCKET_LABEL: Record<CoverageBucket, string> = {
  risk: "Below 75",
  watch: "75-85",
  healthy: "Above 85",
  "no-lines": "No executable lines",
};

async function tryQueries(run: CoverageRunner, variants: string[]): Promise<Record<string, unknown>[] | null> {
  for (const q of variants) {
    try {
      const res = await run(q);
      if (res.ok) return res.records ?? [];
    } catch {
      /* next variant */
    }
  }
  return null;
}

export async function fetchCoverage(run: CoverageRunner): Promise<CoverageReport> {
  const [triggers, classes, agg] = await Promise.all([
    tryQueries(run, [
      "SELECT Id, Name, SobjectType, Status FROM ApexTrigger ORDER BY Name",
      "SELECT Id, Name, Status FROM ApexTrigger ORDER BY Name",
      "SELECT Id, Name FROM ApexTrigger ORDER BY Name",
    ]),
    tryQueries(run, [
      "SELECT Id, Name, Status FROM ApexClass ORDER BY Name",
      "SELECT Id, Name FROM ApexClass ORDER BY Name",
    ]),
    tryQueries(run, [
      "SELECT ApexClassOrTriggerId, ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate",
      "SELECT ApexClassOrTriggerId, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate",
    ]),
  ]);

  const byId = new Map<string, { covered: number; uncovered: number }>();
  for (const r of agg ?? []) {
    const id = str(r["ApexClassOrTriggerId"]);
    if (!id) continue;
    const cur = byId.get(id) ?? { covered: 0, uncovered: 0 };
    cur.covered += num(r["NumLinesCovered"]);
    cur.uncovered += num(r["NumLinesUncovered"]);
    byId.set(id, cur);
  }

  const rows: CoverageRow[] = [];
  const push = (r: Record<string, unknown>, kind: "trigger" | "class") => {
    const id = str(r["Id"]);
    if (!id) return;
    const cov = byId.get(id) ?? { covered: 0, uncovered: 0 };
    const total = cov.covered + cov.uncovered;
    const pct = total > 0 ? (cov.covered / total) * 100 : null;
    rows.push({
      id,
      name: str(r["Name"]) || id,
      kind,
      objectName: kind === "trigger" ? str(r["SobjectType"]) : "",
      covered: cov.covered,
      uncovered: cov.uncovered,
      total,
      pct,
      bucket: bucketFor(pct),
    });
  };
  for (const r of triggers ?? []) push(r, "trigger");
  for (const r of classes ?? []) push(r, "class");
  rows.sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1) || a.name.localeCompare(b.name));

  const orgCovered = rows.reduce((n, r) => n + r.covered, 0);
  const orgUncovered = rows.reduce((n, r) => n + r.uncovered, 0);
  const orgTotal = orgCovered + orgUncovered;
  const counts: Record<CoverageBucket, number> = { risk: 0, watch: 0, healthy: 0, "no-lines": 0 };
  for (const r of rows) counts[r.bucket] += 1;
  return {
    rows,
    orgCovered,
    orgUncovered,
    orgTotal,
    orgPct: orgTotal > 0 ? (orgCovered / orgTotal) * 100 : null,
    counts,
  };
}
