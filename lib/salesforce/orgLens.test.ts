import { describe, expect, it } from "vitest";
import { fetchDensity, fetchLensCounts } from "./orgLens";
import type { CoverageRunner } from "./coverage";

function stub(table: Record<string, { records?: Record<string, unknown>[]; totalSize?: number }>): CoverageRunner {
  return async (soql) => {
    for (const [needle, res] of Object.entries(table)) {
      if (soql.includes(needle)) return { ok: true, ...res };
    }
    return { ok: false, error: `no mock for ${soql}` };
  };
}

describe("org lens", () => {
  it("reads counts from totalSize without pulling records", async () => {
    const run = stub({
      "FROM ApexTrigger WHERE Status = 'Active'": { totalSize: 4 },
      "FROM ApexTrigger WHERE Status != 'Active'": { totalSize: 1 },
      "FROM Flow WHERE Status = 'Active'": { totalSize: 9 },
      "ValidationRule WHERE Active = true": { totalSize: 12 },
      "ValidationRule WHERE Active = false": { totalSize: 2 },
      "Type = 'Approval'": { totalSize: 3 },
      "FROM DuplicateRule": { totalSize: 1 },
      "FROM QueueSobject": { totalSize: 5 },
    });
    const c = await fetchLensCounts(run);
    expect(c).toMatchObject({ triggersActive: 4, triggersInactive: 1, flowActiveVersions: 9, approvals: 3, queues: 5 });
  });

  it("merges grouped counts into a ranked density table", async () => {
    const run = stub({
      "GROUP BY SobjectType": { records: [{ SobjectType: "Order", n: 3 }] },
      "GROUP BY TriggerObjectOrEvent": { records: [{ TriggerObjectOrEvent: "Order", n: 5 }] },
      "GROUP BY EntityDefinitionId": { records: [{ EntityDefinitionId: "801", n: 2 }] },
      "FROM EntityDefinition": { records: [{ QualifiedApiName: "Order", DurableId: "801" }] },
    });
    const rows = await fetchDensity(run);
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({ objectName: "Order", triggers: 3, flows: 5, validation: 2, total: 10 });
  });

  it("returns null density when every aggregate fails", async () => {
    const rows = await fetchDensity(async () => ({ ok: false, error: "denied" }));
    expect(rows).toBeNull();
  });
});
