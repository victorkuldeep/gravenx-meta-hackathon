import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listSkills, readSkill } from "./skills";

const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills");

function readPack(name: string): { when: string; body: string } {
  const text = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) throw new Error(`${name}: missing frontmatter`);
  const d = m[1].match(/^description:\s*(.+)$/m);
  return { when: d ? d[1].trim() : "", body: m[2].trim() };
}

describe("skill packs", () => {
  it("lists every pack with guidance", () => {
    const skills = listSkills();
    expect(skills.map((s) => s.name).sort()).toEqual(
      ["activity", "builder", "contracts", "erd-live", "governance", "mapping", "notes", "pairing", "sequence", "system-import", "system-live", "wireframe"].sort()
    );
    for (const s of skills) expect(s.when.length).toBeGreaterThan(10);
  });

  it("reads packs case-insensitively and rejects unknown names", () => {
    expect(readSkill("Mapping")).toContain("mapping_add_rule");
    expect(readSkill("erd-live")).toContain("arch.activity");
    expect(() => readSkill("teleport")).toThrow(/Available/);
  });

  it("matches the canonical SKILL.md bundle (no drift)", () => {
    const dirs = readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(listSkills().map((s) => s.name).sort()).toEqual(dirs);
    for (const n of dirs) {
      const pack = readPack(n);
      expect(readSkill(n)).toBe(pack.body);
      expect(listSkills().find((s) => s.name === n)?.when).toBe(pack.when);
    }
  });
});
