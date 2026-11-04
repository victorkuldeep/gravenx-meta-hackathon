import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SALESFORCE_TOOLS } from "./toolsSalesforce";
import { toolsForSkill } from "./toolsSystem";
import { clearCachedConnection, setCachedConnection } from "@/lib/session/cache";
import { clearSessionExpired, isSalesforceConnected } from "./gate";

function tool(name: string) {
  const t = SALESFORCE_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(`missing tool ${name}`);
  return t;
}

async function run(name: string, args: unknown) {
  const t = tool(name);
  const checked = t.schema.safeParse(args);
  if (!checked.success) return { ok: false, error: "schema" };
  return t.execute(checked.data);
}

beforeEach(() => {
  clearCachedConnection();
  clearSessionExpired();
  try {
    sessionStorage.clear();
  } catch {
    /* happy-dom always has it */
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearCachedConnection();
  clearSessionExpired();
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

function seedSession() {
  setCachedConnection({
    instanceUrl: "https://myorg.my.salesforce.com",
    token: "TOKEN",
    apiVersion: "v60.0",
    objects: [],
    objectCount: 0,
    orgKey: "test",
  });
}

function stubFetch(payload: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => payload }))
  );
}

describe("salesforce session tools", () => {
  it("registers under the studio skill with reads free and apex gated", () => {
    expect(toolsForSkill("studio").map((t) => t.name)).toEqual([
      "query_sosl_build",
      "query_soql_build",
      "erd_snapshots",
      "query_soql_run",
      "query_sosl_run",
      "query_tooling_run",
      "metadata_describe",
      "apex_run",
    ]);
    expect(tool("apex_run").needsApproval).toBe(true);
    expect(tool("query_soql_run").needsApproval).toBe(false);
    expect(tool("query_sosl_run").needsApproval).toBe(false);
    expect(tool("query_tooling_run").needsApproval).toBe(false);
    expect(tool("metadata_describe").needsApproval).toBe(false);
  });

  it("refuses without a live connection - never asks for tokens", async () => {
    for (const name of ["query_soql_run", "query_sosl_run", "query_tooling_run", "metadata_describe", "apex_run"]) {
      const args =
        name === "apex_run"
          ? { code: "System.debug(1);" }
          : name === "metadata_describe"
            ? { objectName: "Account" }
            : name === "query_sosl_run"
              ? { sosl: "FIND {x} RETURNING Account(Id)" }
              : { soql: "SELECT Id FROM Account LIMIT 1" };
      const r = await run(name, args);
      expect(r.ok).toBe(false);
      expect(String((r as { error?: unknown }).error)).toMatch(/connect/i);
    }
  });

  it("rejects malformed statements and oversized blocks", async () => {
    expect((await run("query_soql_run", { soql: "FIND {x} RETURNING Account(Id)" })).ok).toBe(false);
    expect((await run("query_sosl_run", { sosl: "SELECT Id FROM Account" })).ok).toBe(false);
    expect((await run("apex_run", { code: "" })).ok).toBe(false);
    expect((await run("apex_run", { code: "x".repeat(9000) })).ok).toBe(false);
  });

  it("runs SOQL capped at 25 rows with attributes stripped", async () => {
    seedSession();
    const records = Array.from({ length: 30 }, (_, i) => ({
      attributes: { type: "Account", url: `/sobjects/Account/${i}` },
      Id: `001${i}`,
      Name: `Acme ${i}`,
    }));
    stubFetch({ success: true, records, totalSize: 30, done: true });
    const r = await run("query_soql_run", { soql: "SELECT Id, Name FROM Account" });
    expect(r.ok).toBe(true);
    const result = (r as { result: { totalSize: number; returned: number; hasMore: boolean; records: unknown[]; note?: string } }).result;
    expect(result.totalSize).toBe(30);
    expect(result.returned).toBe(25);
    expect(result.records[0]).toEqual({ Id: "0010", Name: "Acme 0" });
    expect(typeof result.note).toBe("string");
  });

  it("runs SOSL grouped by object", async () => {
    seedSession();
    stubFetch({
      success: true,
      searchRecords: [
        { attributes: { type: "Account" }, Id: "001A", Name: "Acme" },
        { attributes: { type: "Contact" }, Id: "003B", FirstName: "Ada" },
      ],
      totalSize: 2,
    });
    const r = await run("query_sosl_run", { sosl: "FIND {Acme} RETURNING Account(Id, Name), Contact(Id, FirstName)" });
    expect(r.ok).toBe(true);
    const result = (r as { result: { total: number; byObject: Record<string, number> } }).result;
    expect(result.total).toBe(2);
    expect(result.byObject).toEqual({ Account: 1, Contact: 1 });
  });

  it("runs anonymous Apex and truncates long logs", async () => {
    seedSession();
    stubFetch({ ok: true, result: { compiled: true, success: true, line: -1, debugLog: "x".repeat(5000) } });
    const r = await run("apex_run", { code: "System.debug('hi');" });
    expect(r.ok).toBe(true);
    const result = (r as { result: { success: boolean; debugLog: string } }).result;
    expect(result.success).toBe(true);
    expect(result.debugLog.length).toBeLessThan(5000);
    expect(result.debugLog).toContain("truncated");
  });

  it("reports compile failures with the org message", async () => {
    seedSession();
    stubFetch({ ok: true, result: { compiled: false, success: false, line: 1, compileProblem: "Unexpected token" } });
    const r = await run("apex_run", { code: "System.debug(" });
    expect(r.ok).toBe(true);
    const result = (r as { result: { compiled: boolean; problem: string; line: number } }).result;
    expect(result.compiled).toBe(false);
    expect(result.problem).toBe("Unexpected token");
  });

  it("sends tooling queries through the Tooling API flag", async () => {
    seedSession();
    const seen: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: { body?: unknown }) => {
        seen.push(init?.body);
        return { ok: true, status: 200, json: async () => ({ success: true, records: [], totalSize: 0, done: true }) };
      })
    );
    const r = await run("query_tooling_run", { soql: "SELECT Id, Name FROM ApexClass LIMIT 5" });
    expect(r.ok).toBe(true);
    const sent = JSON.parse(String(seen[0])) as { tooling?: boolean; soql?: string };
    expect(sent.tooling).toBe(true);
    expect(sent.soql).toContain("ApexClass");
  });

  it("rejects bad object names before any network call", async () => {
    seedSession();
    const spy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal("fetch", spy);
    expect((await run("metadata_describe", { objectName: "12 Nope!" })).ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("describes one object capped with counts", async () => {
    seedSession();
    const fields = Array.from({ length: 90 }, (_, i) => ({
      name: `Field${i}__c`,
      label: `Field ${i}`,
      type: "string",
      nillable: i !== 0,
      custom: true,
    }));
    stubFetch({
      name: "Invoice__c",
      label: "Invoice",
      labelPlural: "Invoices",
      custom: true,
      createable: true,
      updateable: true,
      fields,
      childRelationships: [{ childSObject: "Invoice_Line__c", field: "Invoice__c", relationshipName: "Lines" }],
    });
    const r = await run("metadata_describe", { objectName: "Invoice__c" });
    expect(r.ok).toBe(true);
    const result = (
      r as {
        result: {
          fieldCount: number;
          fields: { api: string; required: boolean }[];
          note?: string;
          childCount: number;
          children: string[];
        };
      }
    ).result;
    expect(result.fieldCount).toBe(90);
    expect(result.fields).toHaveLength(80);
    expect(result.fields[0]).toEqual({ api: "Field0__c", label: "Field 0", type: "string", required: true, custom: true });
    expect(typeof result.note).toBe("string");
    expect(result.childCount).toBe(1);
    expect(result.children).toEqual(["Lines (Invoice_Line__c)"]);
  });

  it("closes the AI gate on an expired session", async () => {
    seedSession();
    stubFetch({ error: "Session expired" }, 401);
    const r = await run("query_soql_run", { soql: "SELECT Id FROM Account LIMIT 1" });
    expect(r.ok).toBe(false);
    expect(isSalesforceConnected()).toBe(false);
  });
});
