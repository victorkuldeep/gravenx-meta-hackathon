import { describe, expect, it } from "vitest";
import { buildEntry, renderActivityReport, type ArchActivityEntry } from "./erd-activity";

function entry(over: Partial<ArchActivityEntry> = {}): ArchActivityEntry {
  return buildEntry(
    {
      actor: "architect",
      surface: "erd",
      view: "erd",
      root: "Account",
      category: "metadata",
      action: "create-field",
      target: "Account.Tier__c",
      ok: true,
      message: "deployed",
      ...over,
    },
    1700000000000
  );
}

describe("erd-activity", () => {
  it("builds timestamped entries with unique ids", () => {
    const a = entry();
    const b = entry();
    expect(a.at).toBe(1700000000000);
    expect(a.id).not.toBe(b.id);
    expect(a.id.startsWith("arch_")).toBe(true);
  });

  it("renders a JIRA-pasteable markdown report", () => {
    const md = renderActivityReport(
      [entry(), entry({ action: "update-record", category: "data", target: "Account/001", ok: false, message: "BOOM|pipe" })],
      "acn1-dev-ed.develop.my.salesforce.com"
    );
    expect(md).toContain("# Arch Activity - GRAVENX ERD");
    expect(md).toContain("Actions: 2 (1 succeeded, 1 failed)");
    expect(md).toContain("Account.Tier__c");
    expect(md).toContain("Account/001");
    // Pipes are escaped so the table survives paste.
    expect(md).toContain("BOOM\\|pipe");
    expect(md).toContain("Canvas-local curation");
  });

  it("handles an empty log without breaking the table", () => {
    const md = renderActivityReport([], "unknown");
    expect(md).toContain("Actions: 0 (0 succeeded, 0 failed)");
  });
});
