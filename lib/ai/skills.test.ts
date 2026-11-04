import { describe, expect, it } from "vitest";
import { SKILL_PACKS, skillForPath, systemPromptFor } from "./skills";
import { toolsForSkill } from "./toolsSystem";

describe("skill routing", () => {
  it("matches longest route prefix with home fallback", () => {
    expect(skillForPath("/system").name).toBe("system");
    expect(skillForPath("/system/flows?x=1").name).toBe("system");
    expect(skillForPath("/json").name).toBe("json");
    expect(skillForPath("/wireframe").name).toBe("wireframe");
    expect(skillForPath("/knowledge").name).toBe("knowledge");
    expect(skillForPath("/knowledge").tooled).toBe(true);
    expect(skillForPath("/sequence").name).toBe("sequence");
    expect(skillForPath("/systemdesign").name).toBe("studio");
    expect(skillForPath("/").name).toBe("studio");
    expect(skillForPath("/unknown/deep").name).toBe("studio");
  });
});

describe("honest tool posture", () => {
  it("flags exactly the packs that ship tools", () => {
    for (const pack of SKILL_PACKS) {
      expect(toolsForSkill(pack.name).length > 0, pack.name).toBe(pack.tooled);
    }
  });

  it("tells advisor tabs there are no tools", () => {
    for (const pack of SKILL_PACKS.filter((p) => !p.tooled)) {
      const prompt = systemPromptFor(pack);
      expect(prompt, pack.name).toMatch(/no tools on this tab/);
      expect(prompt, pack.name).not.toMatch(/You have tools for this tab/);
    }
    for (const pack of SKILL_PACKS.filter((p) => p.tooled)) {
      expect(systemPromptFor(pack), pack.name).toMatch(/You have tools for this tab/);
    }
  });
});
