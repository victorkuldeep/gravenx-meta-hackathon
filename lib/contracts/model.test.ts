import { describe, it, expect } from "vitest";
import { validateProfileConfig } from "./profile-schema";
import { contentHash, stableStringify, toJsonString, toYamlString, parseYaml } from "./export";
import { seedLeadAcquisition, seedLeadEnrichment } from "./seeds";

describe("profile-schema", () => {
  it("accepts the seeded profiles", () => {
    expect(validateProfileConfig(seedLeadAcquisition()).ok).toBe(true);
    expect(validateProfileConfig(seedLeadEnrichment()).ok).toBe(true);
  });
  it("rejects missing name, bad operationId, empty operations", () => {
    const bad = { ...seedLeadAcquisition(), name: "", fields: [{ ...seedLeadAcquisition().fields[0], operations: [] }] };
    const r = validateProfileConfig(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/name|operations/);
  });
  it("rejects invalid operationId", () => {
    const p = seedLeadAcquisition();
    p.operations[0].operationId = "has space";
    expect(validateProfileConfig(p).ok).toBe(false);
  });
});

describe("export", () => {
  const doc = { openapi: "3.1.0", info: { title: "T", version: "1" } };
  it("YAML and JSON serialize equivalently", () => {
    const back = parseYaml(toYamlString(doc)) as typeof doc;
    expect(back).toEqual(JSON.parse(toJsonString(doc)));
  });
  it("stableStringify ignores key order; contentHash is deterministic", () => {
    const a = stableStringify({ b: 1, a: { y: 2, x: 1 } });
    const b = stableStringify({ a: { x: 1, y: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(contentHash(a)).toBe(contentHash(b));
    expect(contentHash(`${a}~`)).not.toBe(contentHash(a));
  });
});

describe("seeds", () => {
  it("acquisition is native POST, enrichment is custom PATCH", () => {
    const a = seedLeadAcquisition();
    expect(a.operations.find((o) => o.operation === "POST")?.enabled).toBe(true);
    expect(a.baseUrl).toBe("");
    const e = seedLeadEnrichment();
    expect(e.operations.find((o) => o.operation === "PATCH")?.enabled).toBe(true);
    expect(e.baseUrl).toBe("https://api.example.com");
  });
  it("seeds are isolated (no shared references)", () => {
    const a = seedLeadAcquisition();
    a.fields[0].externalName = "MUTATED";
    expect(seedLeadAcquisition().fields[0].externalName).not.toBe("MUTATED");
  });
});
