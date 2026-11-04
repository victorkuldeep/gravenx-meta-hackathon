import { describe, it, expect } from "vitest";
import { diffCompiledDocuments, severityCounts } from "./compatibility";
import { compileContract } from "./openapi-compiler";
import { adaptDescribe } from "./metadata-adapter";
import { seedLeadAcquisition, seedLeadEnrichment } from "./seeds";
import { leadDescribeFixture } from "./test-fixtures";
import { summarizeProfileChange } from "./revisions";
import type { ContractFieldMeta } from "./metadata-adapter";

const NOW = 1758412800000;
const meta = () => {
  const m = new Map<string, ContractFieldMeta>();
  for (const f of adaptDescribe(leadDescribeFixture()).fields) m.set(f.apiName, f);
  return m;
};
const docOf = (profile: ReturnType<typeof seedLeadAcquisition>) =>
  compileContract({ profile, metaByName: meta(), snapshotCapturedAt: NOW, now: NOW }).document as Record<string, unknown>;

describe("compatibility", () => {
  it("flags removed operations and properties as breaking", () => {
    const before = docOf(seedLeadAcquisition());
    const slim = seedLeadAcquisition();
    slim.fields = slim.fields.filter((f) => f.salesforceApiName !== "Email");
    const after = docOf(slim);
    const changes = diffCompiledDocuments(before, after);
    const removed = changes.find((c) => c.kind === "removed-property");
    expect(removed?.severity).toBe("breaking");
    expect(removed?.path).toMatch(/email/);
  });
  it("flags newly required properties as breaking, optional as compatible", () => {
    const before = docOf(seedLeadAcquisition());
    const afterProfile = seedLeadAcquisition();
    const phone = afterProfile.fields.find((f) => f.salesforceApiName === "Phone");
    if (phone) phone.integrationRequired = true;
    const after = docOf(afterProfile);
    const changes = diffCompiledDocuments(before, after);
    expect(changes.some((c) => c.kind === "required-added" && c.severity === "breaking")).toBe(true);
  });
  it("flags removed enum values as breaking, added as compatible", () => {
    const before = docOf(seedLeadAcquisition());
    const afterProfile = seedLeadAcquisition();
    const status = afterProfile.fields.find((f) => f.salesforceApiName === "Status");
    if (status) status.enumOverride = ["New"];
    const after = docOf(afterProfile);
    const changes = diffCompiledDocuments(before, after);
    expect(changes.some((c) => c.kind === "enum-removed" && c.severity === "breaking")).toBe(true);
  });
  it("compares Acquisition vs Enrichment as disjoint contracts", () => {
    const changes = diffCompiledDocuments(docOf(seedLeadAcquisition()), docOf(seedLeadEnrichment()));
    const { breaking, compatible } = severityCounts(changes);
    expect(breaking).toBeGreaterThan(0);
    expect(compatible).toBeGreaterThan(0);
  });
  it("identical documents yield no structural changes", () => {
    const d = docOf(seedLeadAcquisition());
    expect(diffCompiledDocuments(d, JSON.parse(JSON.stringify(d)))).toHaveLength(0);
  });
});

describe("summarizeProfileChange", () => {
  it("summarizes field and operation deltas", () => {
    const prev = seedLeadAcquisition();
    const next = seedLeadAcquisition();
    next.fields = next.fields.filter((f) => f.salesforceApiName !== "Email");
    next.fields.push({ ...next.fields[0], salesforceApiName: "Website", externalName: "website" });
    expect(summarizeProfileChange(prev, next)).toMatch(/\+1 field/);
    expect(summarizeProfileChange(prev, next)).toMatch(/-1 field/);
  });
  it("reports initial revision", () => {
    expect(summarizeProfileChange(null, seedLeadAcquisition())).toBe("Initial revision.");
  });
});
