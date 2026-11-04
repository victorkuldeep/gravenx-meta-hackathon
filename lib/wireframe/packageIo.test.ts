import { describe, expect, it } from "vitest";
import { newExperience } from "./model";
import { importExperiencePackage } from "./packageIo";

describe("importExperiencePackage", () => {
  it("round-trips an exported package with a fresh identity", () => {
    const exp = { ...newExperience("Shop"), screens: [], components: [] };
    const pkg = JSON.stringify({ kind: "gravenx-experience-package", packageVersion: 1, experience: exp });
    const r = importExperiencePackage(pkg);
    expect(r.ok).toBe(true);
    expect(r.experience?.name).toBe("Shop (imported)");
    expect(r.experience?.id).not.toBe(exp.id);
  });

  it("accepts a raw experience object", () => {
    const r = importExperiencePackage(JSON.stringify(newExperience("Raw")));
    expect(r.ok).toBe(true);
  });

  it("round-trips the shared builder through the importer", async () => {
    const { experiencePackage } = await import("./packageIo");
    const exp = newExperience("Round trip");
    const r = importExperiencePackage(JSON.stringify(experiencePackage(exp)));
    expect(r.ok).toBe(true);
    expect(r.experience?.name).toBe("Round trip (imported)");
  });

  it("rejects garbage", () => {
    expect(importExperiencePackage("nope").ok).toBe(false);
    expect(importExperiencePackage(JSON.stringify({ kind: "nope" })).ok).toBe(false);
    expect(importExperiencePackage(JSON.stringify({ experience: { name: 42 } })).ok).toBe(false);
  });
});
