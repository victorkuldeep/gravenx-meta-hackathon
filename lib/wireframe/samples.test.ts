import { describe, expect, it } from "vitest";
import { ExperienceSchema } from "./model";
import { WIREFRAME_SAMPLES } from "./samples";

describe("wireframe starter samples", () => {
  for (const s of WIREFRAME_SAMPLES) {
    it(`builds a valid experience: ${s.name}`, () => {
      const exp = s.build();
      expect(exp.name).toBe(s.name);
      expect(ExperienceSchema.safeParse(exp).success).toBe(true);
      expect(exp.screens.length).toBeGreaterThan(0);
      expect(exp.components.length).toBeGreaterThan(0);
    });
  }
});
