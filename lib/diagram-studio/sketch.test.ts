import { describe, expect, it } from "vitest";
import {
  bestSides,
  blankSketch,
  blankSketchNode,
  handleId,
  sketchToSystemProject,
  type StudioSketch,
} from "./sketch";

function sketch(): StudioSketch {
  const s = blankSketch("Order flow");
  const sf = { ...blankSketchNode("system", { x: 80, y: 260 }), id: "n1", label: "Salesforce", systemType: "salesforce" as const };
  const mw = { ...blankSketchNode("system", { x: 520, y: 260 }), id: "n2", label: "Middleware Hub", systemType: "middleware" as const };
  const gate = { ...blankSketchNode("decision", { x: 520, y: 80 }), id: "n3", label: "Serviceable?" };
  s.nodes = [sf, mw, gate];
  s.edges = [
    { id: "e1", sourceId: "n1", targetId: "n2", label: "Create Order" },
    { id: "e2", sourceId: "n2", targetId: "n3", label: "Check" },
  ];
  return s;
}

describe("blankSketch", () => {
  it("starts empty with a fallback name", () => {
    expect(blankSketch("  ").name).toBe("Untitled sketch");
    expect(blankSketch("X").nodes).toEqual([]);
  });

  it("defaults to hybrid and honors explicit flavors", () => {
    expect(blankSketch("X").flavor).toBe("hybrid");
    expect(blankSketch("X", "flow").flavor).toBe("flow");
    expect(blankSketch("X", "system").flavor).toBe("system");
  });
});

describe("connector dots", () => {
  it("names handles per box kind", () => {
    expect(handleId("system", "right", "source")).toBe("sys-right-source");
    expect(handleId("note", "top", "target")).toBe("note-top-target");
    expect(handleId("decision", "left", "source")).toBe("dec-left-source");
  });

  it("picks facing sides from box positions", () => {
    expect(bestSides({ x: 0, y: 0 }, { x: 400, y: 20 })).toEqual({ from: "right", to: "left" });
    expect(bestSides({ x: 400, y: 0 }, { x: 0, y: 20 })).toEqual({ from: "left", to: "right" });
    expect(bestSides({ x: 0, y: 0 }, { x: 20, y: 400 })).toEqual({ from: "bottom", to: "top" });
  });
});

describe("sketchToSystemProject", () => {
  it("promotes system boxes with positions and names", () => {
    const { project, systems } = sketchToSystemProject(sketch());
    expect(systems).toBe(2);
    expect(project.systems.map((s) => s.name).sort()).toEqual(["Middleware Hub", "Salesforce"]);
    const sf = project.systems.find((s) => s.name === "Salesforce")!;
    expect(sf.position).toEqual({ x: 80, y: 260 });
    expect(sf.systemType).toBe("salesforce");
  });

  it("keeps labeled system links as draft connections", () => {
    const { project, links } = sketchToSystemProject(sketch());
    expect(links).toBe(1);
    expect(project.connections).toHaveLength(1);
    expect(project.connections[0]).toMatchObject({ label: "Create Order", status: "draft" });
  });

  it("carries flow shapes into notes and counts touched edges honestly", () => {
    const { project, notedEdges } = sketchToSystemProject(sketch());
    expect(notedEdges).toBe(1);
    expect(project.canvasNotes.map((n) => n.text)).toContain("[Decision] Serviceable?");
    expect(project.notes).toMatch(/1 sketch link\(s\) touched/);
  });

  it("promotes an empty sketch into an empty project without crashing", () => {
    const { project, systems, links } = sketchToSystemProject(blankSketch("Empty"));
    expect(systems).toBe(0);
    expect(links).toBe(0);
    expect(project.systems).toEqual([]);
  });
});
