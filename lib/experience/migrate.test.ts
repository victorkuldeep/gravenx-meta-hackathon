import { describe, expect, it } from "vitest";
import { blankProject } from "../mapping/types";
import { blankStudio } from "../studio/types";
import { ensureExperience, logChange } from "./migrate";

describe("experience migration", () => {
  it("leaves pre-experience projects loadable without an experience module", () => {
    const p = blankProject({ id: "p1", name: "Old", now: "2026-01-01" });
    delete (p as Partial<typeof p>).schemaVersion;
    expect(p.experience).toBeUndefined();
    // All integration arrays still intact.
    expect(p.mappings).toEqual([]);
    expect(p.recordPlans).toEqual([]);
  });

  it("materializes empty modules on first open, idempotently", () => {
    const p = blankProject({ id: "p1", name: "Old", now: "2026-01-01" });
    delete (p as Partial<typeof p>).schemaVersion;
    ensureExperience(p, "2026-02-01");
    expect(p.experience?.screens).toEqual([]);
    expect(p.apiCatalog?.operations).toEqual([]);
    expect(p.experienceSnapshots).toEqual([]);
    const expId = p.experience!.id;
    ensureExperience(p, "2026-02-02");
    expect(p.experience!.id).toBe(expId); // stable, not regenerated
  });

  it("works on a workspace root too (shared scope)", () => {
    const ws = blankStudio({ id: "w1", name: "Accenture", now: "2026-01-01" });
    ensureExperience(ws, "2026-02-01");
    expect(ws.experience?.screens).toEqual([]);
    expect(ws.apiCatalog?.operations).toEqual([]);
  });

  it("logChange appends manual entries", () => {
    const p = blankProject({ id: "p1", name: "N", now: "2026-01-01" });
    logChange(p, "screen", "s1", "created", "Screen added.", "2026-01-02");
    expect(p.changeLog).toHaveLength(1);
    expect(p.changeLog![0].entityId).toBe("s1");
  });
});
