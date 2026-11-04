import { describe, expect, it } from "vitest";
import { JSON_TOOLS, STUDIO_TOOLS } from "./toolsStudio";
import { toolsForSkill } from "./toolsSystem";

async function run(name: string, args: unknown) {
  const tool = [...STUDIO_TOOLS, ...JSON_TOOLS].find((t) => t.name === name)!;
  const checked = tool.schema.safeParse(args);
  if (!checked.success) return { ok: false, error: "schema" };
  return tool.execute(checked.data);
}

describe("studio packs", () => {
  it("validates SOSL and builds the search URL", async () => {
    const bad = await run("query_sosl_build", { sosl: "SELECT Id FROM Account" });
    expect(bad.ok).toBe(false);
    const noHost = await run("query_sosl_build", { sosl: "FIND {Acme} RETURNING Account(Id)" });
    expect(noHost.ok).toBe(true);
    const full = await run("query_sosl_build", {
      sosl: "FIND {Acme} RETURNING Account(Id)",
      instanceUrl: "https://myorg.my.salesforce.com",
      apiVersion: "v60.0",
    });
    expect(full.ok).toBe(true);
    expect(JSON.stringify(full)).toContain("/services/data/v60.0/search");
    const evil = await run("query_sosl_build", {
      sosl: "FIND {x} RETURNING Account(Id)",
      instanceUrl: "https://myorg.my.salesforce.com/evil?q=1",
    });
    expect(evil.ok).toBe(false);
  });

  it("inspects JSON structure and rejects invalid JSON", async () => {
    const good = await run("json_inspect", { json: JSON.stringify({ a: 1, b: [{ c: 2 }] }) });
    expect(good.ok).toBe(true);
    expect(JSON.stringify(good)).toContain("keysByDepth");
    const bad = await run("json_inspect", { json: "{oops" });
    expect(bad.ok).toBe(false);
  });

  it("lists snapshots or degrades gracefully off-browser", async () => {
    const r = await run("erd_snapshots", { orgDomain: "myorg.my.salesforce.com" });
    // happy-dom has no IndexedDB: the tool must degrade, never throw.
    expect(typeof r.ok).toBe("boolean");
  });

  it("validates SOQL and builds the query URL", async () => {
    const bad = await run("query_soql_build", { soql: "FIND {x} RETURNING Account(Id)" });
    expect(bad.ok).toBe(false);
    const full = await run("query_soql_build", {
      soql: "SELECT Id FROM Account LIMIT 10",
      instanceUrl: "https://myorg.my.salesforce.com",
      apiVersion: "v60.0",
    });
    expect(full.ok).toBe(true);
    expect(JSON.stringify(full)).toContain("/services/data/v60.0/query?q=");
  });

  it("routes the new packs by skill", () => {
    expect(toolsForSkill("studio").map((t) => t.name)).toEqual(["query_sosl_build", "query_soql_build", "erd_snapshots", "query_soql_run", "query_sosl_run", "query_tooling_run", "metadata_describe", "apex_run"]);
    expect(toolsForSkill("json").map((t) => t.name)).toEqual(["json_inspect"]);
    expect(toolsForSkill("mapping")).toEqual([]);
  });
});
