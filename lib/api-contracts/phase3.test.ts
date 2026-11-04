import { describe, it, expect } from "vitest";
import { prefillProperty } from "./schema-prefill";
import { suggestSchemaGaps, mergeSuggestions } from "./assistant";
import { stageStatus } from "./stages";
import { adaptDescribe } from "../contracts/metadata-adapter";
import { leadDescribeFixture } from "../contracts/test-fixtures";
import { seedAcquisitionProject } from "./seeds";

const metaByName = () => {
  const m = new Map();
  for (const f of adaptDescribe(leadDescribeFixture()).fields) m.set(f.apiName, f);
  return m;
};

describe("schema-prefill", () => {
  it("prefills type, format, enum and requiredness from facts", () => {
    const meta = metaByName();
    const status = prefillProperty("Lead", meta.get("Status"));
    expect(status.type).toBe("string");
    expect(status.enum).toEqual(["New", "Contacted"]);
    expect(status.required).toBe(true);
    const email = prefillProperty("Lead", meta.get("Email"));
    expect(email.format).toBe("email");
    expect(email.required).toBe(false);
    const mrc = prefillProperty("Lead", meta.get("AnnualRevenue"));
    expect(mrc.type).toBe("number");
  });
  it("architect owns everything after creation", () => {
    const p = prefillProperty("Lead", metaByName().get("FirstName"));
    expect(p.description).toBe("");
    expect(p.externalName).toBe("FirstName");
  });
});

describe("schema gaps", () => {
  it("flags empty schemas, undescribed and unmapped-required properties", () => {
    const p = seedAcquisitionProject();
    p.schemas.push({ name: "Empty", description: "", properties: [] });
    const sugs = suggestSchemaGaps(p);
    expect(sugs.some((s) => s.id === "sug-schema-empty-Empty")).toBe(true);
    expect(sugs.some((s) => s.id === "sug-schema-desc-LeadCreateRequest")).toBe(true);
    expect(sugs.every((s) => s.status === "proposed")).toBe(true);
    expect(mergeSuggestions(p, sugs).added).toBe(sugs.length);
  });
});

describe("stage 6 status", () => {
  it("blocks on missing or empty schemas", () => {
    const full = seedAcquisitionProject();
    const ok = new Map(stageStatus(full).map((s) => [s.id, s]));
    expect(ok.get("schemas")?.complete).toBe(true);
    const empty = seedAcquisitionProject();
    empty.schemas = [];
    expect(new Map(stageStatus(empty).map((s) => [s.id, s])).get("schemas")?.complete).toBe(false);
  });
});
