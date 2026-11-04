import { describe, expect, it } from "vitest";
import { graphKindLabel, graphNodeHref, GRAPH_SURFACE_LABELS } from "./links";

describe("graph jump links", () => {
  it("deep-links records by surface", () => {
    expect(graphNodeHref({ kind: "project", surface: "system", recordId: "p1" })).toBe("/system?project=p1");
    expect(graphNodeHref({ kind: "experience", surface: "wireframe", recordId: "e1" })).toBe("/wireframe?exp=e1");
    expect(graphNodeHref({ kind: "sequence", surface: "sequence", recordId: "q1" })).toBe("/sequence?id=q1");
    expect(graphNodeHref({ kind: "decision", surface: "decision", recordId: "d1" })).toBe("/decisions?id=d1");
    expect(graphNodeHref({ kind: "requirement", surface: "requirement", recordId: "r1" })).toBe(
      "/requirements?id=r1",
    );
    expect(graphNodeHref({ kind: "console-task", surface: "console", recordId: "t1" })).toBe("/console?task=t1");
    expect(graphNodeHref({ kind: "mapping-project", surface: "mapping", recordId: "mp1" })).toBe("/mapping?project=mp1");
    expect(graphNodeHref({ kind: "mapping-plan", surface: "mapping", recordId: "mp1" })).toBe("/mapping?project=mp1");
  });

  it("lands node-level rows on the surface root, stubs nowhere", () => {
    expect(graphNodeHref({ kind: "operation", surface: "system", recordId: "op1" })).toBe("/system");
    expect(graphNodeHref({ kind: "screen", surface: "wireframe", recordId: "sc1" })).toBe("/wireframe");
    expect(graphNodeHref({ kind: "system", surface: "system", recordId: "s1", stub: true })).toBeNull();
  });

  it("prefers remote URLs for external issues", () => {
    expect(
      graphNodeHref({ kind: "external-issue", surface: "console", url: "https://acme.atlassian.net/browse/X-1" }),
    ).toBe("https://acme.atlassian.net/browse/X-1");
  });

  it("labels kinds and surfaces for badges", () => {
    expect(graphKindLabel("decision")).toBe("ADR");
    expect(graphKindLabel("requirement")).toBe("REQ");
    expect(graphKindLabel("external-issue")).toBe("ticket");
    expect(GRAPH_SURFACE_LABELS.system).toBe("System");
  });
});
