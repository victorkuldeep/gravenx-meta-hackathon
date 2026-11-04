import { describe, expect, it } from "vitest";
import { parseStatements } from "./dsl";
import { SEQUENCE_SAMPLES } from "./samples";

describe("sequence starter samples", () => {
  for (const s of SEQUENCE_SAMPLES) {
    it(`parses cleanly: ${s.name}`, () => {
      const r = parseStatements(s.dsl);
      expect(r.errors).toEqual([]);
      expect(r.participants.length).toBeGreaterThan(0);
      expect(r.nodes.length).toBeGreaterThan(0);
    });
  }
});
