import { describe, expect, it } from "vitest";
import { clearFootprintCache, fetchEntityId, fetchFieldUsage, fetchFootprint, fetchFootprintCached, flowLane, footprintMarkdown, footprintSectionKeys, type FootprintRunner } from "./footprint";

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
      if (soql.includes("FROM FlowDefinition")) {
        return { ok: true, records: [{ Id: "d1", DeveloperName: "F", MasterLabel: "F", LatestVersionId: "v1" }] };
      }
      if (soql.includes("FROM Flow WHERE Id =")) {
        return { ok: true, records: [{ Id: "v1", Status: "Active", Metadata: { start: { object: "Account", triggerType: "RecordBeforeSave" } } }] };
      }
      return { ok: true, records: [] };
    });
    expect(footprintSectionKeys()).toEqual(["triggers", "flows", "queues", "validation", "approvals", "duplicates", "assignment"]);
    expect(fp.sections).toHaveLength(7);
    expect(fp.sections.every((s) => s.status === "ok")).toBe(true);
    expect(seen.some((q) => q.includes("SobjectType = 'Account'"))).toBe(true);
    expect(seen.some((q) => q.includes("FROM ApexTrigger") && q.includes("TableEnumOrId = 'Account'"))).toBe(true);
    expect(seen.some((q) => q.includes("FROM FlowDefinition"))).toBe(true);
    expect(seen.some((q) => q.includes("FROM Flow WHERE Id ="))).toBe(true);
    expect(seen.some((q) => q.includes("EntityDefinitionId = '001'"))).toBe(true);
    expect(fp.total).toBe(1);
  });

  it("falls back to minimal selects and picks names across shapes", async () => {
    const fp = await fetchFootprint(
      "Invoice__c",
      "a00",
      runnerFor({
        "FROM ApexTrigger": [{ Id: "t1", Name: "InvoiceTrigger", Status: "Active" }],
        "!Queue.DeveloperName": [],
        "SELECT QueueId FROM": [{ QueueId: "q1", Queue: { Name: "Billing Queue" } }],
        "FROM FlowDefinition": [
          { Id: "def1", DeveloperName: "New_Invoice_Flow", MasterLabel: "New Invoice Flow", LatestVersionId: "301v2" },
          { Id: "def2", DeveloperName: "Other_Flow", MasterLabel: "Other", LatestVersionId: "301v9" },
        ],
        "301v2": [
          { Id: "301v2", Status: "Active", Metadata: { start: { object: "Invoice__c", triggerType: "RecordAfterSave", recordTriggerType: "Update" } } },
        ],
        "301v9": [{ Id: "301v9", Status: "Draft", Metadata: { start: { object: "Account" } } }],
        "FROM ValidationRule": [{ Id: "v1", ValidationName: "Amount_Positive", Active: true, ErrorMessage: "Must be positive" }],
        "FROM ProcessDefinition": [{ Id: "a1", Name: "Invoice Approval", Active: true }],
        "IsActive FROM": [{ Id: "d1", MasterLabel: "Invoice Match", IsActive: false }],
        "FROM AssignmentRule": [{ Id: "s1", Name: "Invoice Assign", Active: true }],
      })
    );
    const byKey = Object.fromEntries(fp.sections.map((s) => [s.key, s]));
    expect(byKey.triggers.rows[0]).toMatchObject({ name: "InvoiceTrigger", active: true });
    expect(byKey.flows.rows).toHaveLength(1);
    expect(byKey.flows.rows[0]).toMatchObject({ name: "New Invoice Flow", detail: "RecordAfterSave · Update", active: true });
    expect(byKey.queues.rows[0]).toMatchObject({ name: "Billing Queue" });
    expect(byKey.validation.rows[0].name).toBe("Amount_Positive");
    expect(byKey.duplicates.rows[0]).toMatchObject({ active: false });
    expect(fp.total).toBe(7);
  });

  it("resolves the entity id for EntityDefinitionId filters", async () => {
    const id = await fetchEntityId("Account", async (soql) => {
      expect(soql).toContain("FROM EntityDefinition");
      return { ok: true, records: [{ DurableId: "01Ixx" }] };
    });
    expect(id).toBe("01Ixx");
    const missing = await fetchEntityId("Nope__c", async () => ({ ok: true, records: [] }));
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
    const seen: string[] = [];
    const usage = await fetchFieldUsage("Account", "Industry", async (soql) => {
      seen.push(soql);
      if (soql.includes("FROM FieldDefinition")) return { ok: true, records: [{ Id: "00Nxx", DurableId: "01Ixx.00Nxx" }] };
      if (soql.includes("FROM MetadataComponentDependency")) {
        if (soql.includes("00Nxx") && !soql.includes("01Ixx")) {
          return { ok: true, records: [{ MetadataComponentName: "Acct Flow", MetadataComponentType: "Flow" }] };
        }
        return { ok: true, records: [] };
      }
      return { ok: false, error: "no mock" };
    });
    expect(usage.status).toBe("ok");
    expect(usage.deps).toEqual([{ name: "Acct Flow", type: "Flow" }]);
    expect(seen.some((q) => q.includes("RefMetadataComponentId = '00Nxx'"))).toBe(true);
    const missing = await fetchFieldUsage("Account", "Nope__c", async () => ({ ok: true, records: [] }));
    expect(missing.status).toBe("unavailable");
    const down = await fetchFieldUsage("Account", "Industry", async (soql) => {
      if (soql.includes("FROM FieldDefinition")) return { ok: true, records: [{ Id: "00Nxx" }] };
      return { ok: false, error: "index down" };
    });
    expect(down.status).toBe("unavailable");
    expect(down.note).toBe("index down");
  });

  it("holds footprints in cache until forced or cleared", async () => {
    clearFootprintCache();
    let calls = 0;
    const run: FootprintRunner = async () => {
      calls += 1;
      return { ok: true, records: [] };
    };
    const first = await fetchFootprintCached("Invoice__c", "01Ixx", run);
    expect(calls).toBeGreaterThan(0);
    const second = await fetchFootprintCached("Invoice__c", "01Ixx", run);
    expect(second).toBe(first);
    const forced = await fetchFootprintCached("Invoice__c", "01Ixx", run, { force: true });
    expect(forced).not.toBe(first);
    expect(forced.at).toBeGreaterThanOrEqual(first.at);
    clearFootprintCache("Invoice__c");
    const afterClear = await fetchFootprintCached("Invoice__c", "01Ixx", run);
    expect(afterClear).not.toBe(forced);
    clearFootprintCache();
  });

  it("marks sections unavailable instead of fabricating zeros", async () => {
    const fp = await fetchFootprint("Account", "001", async () => ({ ok: false, error: "invalid field" }));
    expect(fp.sections.every((s) => s.status === "unavailable" && s.rows.length === 0)).toBe(true);
    expect(fp.total).toBe(0);
  });

  it("runs queues through the standard API, tooling for everything else", async () => {
    const seen: { soql: string; tooling: boolean | undefined }[] = [];
    const fp = await fetchFootprint("Invoice__c", "a00", async (soql, tooling) => {
      seen.push({ soql, tooling });
      if (soql.includes("FROM QueueSobject")) {
        return { ok: true, records: [{ QueueId: "q1", Queue: { Name: "Esc Invoices", DeveloperName: "Esc_Invoices" } }] };
      }
      return { ok: true, records: [] };
    });
    const queueCalls = seen.filter((s) => s.soql.includes("FROM QueueSobject"));
    expect(queueCalls.length).toBeGreaterThan(0);
    expect(queueCalls.every((s) => s.tooling === false)).toBe(true);
    expect(seen.filter((s) => !s.soql.includes("FROM QueueSobject")).every((s) => s.tooling !== false)).toBe(true);
    const queues = fp.sections.find((s) => s.key === "queues");
    expect(queues?.status).toBe("ok");
    expect(queues?.rows[0]).toMatchObject({ name: "Esc Invoices" });
  });
});
