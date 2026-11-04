import { describe, expect, it } from "vitest";
import { fetchFieldUsage, fetchFootprint, fetchKeyPrefix, flowLane, footprintMarkdown, footprintSectionKeys, type FootprintRunner } from "./footprint";

function runnerFor(handlers: Record<string, object[]> | Error): FootprintRunner {
  return async (soql: string) => {
    if (handlers instanceof Error) return { ok: false, error: handlers.message };
    for (const [needle, rows] of Object.entries(handlers)) {
      if (needle.startsWith("!")) {
        if (soql.includes(needle.slice(1))) return { ok: false, error: "invalid field" };
        continue;
      }
      if (soql.includes(needle)) return { ok: true, records: rows as Record<string, unknown>[] };
    }
    return { ok: false, error: `no mock for: ${soql}` };
  };
}

describe("automation footprint", () => {
  it("queries every section for the object", async () => {
    const seen: string[] = [];
    const fp = await fetchFootprint("Account", "001", async (soql) => {
      seen.push(soql);
      return { ok: true, records: [] };
    });
    expect(footprintSectionKeys()).toEqual(["triggers", "flows", "queues", "validation", "approvals", "duplicates", "assignment"]);
    expect(fp.sections).toHaveLength(7);
    expect(fp.sections.every((s) => s.status === "ok")).toBe(true);
    expect(seen.some((q) => q.includes("SobjectType = 'Account'"))).toBe(true);
    expect(seen.some((q) => q.includes("EntityDefinitionId = '001'"))).toBe(true);
    expect(fp.total).toBe(0);
  });

  it("falls back to minimal selects and picks names across shapes", async () => {
    const fp = await fetchFootprint(
      "Invoice__c",
      "a00",
      runnerFor({
        "FROM ApexTrigger": [{ Id: "t1", Name: "InvoiceTrigger", Status: "Active" }],
        "!Queue.DeveloperName": [],
        "SELECT QueueId FROM": [{ QueueId: "q1", Queue: { Name: "Billing Queue" } }],
        "FROM Flow": [{ Id: "f1", MasterLabel: "New Invoice Flow", Status: "Active", TriggerType: "RecordAfterSave" }],
        "FROM ValidationRule": [{ Id: "v1", ValidationName: "Amount_Positive", Active: true, ErrorMessage: "Must be positive" }],
        "FROM ProcessDefinition": [{ Id: "a1", Name: "Invoice Approval", Active: true }],
        "IsActive FROM": [{ Id: "d1", MasterLabel: "Invoice Match", IsActive: false }],
        "FROM AssignmentRule": [{ Id: "s1", Name: "Invoice Assign", Active: true }],
      })
    );
    const byKey = Object.fromEntries(fp.sections.map((s) => [s.key, s]));
    expect(byKey.triggers.rows[0]).toMatchObject({ name: "InvoiceTrigger", active: true });
    expect(byKey.flows.rows[0]).toMatchObject({ name: "New Invoice Flow", detail: "RecordAfterSave" });
    expect(byKey.queues.rows[0]).toMatchObject({ name: "Billing Queue" });
    expect(byKey.validation.rows[0].name).toBe("Amount_Positive");
    expect(byKey.duplicates.rows[0]).toMatchObject({ active: false });
    expect(fp.total).toBe(7);
  });

  it("resolves the key prefix for EntityDefinitionId filters", async () => {
    const prefix = await fetchKeyPrefix("Account", async (soql) => {
      expect(soql).toContain("FROM EntityDefinition");
      return { ok: true, records: [{ KeyPrefix: "001" }] };
    });
    expect(prefix).toBe("001");
    const missing = await fetchKeyPrefix("Nope__c", async () => ({ ok: true, records: [] }));
    expect(missing).toBe("");
  });

  it("lanes flows by start type and builds a forwardable brief", () => {
    expect(flowLane("RecordBeforeSave")).toBe("before");
    expect(flowLane("RecordAfterSave · AutoLaunched")).toBe("after");
    expect(flowLane("")).toBe("other");
    const md = footprintMarkdown({
      apiName: "Account",
      total: 1,
      sections: [
        { key: "triggers", label: "Triggers", status: "ok", rows: [{ id: "t", name: "AcctTrig", detail: "Active", active: true }] },
        { key: "flows", label: "Flows", status: "unavailable", rows: [], note: "denied" },
      ],
    });
    expect(md).toContain("# Automation footprint · Account");
    expect(md).toContain("- AcctTrig - Active (active)");
    expect(md).toContain("## Flows (unavailable)");
  });

  it("resolves field usage through the dependency index", async () => {
    const usage = await fetchFieldUsage("Account", "Industry", async (soql) => {
      if (soql.includes("FROM FieldDefinition")) return { ok: true, records: [{ DurableId: "00Nxx" }] };
      if (soql.includes("FROM MetadataComponentDependency")) {
        return { ok: true, records: [{ MetadataComponentName: "Acct Flow", MetadataComponentType: "Flow" }] };
      }
      return { ok: false, error: "no mock" };
    });
    expect(usage.status).toBe("ok");
    expect(usage.deps).toEqual([{ name: "Acct Flow", type: "Flow" }]);
    const missing = await fetchFieldUsage("Account", "Nope__c", async () => ({ ok: true, records: [] }));
    expect(missing.status).toBe("unavailable");
  });

  it("marks sections unavailable instead of fabricating zeros", async () => {
    const fp = await fetchFootprint("Account", "001", async () => ({ ok: false, error: "invalid field" }));
    expect(fp.sections.every((s) => s.status === "unavailable" && s.rows.length === 0)).toBe(true);
    expect(fp.total).toBe(0);
  });
});
