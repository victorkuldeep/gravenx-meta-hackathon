import { describe, expect, it } from "vitest";
import { DOC_GROUPS, DOC_SECTIONS } from "./content";

describe("docs content", () => {
  it("uses known groups, unique ids, and non-empty blocks", () => {
    const ids = new Set<string>();
    expect(DOC_SECTIONS.length).toBeGreaterThan(10);
    for (const s of DOC_SECTIONS) {
      expect(DOC_GROUPS as readonly string[]).toContain(s.group);
      expect(s.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(s.id), s.id).toBe(false);
      ids.add(s.id);
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.blocks.length).toBeGreaterThan(0);
    }
  });

  it("covers every studio tab", () => {
    const text = DOC_SECTIONS.map((s) => `${s.title} ${s.keywords}`.toLowerCase()).join("\n");
    for (const tab of ["system", "wireframe", "sequence", "draw", "json", "mapping", "validate", "contracts", "architect", "soql", "sosl", "erd", "studio"]) {
      expect(text, tab).toContain(tab);
    }
  });
});
