import { describe, it, expect } from "vitest";
import { compileArchitectProject } from "./openapi-compiler";
import { validateExampleAgainstSchema } from "../contracts/diagnostics";
import { parseYaml } from "../contracts/export";
import { seedAcquisitionProject, seedEnrichmentProject } from "./seeds";

const at = (n: number) => n;

// NOTE: vitest's esbuild misparses `as {…}` object-literal casts when they
// follow certain generic casts in one file, so tests narrow through these
// runtime helpers instead of inline casts. See zz-repro evidence 2026-09.
type UnknownRecord = Record<string, unknown>;
const subRecord = (v: unknown): UnknownRecord =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as UnknownRecord) : {};
const schemasOf = (doc: Record<string, unknown>): UnknownRecord =>
  subRecord(subRecord(subRecord(doc).components).schemas);
const propsOf = (doc: Record<string, unknown>, name: string): UnknownRecord =>
  subRecord(subRecord(schemasOf(doc)[name]).properties);
const requiredOf = (doc: Record<string, unknown>, name: string): string[] => {
  const v: unknown = subRecord(schemasOf(doc)[name]).required;
  return Array.isArray(v) ? v.map(String) : [];
};
const pathsOf = (doc: Record<string, unknown>): UnknownRecord => subRecord(doc.paths);

describe("architect compiler", () => {
  it("generates deterministic OpenAPI 3.1 with custom routes", () => {
    const a = compileArchitectProject(seedAcquisitionProject(), at(1));
    const b = compileArchitectProject(seedAcquisitionProject(), at(1));
    expect(a.yaml).toBe(b.yaml);
    expect(a.hash).toBe(b.hash);
    expect(a.document.openapi).toBe("3.1.0");
    expect(Object.keys(a.document.paths as object).sort()).toEqual(["/leads", "/leads/{leadId}"]);
  });
  it("keeps request and response schemas independent", () => {
    const r = compileArchitectProject(seedAcquisitionProject());
    expect(Object.keys(propsOf(r.document, "LeadCreateRequest"))).toContain("company");
    expect(Object.keys(propsOf(r.document, "LeadCreateResponse"))).toContain("leadId");
    expect(Object.keys(propsOf(r.document, "LeadCreateResponse"))).not.toContain("company");
    expect(requiredOf(r.document, "LeadCreateResponse")).toContain("leadId");
  });
  it("emits path params, error refs, security placeholders", () => {
    const r = compileArchitectProject(seedEnrichmentProject());
    const patch = subRecord(subRecord(pathsOf(r.document)["/leads/{leadId}"]).patch);
    const params: unknown = patch.parameters;
    const names = (Array.isArray(params) ? params : []).map((p) => subRecord(p).name);
    expect(names).toContain("leadId");
    expect(subRecord(patch).responses).toHaveProperty("400");
    expect(subRecord(patch).security).toEqual([{ OAuth2: [] }]);
    const text = r.json;
    expect(text).not.toMatch(/Bearer [A-Za-z0-9]/);
    expect(text).toMatch(/placeholder - no secrets exported/);
  });
  it("respects readOnly/writeOnly separation", () => {
    const p = seedAcquisitionProject();
    const req = p.schemas.find((s) => s.name === "LeadCreateRequest");
    req?.properties.push({
      externalName: "createdAt", description: "", type: "string", format: "date-time",
      required: false, nullable: false, readOnly: true,
    });
    const r = compileArchitectProject(p);
    expect(subRecord(propsOf(r.document, "LeadCreateRequest").createdAt).readOnly).toBe(true);
  });
  it("external aliases trace back to Salesforce", () => {
    const r = compileArchitectProject(seedAcquisitionProject());
    const t = r.traceability.find((x) => x.externalName === "company");
    expect(t?.sourceObject).toBe("Lead");
    expect(t?.sourceField).toBe("Company");
    expect(t?.operations).toContain("createLead");
  });
  it("no unselected field leaks; examples validate", () => {
    const r = compileArchitectProject(seedAcquisitionProject());
    expect(propsOf(r.document, "LeadCreateRequest")).not.toHaveProperty("Website");
    for (const [name, example] of Object.entries(r.examples)) {
      // Round-trip through JSON to satisfy the validator's structural type
      // without inline object-literal casts (see note above).
      const schema: {
        properties?: Record<string, { type?: string; enum?: string[]; nullable?: boolean }>;
        required?: string[];
      } = JSON.parse(JSON.stringify(subRecord(schemasOf(r.document)[name])));
      expect(validateExampleAgainstSchema(example as Record<string, unknown>, schema)).toEqual([]);
    }
  });
  it("YAML and JSON are equivalent; all refs resolve", () => {
    const r = compileArchitectProject(seedAcquisitionProject());
    expect(parseYaml(r.yaml)).toEqual(JSON.parse(r.json));
    const refs = [...r.json.matchAll(/#\/components\/(schemas|responses)\/([\w-]+)/g)].map((m) => `${m[1]}.${m[2]}`);
    const comps = subRecord(r.document.components);
    for (const ref of new Set(refs)) {
      const [kind, name] = ref.split(".");
      expect(subRecord(comps[kind])).toHaveProperty(name);
    }
  });
  it("requiredness is per-schema independent", () => {
    const p = seedAcquisitionProject();
    const r = compileArchitectProject(p);
    expect(requiredOf(r.document, "LeadCreateRequest")).toContain("company");
    const e = compileArchitectProject(seedEnrichmentProject());
    expect(requiredOf(e.document, "LeadEnrichRequest")).toEqual([]);
  });
});
