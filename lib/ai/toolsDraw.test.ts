import { afterEach, describe, expect, it } from "vitest";
import {
  buildArrowSpec,
  buildShapeSpecs,
  buildTextSpec,
  registerDrawBridge,
  summarizeDrawElements,
  type DrawElementSpec,
  type DrawSnapshot,
} from "./drawBridge";
import { skillForPath } from "./skills";
import { DRAW_TOOLS } from "./toolsDraw";
import { toolsForSkill } from "./toolsSystem";

let appended: DrawElementSpec[][] = [];
let snapshot: DrawSnapshot | null = null;

function seed() {
  appended = [];
  snapshot = summarizeDrawElements(
    [
      { id: "a", type: "rectangle", x: 10, y: 20, width: 100, height: 50, isDeleted: false },
      { id: "b", type: "text", x: 10, y: 20, width: 100, height: 50, text: "Salesforce :443", isDeleted: false },
      { id: "gone", type: "ellipse", x: 0, y: 0, width: 1, height: 1, isDeleted: true },
    ],
    { centerX: 500, centerY: 300 },
  );
  registerDrawBridge({
    getSnapshot: () => snapshot,
    append: (specs) => {
      appended.push(specs);
      return { ok: true, added: specs.length };
    },
  });
}

afterEach(() => registerDrawBridge(null));

function tool(name: string) {
  return DRAW_TOOLS.find((t) => t.name === name)!;
}

async function run(name: string, args: unknown = {}) {
  const t = tool(name);
  const parsed = t.schema.safeParse(args);
  if (!parsed.success) throw new Error(`bad test args for ${name}`);
  return t.execute(parsed.data);
}

describe("draw skill + tool set", () => {
  it("routes /draw to a tooled draw pack", () => {
    expect(skillForPath("/draw").name).toBe("draw");
    expect(skillForPath("/draw").tooled).toBe(true);
    expect(toolsForSkill("draw")).toHaveLength(4);
    expect(toolsForSkill("draw").every((t) => t.name.startsWith("draw_"))).toBe(true);
  });

  it("reports absence outside the canvas", async () => {
    expect((await run("draw_describe")).ok).toBe(false);
    expect((await run("draw_add_shape", { shape: "rectangle", label: "X" })).ok).toBe(false);
  });

  it("marks mutates approval-gated and undoable", () => {
    expect(tool("draw_describe").needsApproval).toBe(false);
    for (const name of ["draw_add_shape", "draw_add_text", "draw_add_arrow"]) {
      expect(tool(name).needsApproval).toBe(true);
      expect(tool(name).undoable).toBe(true);
    }
  });
});

describe("draw reads", () => {
  it("censuses live elements, skips deleted, keeps text", async () => {
    seed();
    const d = await run("draw_describe");
    expect(d.ok).toBe(true);
    expect(d.result).toMatchObject({
      elementCount: 2,
      counts: { rectangle: 1, text: 1 },
      truncated: false,
      viewport: { centerX: 500, centerY: 300 },
    });
    const texts = (d.result as DrawSnapshot).elements.filter((e) => e.text);
    expect(texts.map((e) => e.text)).toEqual(["Salesforce :443"]);
  });
});

describe("draw placements", () => {
  it("places a labeled shape as a grouped box + text at the viewport cascade", async () => {
    seed();
    const r = await run("draw_add_shape", { shape: "rectangle", label: "Middleware :8080" });
    expect(r.ok).toBe(true);
    expect(appended).toHaveLength(1);
    expect(appended[0]).toHaveLength(2);
    const [box, text] = appended[0] as Record<string, unknown>[];
    expect(box.type).toBe("rectangle");
    expect(text).toMatchObject({ type: "text", text: "Middleware :8080" });
    // Same group, centered on the viewport with cascade offset for 2 elements.
    expect(box.groupIds).toEqual(text.groupIds);
    expect(box.x).toBe(500 + 64 - 120);
  });

  it("rejects unknown shapes without touching the board", async () => {
    seed();
    const r = await run("draw_add_shape", { shape: "triangle", label: "X" });
    expect(r.ok).toBe(false);
    expect(appended).toHaveLength(0);
  });

  it("places text notes and arrows", async () => {
    seed();
    expect((await run("draw_add_text", { text: "review TLS" })).ok).toBe(true);
    expect((await run("draw_add_arrow", {})).ok).toBe(true);
    expect(appended).toHaveLength(2);
    expect((appended[0][0] as Record<string, unknown>).type).toBe("text");
    const arrow = appended[1][0] as Record<string, unknown>;
    expect(arrow.type).toBe("arrow");
    expect(arrow.points).toEqual([
      [0, 0],
      [220, 0],
    ]);
  });
});

describe("draw spec builders", () => {
  it("builds diamond + arrow geometry honestly", () => {
    const [box] = buildShapeSpecs("diamond", "Queue", 0, 0);
    expect(box.type).toBe("diamond");
    expect(buildTextSpec("note", 10, 10).type).toBe("text");
    const arrow = buildArrowSpec(0, 0, -100, 50);
    expect(arrow.points).toEqual([
      [0, 0],
      [-100, 50],
    ]);
  });
});
