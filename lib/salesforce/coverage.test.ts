import { describe, expect, it } from "vitest";
import { bucketFor, fetchCoverage, type CoverageRunner } from "./coverage";

describe("coverage lens", () => {
  it("buckets at 75 and 85 boundaries", () => {
    expect(bucketFor(null)).toBe("no-lines");
    expect(bucketFor(74.9)).toBe("risk");
    expect(bucketFor(75)).toBe("watch");
    expect(bucketFor(85)).toBe("watch");
    expect(bucketFor(85.1)).toBe("healthy");
  });

  it("merges rosters with the aggregate and zeroes the untested", async () => {
    const run: CoverageRunner = async (soql) => {
      if (soql.includes("FROM ApexTrigger")) return { ok: true, records: [{ Id: "t1", Name: "OrderTrigger", SobjectType: "Order" }] };
      if (soql.includes("FROM ApexClass")) {
        return { ok: true, records: [{ Id: "c1", Name: "Pricing" }, { Id: "c2", Name: "Legacy" }] };
      }
      if (soql.includes("FROM ApexCodeCoverageAggregate")) {
        return {
          ok: true,
          records: [
            { ApexClassOrTriggerId: "t1", NumLinesCovered: 80, NumLinesUncovered: 20 },
            { ApexClassOrTriggerId: "c1", NumLinesCovered: 17, NumLinesUncovered: 3 },
          ],
        };
      }
      return { ok: false, error: "no mock" };
    };
    const rep = await fetchCoverage(run);
    expect(rep.rows).toHaveLength(3);
    const byId = Object.fromEntries(rep.rows.map((r) => [r.id, r]));
    expect(byId["t1"].pct).toBe(80);
    expect(byId["t1"].bucket).toBe("watch");
    expect(byId["c1"].bucket).toBe("watch");
    expect(byId["c2"].pct).toBe(null);
    // Aggregate absent for c2 - reports 0 covered, never unknown.
    expect(byId["c2"].covered).toBe(0);
    expect(rep.orgPct).toBeCloseTo(97 / 120 * 100);
    expect(rep.counts["watch"]).toBe(2);
  });

  it("falls back when the SobjectType select is unavailable", async () => {
    const run: CoverageRunner = async (soql) => {
      if (soql.includes("SobjectType")) return { ok: false, error: "invalid field" };
      if (soql.includes("FROM ApexTrigger")) return { ok: true, records: [{ Id: "t1", Name: "T", Status: "Active" }] };
      if (soql.includes("FROM ApexClass")) return { ok: true, records: [] };
      return { ok: true, records: [] };
    };
    const rep = await fetchCoverage(run);
    expect(rep.rows).toHaveLength(1);
    expect(rep.rows[0].objectName).toBe("");
  });
});
