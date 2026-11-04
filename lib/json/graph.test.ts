import { describe, it, expect } from "vitest";
import { buildDocument } from "./document";
import { projectGraph, searchGraphModel } from "./graph";
import { stringifyPath } from "./path";

const docOf = (v: unknown) => buildDocument(v);

describe("projectGraph", () => {
  const doc = docOf({ a: { b: 1, c: [1, 2, 3] }, d: "x" });

  it("renders root + depth-1 by default, collapsed below", () => {
    const p = projectGraph(doc, { expanded: new Set() });
    const ids = p.nodes.map((n) => n.id);
    expect(ids).toContain("$");
    expect(ids).toContain("$.a");
    expect(ids).toContain("$.d");
    expect(ids).not.toContain("$.a.b");
    expect(p.truncated).toBe(false);
  });
  it("expands branches and reports hidden children", () => {
    const p = projectGraph(doc, { expanded: new Set(["$.a"]) });
    expect(p.nodes.map((n) => n.id)).toContain("$.a.b");
    const arr = projectGraph(docOf({ list: [1, 2, 3, 4, 5] }), {
      expanded: new Set(["$.list"]),
      childLimit: 2,
    });
    const node = arr.nodes.find((n) => n.id === "$.list");
    expect(node?.hiddenChildren).toBe(3);
    // Root edge + 2 windowed child edges.
    expect(arr.edges).toHaveLength(3);
  });
  it("caps runaway graphs explicitly", () => {
    const big = docOf({ items: Array.from({ length: 50 }, (_, i) => ({ id: i })) });
    const p = projectGraph(big, {
      expanded: new Set(["$.items", ...Array.from({ length: 50 }, (_, i) => `$.items[${i}]`)]),
      nodeLimit: 10,
    });
    expect(p.truncated).toBe(true);
    expect(p.visible).toBeLessThanOrEqual(10);
  });
  it("focus renders ancestors + full subtree", () => {
    const d = docOf({ a: { b: { c: 1 } }, z: 0 });
    const p = projectGraph(d, { expanded: new Set(["$.a", "$.a.b"]), focusId: "$.a.b.c" });
    const ids = p.nodes.map((n) => n.id);
    expect(ids).toContain("$.a.b.c");
    expect(ids).toContain("$.a");
    expect(ids).toContain("$");
    // Sibling subtree of an ancestor stays hidden.
    expect(ids).not.toContain("$.z");
  });
  it("applies tones without touching the document", () => {
    const before = doc.size;
    const p = projectGraph(doc, {
      expanded: new Set(["$.a"]),
      tones: new Map([["$.a.b", "modified"]]),
    });
    expect(p.nodes.find((n) => n.id === "$.a.b")?.tone).toBe("modified");
    expect(doc.size).toBe(before);
  });
  it("includeOnly renders kept nodes plus ancestors, never dangling edges", () => {
    const d = docOf({ a: { b: 1, c: 2 }, z: 0 });
    const p = projectGraph(d, {
      expanded: new Set(["$", "$.a"]),
      includeOnly: new Set(["$.a.b"]),
    });
    const ids = p.nodes.map((n) => n.id);
    expect(ids).toContain("$.a.b");
    expect(ids).toContain("$.a");
    expect(ids).toContain("$");
    expect(ids).not.toContain("$.a.c");
    expect(ids).not.toContain("$.z");
    for (const e of p.edges) {
      expect(ids).toContain(e.source);
      expect(ids).toContain(e.target);
    }
  });
});

describe("searchGraphModel", () => {
  const doc = docOf({
    compositeRequest: [
      { referenceId: "a", body: { Status__c: "New" } },
      { referenceId: "b", body: { Status__c: "Old" } },
    ],
  });

  it("searches keys, values and paths beyond the projection", () => {
    const hits = searchGraphModel(doc, "status__c", stringifyPath);
    expect(hits).toHaveLength(2);
    const vals = searchGraphModel(doc, "Old", stringifyPath);
    expect(vals).toHaveLength(1);
    expect(vals[0].path).toBe("$.compositeRequest[1].body.Status__c");
  });
  it("returns empty for blank queries", () => {
    expect(searchGraphModel(doc, "   ", stringifyPath)).toEqual([]);
  });
});
