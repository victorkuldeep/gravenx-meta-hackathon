import { afterEach, describe, expect, it } from "vitest";
import { blankSketch } from "@/lib/diagram-studio/sketch";
import { registerSketchBridge } from "./sketchBridge";
import { SKETCH_TOOLS } from "./toolsSketch";
import { skillForPath } from "./skills";
import { toolsForSkill } from "./toolsSystem";

let sketch = blankSketch("Shop");

function seed() {
  sketch = blankSketch("Shop");
  registerSketchBridge({
    getSnapshot: () => ({ id: sketch.id, name: sketch.name, systems: 0, flows: 0, notes: 0, links: 0 }),
    getSketch: () => sketch,
    apply: (fn) => {
      sketch = fn(sketch);
      return { ok: true };
    },
  });
}

afterEach(() => registerSketchBridge(null));

function tool(name: string) {
  return SKETCH_TOOLS.find((t) => t.name === name)!;
}

async function run(name: string, args: unknown = {}) {
  const t = tool(name);
  const parsed = t.schema.safeParse(args);
  if (!parsed.success) throw new Error(`bad test args for ${name}`);
  return t.execute(parsed.data);
}

describe("sketch skill wiring", () => {
  it("routes /studio to the diagram-studio pack with sketch tools", () => {
    expect(skillForPath("/studio").name).toBe("diagram-studio");
    for (const n of ["sketch_describe", "sketch_add", "sketch_connect"]) {
      expect(toolsForSkill("diagram-studio").some((t) => t.name === n), n).toBe(true);
    }
  });

  it("reports absence outside the canvas", async () => {
    expect((await run("sketch_describe")).ok).toBe(false);
    expect((await run("sketch_add", { kind: "system", label: "X" })).ok).toBe(false);
  });
});

describe("sketch_add", () => {
  it("places boxes the user can adjust by hand", async () => {
    seed();
    const r = await run("sketch_add", { kind: "system", label: "Middleware Hub", systemType: "middleware" });
    expect(r.ok).toBe(true);
    expect(sketch.nodes).toHaveLength(1);
    expect(sketch.nodes[0]).toMatchObject({ kind: "system", label: "Middleware Hub", systemType: "middleware" });
  });
});

describe("sketch_connect", () => {
  it("links boxes matched by label", async () => {
    seed();
    await run("sketch_add", { kind: "system", label: "Salesforce" });
    await run("sketch_add", { kind: "system", label: "Middleware" });
    const r = await run("sketch_connect", { from: "salesforce", to: "Middleware", label: "Create Order" });
    expect(r.ok).toBe(true);
    expect(sketch.edges).toHaveLength(1);
    expect(sketch.edges[0].label).toBe("Create Order");
  });

  it("refuses unknown boxes honestly instead of guessing", async () => {
    seed();
    const r = await run("sketch_connect", { from: "Salesforce", to: "Atlantis" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Atlantis/);
    expect(sketch.edges).toHaveLength(0);
  });

  it("refuses self-links", async () => {
    seed();
    await run("sketch_add", { kind: "note", label: "Solo" });
    const r = await run("sketch_connect", { from: "Solo", to: "solo" });
    expect(r.ok).toBe(false);
  });
});
