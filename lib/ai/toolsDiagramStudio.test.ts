import { describe, expect, it } from "vitest";
import { skillForPath } from "./skills";
import { DIAGRAM_STUDIO_TOOLS } from "./toolsDiagramStudio";
import { toolsForSkill } from "./toolsSystem";

function tool(name: string) {
  return DIAGRAM_STUDIO_TOOLS.find((t) => t.name === name)!;
}

async function run(name: string, args: unknown = {}) {
  const t = tool(name);
  const parsed = t.schema.safeParse(args);
  if (!parsed.success) throw new Error(`bad test args for ${name}`);
  return t.execute(parsed.data);
}

describe("diagram-studio skill + tool set", () => {
  it("routes /studio to the diagram-studio pack with 5 tools", () => {
    expect(skillForPath("/studio").name).toBe("diagram-studio");
    expect(toolsForSkill("diagram-studio")).toHaveLength(8);
    expect(DIAGRAM_STUDIO_TOOLS.every((t) => t.name.startsWith("dstudio_") || t.name.startsWith("sketch_"))).toBe(true);
  });

  it("reads report an empty browser store gracefully", async () => {
    const l = await run("dstudio_list");
    expect(l.ok).toBe(true);
    const i = await run("dstudio_inventory");
    expect(i.ok).toBe(true);
    const d = await run("dstudio_describe", { pack: "nope" });
    expect(d.ok).toBe(false);
    expect(d.error).toMatch(/No studio pack/);
  });

  it("compose rejects unknown themes before touching inventory", async () => {
    const r = await run("dstudio_compose", { name: "X", theme: "neon", items: [{ kind: "sequence", name: "Y" }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/premium-light/);
  });

  it("compose reports unmatched canvas names honestly", async () => {
    const r = await run("dstudio_compose", { name: "X", items: [{ kind: "sequence", name: "Does Not Exist" }] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unmatched canvases/);
  });

  it("theme switch rejects unknown themes and missing packs", async () => {
    const t = await run("dstudio_theme", { pack: "X", theme: "neon" });
    expect(t.ok).toBe(false);
    const m = await run("dstudio_theme", { pack: "missing-pack", theme: "ink" });
    expect(m.ok).toBe(false);
    expect(m.error).toMatch(/No studio pack/);
  });

  it("mutations wait for Apply, reads run free", () => {
    const needs = Object.fromEntries(DIAGRAM_STUDIO_TOOLS.map((t) => [t.name, t.needsApproval]));
    expect(needs).toMatchObject({
      dstudio_list: false,
      dstudio_inventory: false,
      dstudio_describe: false,
      dstudio_compose: true,
      dstudio_theme: true,
    });
  });
});
