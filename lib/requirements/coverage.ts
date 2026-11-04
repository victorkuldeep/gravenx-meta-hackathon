import type { GraphIndex } from "@/lib/graph/index";
import type { Requirement } from "./model";

/**
 * Coverage is derived, never declared: a requirement is covered when at
 * least one of its links resolves to a live record (id or name). Links
 * dangling into renames/deletes do not count - the coverage view says so.
 */

export interface RequirementCoverage {
  id: string;
  number: string;
  covered: boolean;
  liveLinks: number;
  danglingLinks: number;
}

export function coverageOf(index: GraphIndex, r: Requirement): RequirementCoverage {
  let liveLinks = 0;
  let danglingLinks = 0;
  for (const l of r.links) {
    const to = index.edges.find(
      (e) => e.kind === "links" && e.label === l.label && e.from === `requirement:${r.id}`,
    );
    if (!to) {
      danglingLinks++;
      continue;
    }
    if (to.resolution === "unresolved") danglingLinks++;
    else liveLinks++;
  }
  return { id: r.id, number: r.number, covered: liveLinks > 0, liveLinks, danglingLinks };
}

export function coverageSummary(index: GraphIndex, reqs: Requirement[]): { covered: number; total: number; uncovered: RequirementCoverage[] } {
  const rows = reqs.map((r) => coverageOf(index, r));
  return {
    covered: rows.filter((x) => x.covered).length,
    total: rows.length,
    uncovered: rows.filter((x) => !x.covered),
  };
}
