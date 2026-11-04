import { describe, expect, it } from "vitest";
import { clearAudit, listAuditRuns, logToolRun } from "./audit";

describe("agent audit degradation", () => {
  it("never throws off-browser", async () => {
    // happy-dom has no IndexedDB: every op degrades to a safe empty.
    await expect(logToolRun({ skill: "studio", tool: "apex_run", label: "Run", ok: true })).resolves.toBeUndefined();
    await expect(listAuditRuns()).resolves.toEqual([]);
    await expect(clearAudit()).resolves.toBeUndefined();
  });
});
