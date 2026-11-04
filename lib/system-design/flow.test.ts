import { describe, expect, it } from "vitest";
import { toFlowEdges, toFlowNodes } from "./flow";
import { buildRetryFallbackProject } from "./demo";

/**
 * Adapter contract: the shared flow projection must stay a faithful,
 * stable function of the project - Diagram Studio renders off it, so any
 * drift here breaks studio previews and PNG sets without touching System.
 */
describe("flowRender projection contract", () => {
  it("maps every system to a positioned node with a stable id", () => {
    const project = buildRetryFallbackProject();
    const nodes = toFlowNodes(project);
    expect(nodes.map((n) => n.id).sort()).toEqual(project.systems.map((s) => s.id).sort());
    for (const n of nodes) {
      expect(n.type).toBe("system");
      expect(n.position.x).toBeGreaterThanOrEqual(0);
    }
  });

  it("maps every connection to a labeled edge with arrow markers", () => {
    const project = buildRetryFallbackProject();
    const edges = toFlowEdges(project);
    expect(edges).toHaveLength(4);
    for (const e of edges) {
      expect(e.label).toBeTruthy();
      expect(e.markerEnd).toMatchObject({ type: "arrowclosed" });
    }
    const byId = new Map(edges.map((e) => [e.id, e]));
    expect(byId.get("conn_rf_1")).toMatchObject({ source: "sys_rf_sf", target: "sys_rf_mw" });
  });

  it("paints the fully-bound trigger edge ready and half-bound branches neutral", () => {
    const project = buildRetryFallbackProject();
    const byId = new Map(toFlowEdges(project).map((e) => [e.id, e]));
    expect(byId.get("conn_rf_1")!.style).toMatchObject({ stroke: "#32815B", strokeWidth: 2 });
    for (const id of ["conn_rf_2", "conn_rf_3", "conn_rf_4"]) {
      expect(byId.get(id)!.style).toMatchObject({ stroke: "#8A8070", strokeWidth: 1 });
    }
  });
});
