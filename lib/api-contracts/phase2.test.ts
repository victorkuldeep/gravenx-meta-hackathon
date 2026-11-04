import { describe, it, expect } from "vitest";
import { stageStatus, overallComplete, STAGES } from "./stages";
import { suggestProjectGaps, mergeSuggestions } from "./assistant";
import { parseStoredProjectImport, serializeStoredProject } from "./persistence";
import { seedAcquisitionProject, seedEnrichmentProject } from "./seeds";
import type { StoredApiProject } from "./persistence";

describe("stages", () => {
  it("lists the backbone in order", () => {
    expect(STAGES.map((s) => s.id)).toEqual(["intent", "parties", "boundary", "operations", "routes", "schemas"]);
  });
  it("seed acquisition completes intent/parties/boundary, blocks nowhere structural", () => {
    const st = stageStatus(seedAcquisitionProject());
    const byId = new Map(st.map((s) => [s.id, s]));
    expect(byId.get("intent")?.complete).toBe(true);
    expect(byId.get("parties")?.complete).toBe(true);
    expect(byId.get("boundary")?.complete).toBe(true);
    expect(byId.get("operations")?.complete).toBe(true);
    expect(byId.get("routes")?.complete).toBe(true);
    expect(overallComplete(seedAcquisitionProject())).toBe(true);
  });
  it("empty project blocks content stages (routes vacuously clean)", () => {
    const p = seedAcquisitionProject();
    p.intent.purpose = "";
    p.consumer.system = "";
    p.boundary.resources = [];
    p.operations = [];
    const byId = new Map(stageStatus(p).map((s) => [s.id, s]));
    expect(byId.get("intent")?.complete).toBe(false);
    expect(byId.get("parties")?.complete).toBe(false);
    expect(byId.get("boundary")?.complete).toBe(false);
    expect(byId.get("operations")?.complete).toBe(false);
    expect(byId.get("routes")?.complete).toBe(true);
    expect(overallComplete(p)).toBe(false);
  });
});

describe("assistant project gaps", () => {
  it("proposes for missing purpose/parties/boundary", () => {
    const p = seedAcquisitionProject();
    p.intent.purpose = "";
    p.consumer.system = "";
    p.boundary.resources = [];
    const sugs = suggestProjectGaps(p);
    expect(sugs.map((s) => s.id)).toContain("sug-gap-purpose");
    expect(sugs.every((s) => s.status === "proposed")).toBe(true);
    expect(mergeSuggestions(p, sugs).added).toBe(sugs.length);
  });
  it("proposes shells for dangling schema refs", () => {
    const p = seedAcquisitionProject();
    p.operations[0].requestSchema = "Ghost";
    const sugs = suggestProjectGaps(p);
    expect(sugs.some((s) => s.id.includes("Ghost"))).toBe(true);
  });
});

describe("persistence round-trip", () => {
  const stored: StoredApiProject = {
    id: "arch-acquisition",
    project: seedAcquisitionProject(),
    snapshots: [],
  };
  it("serializes and parses back", () => {
    const back = parseStoredProjectImport(serializeStoredProject(stored));
    expect(back.id).toBe("arch-acquisition");
    expect(back.project.name).toBe(stored.project.name);
  });
  it("rejects garbage and invalid projects", () => {
    expect(() => parseStoredProjectImport("nope")).toThrow();
    expect(() => parseStoredProjectImport(JSON.stringify({}))).toThrow();
    const bad = { ...stored, profile: undefined, project: { ...stored.project, name: "" } };
    expect(() => parseStoredProjectImport(JSON.stringify(bad))).toThrow();
  });
  it("seeds stay isolated", () => {
    const e = seedEnrichmentProject();
    expect(e.id).not.toBe(seedAcquisitionProject().id);
    expect(e.operations.map((o) => o.route)).toEqual(["/leads/{leadId}"]);
  });
});
