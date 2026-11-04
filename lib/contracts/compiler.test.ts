import { describe, it, expect } from "vitest";
import { compileContract } from "./openapi-compiler";
import { adaptDescribe } from "./metadata-adapter";
import { validateExampleAgainstSchema } from "./diagnostics";
import { parseYaml } from "./export";
import { seedLeadAcquisition, seedLeadEnrichment } from "./seeds";
import { leadDescribeFixture } from "./test-fixtures";
import type { ContractFieldMeta } from "./metadata-adapter";

const NOW = 1758412800000;
const meta = () => {
  const m = new Map<string, ContractFieldMeta>();
  for (const f of adaptDescribe(leadDescribeFixture()).fields) m.set(f.apiName, f);
  return m;
};

describe("compiler - acquisition", () => {
  it("generates a deterministic OpenAPI 3.1 document", () => {
    const input = { profile: seedLeadAcquisition(), metaByName: meta(), snapshotCapturedAt: NOW, now: NOW };
    const a = compileContract(input);
    const b = compileContract(input);
    expect(a.yaml).toBe(b.yaml);
    expect(a.json).toBe(b.json);
    expect(a.hash).toBe(b.hash);
    expect(a.document.openapi).toBe("3.1.0");
    expect(Object.keys(a.document.paths as object)).toEqual([
      "/services/data/v66.0/sobjects/Lead",
    ]);
  });
  it("excludes PATCH schema when disabled; requiredness is POST-scoped", () => {
    const r = compileContract({ profile: seedLeadAcquisition(), metaByName: meta(), snapshotCapturedAt: NOW, now: NOW });
    const schemas = r.document.components as { schemas: Record<string, { required?: string[] }> };
    expect(schemas.schemas.LeadCreateRequest).toBeDefined();
    expect(schemas.schemas.LeadUpdateRequest).toBeUndefined();
    // LastName/Company are SF-required on POST...
    expect(schemas.schemas.LeadCreateRequest.required).toEqual(
      expect.arrayContaining(["lastName", "organization"])
    );
  });
  it("never leaks unselected fields", () => {
    const r = compileContract({ profile: seedLeadAcquisition(), metaByName: meta(), snapshotCapturedAt: NOW, now: NOW });
    const schemas = r.document.components as { schemas: Record<string, { properties: object }> };
    const props = Object.keys(schemas.schemas.LeadCreateRequest.properties);
    expect(props).not.toContain("Website");
    expect(props).not.toContain("CreatedDate");
    expect(props).toHaveLength(9);
  });
  it("external aliases preserve Salesforce traceability", () => {
    const r = compileContract({ profile: seedLeadAcquisition(), metaByName: meta(), snapshotCapturedAt: NOW, now: NOW });
    const trace = r.traceability.find((t) => t.externalName === "organization");
    expect(trace?.salesforceApiName).toBe("Company");
    expect(trace?.transform).toBe("direct");
  });
  it("every example validates against its schema", () => {
    const r = compileContract({ profile: seedLeadAcquisition(), metaByName: meta(), snapshotCapturedAt: NOW, now: NOW });
    const schemas = r.document.components as { schemas: Record<string, { properties: Record<string, { type?: string; enum?: string[]; nullable?: boolean }>; required?: string[] }> };
    for (const [op, example] of Object.entries(r.examples)) {
      const name = op === "POST" ? "LeadCreateRequest" : "LeadUpdateRequest";
      const violations = validateExampleAgainstSchema(example, schemas.schemas[name]);
      expect(violations).toEqual([]);
    }
  });
  it("YAML and JSON are equivalent documents", () => {
    const r = compileContract({ profile: seedLeadAcquisition(), metaByName: meta(), snapshotCapturedAt: NOW, now: NOW });
    expect(parseYaml(r.yaml)).toEqual(JSON.parse(r.json));
  });
  it("all $refs resolve", () => {
    const r = compileContract({ profile: seedLeadAcquisition(), metaByName: meta(), snapshotCapturedAt: NOW, now: NOW });
    const text = r.json;
    const refs = [...text.matchAll(/#\/components\/schemas\/(\w+)/g)].map((m) => m[1]);
    const schemas = (r.document.components as { schemas: Record<string, unknown> }).schemas;
    for (const ref of new Set(refs)) {
      expect(schemas).toHaveProperty(ref);
    }
  });
});

describe("compiler - enrichment (PATCH)", () => {
  it("PATCH properties are optional; custom path + id param emitted", () => {
    const r = compileContract({ profile: seedLeadEnrichment(), metaByName: meta(), snapshotCapturedAt: NOW, now: NOW });
    const schemas = r.document.components as { schemas: Record<string, { required?: string[] }> };
    expect(schemas.schemas.LeadUpdateRequest.required ?? []).toEqual([]);
    expect(Object.keys(r.document.paths as object)).toEqual(["/v1/leads/{id}"]);
  });
  it("profiles stay isolated on the same object", () => {
    const a = compileContract({ profile: seedLeadAcquisition(), metaByName: meta(), snapshotCapturedAt: NOW, now: NOW });
    const e = compileContract({ profile: seedLeadEnrichment(), metaByName: meta(), snapshotCapturedAt: NOW, now: NOW });
    expect(a.hash).not.toBe(e.hash);
    expect(JSON.stringify(a.document)).not.toContain("/v1/leads");
    expect(JSON.stringify(e.document)).not.toContain("LeadCreateRequest");
  });
});

describe("compiler - gates and diagnostics", () => {
  it("empty contract errors but still emits a skeleton", () => {
    const p = seedLeadAcquisition();
    p.operations.forEach((o) => { o.enabled = false; });
    const r = compileContract({ profile: p, metaByName: meta(), snapshotCapturedAt: NOW, now: NOW });
    expect(r.diagnostics.some((d) => d.code === "no-operations" && d.level === "error")).toBe(true);
    expect(r.document.paths).toEqual({});
  });
  it("non-createable fields error (CreatedDate never enters POST)", () => {
    const p = seedLeadAcquisition();
    p.fields.push({
      salesforceApiName: "CreatedDate", externalName: "createdDate", label: "Created", description: "",
      operations: ["POST"], integrationRequired: false, nullable: false, ownership: "salesforce",
    });
    const r = compileContract({ profile: p, metaByName: meta(), snapshotCapturedAt: NOW, now: NOW });
    expect(r.diagnostics.some((d) => d.code === "not-writable")).toBe(true);
    const schemas = r.document.components as { schemas: Record<string, { properties: object }> };
    expect(schemas.schemas.LeadCreateRequest.properties).not.toHaveProperty("createdDate");
  });
  it("duplicate external names error", () => {
    const p = seedLeadAcquisition();
    p.fields[1] = { ...p.fields[1], externalName: "firstName" };
    const r = compileContract({ profile: p, metaByName: meta(), snapshotCapturedAt: NOW, now: NOW });
    expect(r.diagnostics.some((d) => d.code === "duplicate-external-name")).toBe(true);
  });
  it("stale snapshot warns", () => {
    const r = compileContract({
      profile: seedLeadAcquisition(), metaByName: meta(),
      snapshotCapturedAt: NOW - 8 * 24 * 3600 * 1000, now: NOW,
    });
    expect(r.diagnostics.some((d) => d.code === "stale-snapshot" && d.level === "warning")).toBe(true);
  });
  it("nullable fields emit nullable", () => {
    const p = seedLeadAcquisition();
    const email = p.fields.find((f) => f.salesforceApiName === "Email");
    if (email) email.nullable = true;
    const r = compileContract({ profile: p, metaByName: meta(), snapshotCapturedAt: NOW, now: NOW });
    const schemas = r.document.components as { schemas: Record<string, { properties: Record<string, { nullable?: boolean }> }> };
    expect(schemas.schemas.LeadCreateRequest.properties.email.nullable).toBe(true);
  });
});
