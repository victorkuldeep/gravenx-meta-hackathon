import { describe, expect, it } from "vitest";
import { highlightIndexes, renderJsonLines } from "./jsonView";
import { extractPaths } from "./source";

const DOC = {
  order: { orderNumber: "A1", customer: { name: "Acme" } },
  lines: [{ sku: "x", qty: 2 }, { sku: "y", qty: 3 }],
};

describe("renderJsonLines", () => {
  it("emits catalog-identical path ids for every value line", () => {
    const { lines } = renderJsonLines(DOC);
    const viewerIds = new Set(lines.map((l) => l.pathId).filter((id): id is string => id !== null));
    const catalogIds = new Set(extractPaths(DOC).map((p) => p.id));
    // Every catalog id resolves to at least one viewer line.
    for (const id of catalogIds) {
      expect(viewerIds.has(id), `viewer covers ${id}`).toBe(true);
    }
  });

  it("shares one [] path across all array elements", () => {
    const { lines } = renderJsonLines(DOC);
    const skuLines = lines.filter((l) => l.pathId === "$.lines[].sku");
    expect(skuLines.length).toBe(2);
    expect(skuLines.every((l) => l.text.includes('"sku"'))).toBe(true);
  });

  it("caps output with a truncation flag", () => {
    const big = { items: Array.from({ length: 500 }, (_, i) => ({ id: i, name: `n${i}` })) };
    const { lines, truncated } = renderJsonLines(big, 100);
    expect(lines.length).toBeLessThanOrEqual(100);
    expect(truncated).toBe(true);
  });

  it("renders scalars and empty containers", () => {
    expect(renderJsonLines(null).lines.map((l) => l.text)).toEqual(["null"]);
    expect(renderJsonLines({ a: {}, b: [] }).lines.map((l) => l.text)).toEqual(["{", '  "a": {},', '  "b": []', "}"]);
  });
});

describe("highlightIndexes", () => {
  it("highlights exactly the selected path lines", () => {
    const { lines } = renderJsonLines(DOC);
    const hits = highlightIndexes(lines, "$.lines[].sku");
    expect(hits.size).toBe(2);
    expect(highlightIndexes(lines, null).size).toBe(0);
    expect(highlightIndexes(lines, "$.missing").size).toBe(0);
  });
});
