import { describe, it, expect } from "vitest";
import { stringifyPath, parsePath, resolvePath, parentPath } from "./path";
import { buildDocument, getNode, subtreeValue, ancestorIds, previewValue } from "./document";

describe("paths", () => {
  it("stringifies canonical paths with escaping", () => {
    expect(stringifyPath([])).toBe("$");
    expect(stringifyPath(["a", 0, "b"])).toBe("$.a[0].b");
    expect(stringifyPath(["weird key", "a.b"])).toBe('$["weird key"]["a.b"]');
  });
  it("round-trips parse(stringify(p))", () => {
    const cases: (string | number)[][] = [
      [],
      ["a"],
      ["a", 0, "b"],
      ["weird key", "a.b", 12, 'q"q'],
    ];
    for (const p of cases) expect(parsePath(stringifyPath(p))).toEqual(p);
  });
  it("rejects garbage", () => {
    expect(() => parsePath("a.b")).toThrow();
    expect(() => parsePath("$.a[")).toThrow();
  });
  it("resolves values without throwing", () => {
    const v = { a: [{ b: 1 }] };
    expect(resolvePath(v, ["a", 0, "b"])).toEqual({ found: true, value: 1 });
    expect(resolvePath(v, ["a", 5])).toEqual({ found: false, value: undefined });
    expect(resolvePath(v, ["x"])).toEqual({ found: false, value: undefined });
    expect(resolvePath(null, ["a"]).found).toBe(false);
  });
  it("parentPath drops the last segment", () => {
    expect(parentPath(["a", 0])).toEqual(["a"]);
    expect(parentPath([])).toEqual([]);
  });
});

describe("document model", () => {
  const composite = {
    allOrNone: true,
    compositeRequest: [
      { method: "POST", referenceId: "a", body: { Status__c: "New", Id: "001" } },
      { method: "POST", referenceId: "b", body: { Status__c: "New", Id: "002" } },
    ],
  };

  it("builds typed nodes with stable path identity", () => {
    const doc = buildDocument(composite);
    expect(doc.rootId).toBe("$");
    expect(getNode(doc, "$.allOrNone")?.type).toBe("boolean");
    expect(getNode(doc, "$.compositeRequest")?.type).toBe("array");
    expect(getNode(doc, "$.compositeRequest[0].body.Status__c")?.type).toBe("string");
  });
  it("keeps repeated names distinct by path", () => {
    const doc = buildDocument(composite);
    const a = getNode(doc, "$.compositeRequest[0].body.Id");
    const b = getNode(doc, "$.compositeRequest[1].body.Id");
    expect(a?.id).not.toBe(b?.id);
    expect(a?.value).toBe("001");
    expect(b?.value).toBe("002");
  });
  it("preserves document order and depth", () => {
    const doc = buildDocument(composite);
    const root = getNode(doc, "$");
    expect(root?.children).toEqual(["$.allOrNone", "$.compositeRequest"]);
    expect(getNode(doc, "$.compositeRequest[1].body.Status__c")?.depth).toBe(4);
    expect(getNode(doc, "$.compositeRequest")?.children).toEqual([
      "$.compositeRequest[0]",
      "$.compositeRequest[1]",
    ]);
  });
  it("extracts exact subtrees and ancestor chains", () => {
    const doc = buildDocument(composite);
    const sub = subtreeValue(doc, "$.compositeRequest[0].body");
    expect(sub).toEqual({ found: true, value: composite.compositeRequest[0].body });
    expect(subtreeValue(doc, "$.nope")).toEqual({ found: false, value: undefined });
    expect(ancestorIds(doc, "$.compositeRequest[0].body.Status__c")).toEqual([
      "$",
      "$.compositeRequest",
      "$.compositeRequest[0]",
      "$.compositeRequest[0].body",
    ]);
  });
  it("never confuses null, missing, empty object and empty array", () => {
    const doc = buildDocument({ n: null, o: {}, a: [] });
    expect(getNode(doc, "$.n")?.type).toBe("null");
    expect(getNode(doc, "$.o")?.type).toBe("object");
    expect(getNode(doc, "$.o")?.children).toEqual([]);
    expect(getNode(doc, "$.a")?.type).toBe("array");
    expect(getNode(doc, "$.missing")).toBeUndefined();
  });
  it("handles root primitives, arrays and deep nesting iteratively", () => {
    expect(getNode(buildDocument("hi"), "$")?.type).toBe("string");
    expect(getNode(buildDocument([1]), "$[0]")?.value).toBe(1);
    expect(getNode(buildDocument(null), "$")?.type).toBe("null");
    let deep: unknown = 0;
    for (let i = 0; i < 1500; i++) deep = { nest: deep };
    const doc = buildDocument(deep);
    expect(doc.size).toBe(1501);
  });
  it("previews without dumping", () => {
    const doc = buildDocument(composite);
    const leaf = getNode(doc, "$.compositeRequest[0].referenceId");
    expect(leaf && previewValue(leaf)).toBe("a");
    const arr = getNode(doc, "$.compositeRequest");
    expect(arr && previewValue(arr)).toMatch(/Array · 2 items/);
  });
});
