import { describe, it, expect } from "vitest";
import { compareDocuments } from "./compare";

const cats = (r: ReturnType<typeof compareDocuments>) =>
  r.findings.map((f) => f.category);

describe("compare engine", () => {
  it("identical objects yield no findings", () => {
    const r = compareDocuments({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 });
    expect(r.findings).toHaveLength(0);
  });
  it("added / removed properties", () => {
    const r = compareDocuments({ a: 1 }, { a: 1, b: 2 });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ category: "added", pathB: "$.b", parent: "$" });
    const r2 = compareDocuments({ a: 1, b: 2 }, { a: 1 });
    expect(r2.findings[0]).toMatchObject({ category: "removed", pathA: "$.b" });
  });
  it("changed string / number / boolean", () => {
    const r = compareDocuments(
      { s: "a", n: 1, b: true },
      { s: "b", n: 2, b: false }
    );
    expect(r.findings).toHaveLength(3);
    expect(r.findings.every((f) => f.category === "modified")).toBe(true);
    expect(r.findings[0].explanation).toMatch(/\$\.s changed from "a" to "b"/);
  });
  it("type change beats value change", () => {
    const r = compareDocuments({ v: 1 }, { v: "1" });
    expect(r.findings[0]).toMatchObject({ category: "type-changed", oldType: "number", newType: "string" });
  });
  it("null versus missing, empty versus missing", () => {
    const r1 = compareDocuments({}, { v: null });
    expect(r1.findings[0].category).toBe("added");
    const r2 = compareDocuments({ v: null }, {});
    expect(r2.findings[0].category).toBe("removed");
    const r3 = compareDocuments({ v: null }, { v: 1 });
    expect(r3.findings[0].category).toBe("modified");
    const r4 = compareDocuments({}, { o: {} });
    expect(r4.findings[0]).toMatchObject({ category: "added", newType: "object" });
    const r5 = compareDocuments({}, { a: [] });
    expect(r5.findings[0]).toMatchObject({ category: "added", newType: "array" });
  });
  it("nested property change carries parent context", () => {
    const r = compareDocuments({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({
      category: "modified",
      pathA: "$.a.b.c",
      pathB: "$.a.b.c",
      parent: "$.a.b",
    });
  });
  it("index arrays: add/remove/modify by position", () => {
    const r = compareDocuments({ l: [1, 2, 3] }, { l: [1, 9] });
    expect(cats(r)).toContain("array-removed");
    expect(cats(r)).toContain("array-modified");
    expect(r.findings.find((f) => f.category === "array-removed")?.pathA).toBe("$.l[2]");
  });
  it("LCS arrays align content over position", () => {
    const r = compareDocuments(
      { l: ["a", "b", "c"] },
      { l: ["b", "c", "d"] },
      { arrayMode: "lcs" }
    );
    // "a" removed, "d" added, b/c pair clean.
    expect(r.findings.filter((f) => f.category === "array-removed")).toHaveLength(1);
    expect(r.findings.filter((f) => f.category === "array-added")).toHaveLength(1);
    expect(r.findings.some((f) => f.category === "array-modified")).toBe(false);
  });
  it("key matching tracks referenceId across reorder without content findings", () => {
    const a = { compositeRequest: [{ referenceId: "x", v: 1 }, { referenceId: "y", v: 2 }] };
    const b = { compositeRequest: [{ referenceId: "y", v: 2 }, { referenceId: "x", v: 1 }] };
    const r = compareDocuments(a, b, { arrayMode: "key", matchKey: "referenceId" });
    expect(r.findings.filter((f) => f.category === "structural").length).toBe(2);
    expect(r.findings.some((f) => ["modified", "array-modified"].includes(f.category))).toBe(false);
  });
  it("key matching compares matched content and flags missing keys", () => {
    const a = { items: [{ id: "1", v: "a" }, { id: "2", v: "b" }] };
    const b = { items: [{ id: "2", v: "B" }, { id: "3", v: "c" }] };
    const r = compareDocuments(a, b, { arrayMode: "key", matchKey: "id" });
    expect(r.findings.some((f) => f.category === "array-modified")).toBe(true);
    expect(r.findings.some((f) => f.category === "modified" && f.pathB === "$.items[0].v")).toBe(true);
    expect(
      r.findings.some((f) => f.category === "unmatched" && f.matchStatus === "unmatched-a")
    ).toBe(true);
    expect(
      r.findings.some((f) => f.category === "unmatched" && f.matchStatus === "unmatched-b")
    ).toBe(true);
  });
  it("duplicate match keys are reported, never silently matched", () => {
    const a = { items: [{ id: "1", v: "a" }] };
    const b = { items: [{ id: "1", v: "a" }, { id: "1", v: "b" }] };
    const r = compareDocuments(a, b, { arrayMode: "key", matchKey: "id" });
    expect(r.findings.some((f) => f.category === "duplicate-key")).toBe(true);
  });
  it("key mode ignores arrays that carry no usable key (falls back to lcs/index)", () => {
    // Identical keyless arrays: no findings at all, not an "unmatched" flood.
    const r = compareDocuments({ items: [{ v: 1 }] }, { items: [{ v: 1 }] }, { arrayMode: "key", matchKey: "id" });
    expect(r.findings.some((f) => f.category === "unmatched")).toBe(false);
    expect(r.findings).toHaveLength(0);
    // Changed keyless arrays surface per-field edits, not remove+add.
    const r2 = compareDocuments({ items: [{ v: 1 }] }, { items: [{ v: 2 }] }, { arrayMode: "key", matchKey: "id" });
    expect(r2.findings.some((f) => f.category === "modified" && f.pathA === "$.items[0].v")).toBe(true);
    expect(r2.findings.some((f) => ["array-added", "array-removed"].includes(f.category))).toBe(false);
  });
  it("key matching recurses into a matched item instead of flattening it", () => {
    const a = { items: [{ id: "1", name: "x", tags: [{ v: 1 }, { v: 2 }] }] };
    const b = { items: [{ id: "1", name: "y", tags: [{ v: 1 }, { v: 2 }] }] };
    const r = compareDocuments(a, b, { arrayMode: "key", matchKey: "id" });
    expect(r.findings.some((f) => f.category === "modified" && f.pathA === "$.items[0].name")).toBe(true);
    expect(r.findings.some((f) => ["array-added", "array-removed", "unmatched"].includes(f.category))).toBe(false);
  });
  it("one global key drives keyed arrays and falls back on keyless nested ones", () => {
    const a = {
      order: [
        { id: "1", mrc: 100, chars: [{ k: "color", v: "red" }] },
        { id: "2", mrc: 50, chars: [{ k: "size", v: "m" }] },
      ],
    };
    const b = {
      order: [
        { id: "1", mrc: 200, chars: [{ k: "color", v: "blue" }] },
        { id: "2", mrc: 50, chars: [{ k: "size", v: "m" }] },
      ],
    };
    const r = compareDocuments(a, b, { arrayMode: "key", matchKey: "id" });
    // Top array matched by id: per-leaf modifications, no wholesale add/remove.
    expect(r.findings.some((f) => f.category === "modified" && f.pathA === "$.order[0].mrc")).toBe(true);
    // Nested keyless array compared by position: its real edit also surfaces.
    expect(r.findings.some((f) => f.category === "modified" && f.pathA === "$.order[0].chars[0].v")).toBe(true);
    expect(r.findings.some((f) => ["array-added", "array-removed", "unmatched"].includes(f.category))).toBe(false);
  });
  it("an item without the key is unmatched with a warning when the array uses the key elsewhere", () => {
    const r = compareDocuments(
      { items: [{ id: "1", v: 1 }, { v: 2 }] },
      { items: [{ id: "1", v: 1 }] },
      { arrayMode: "key", matchKey: "id" }
    );
    expect(r.findings.some((f) => f.category === "unmatched" && f.matchStatus === "unmatched-a")).toBe(true);
    expect(r.warnings.some((w) => w.includes('"id"'))).toBe(true);
  });
  it("nested arrays recurse", () => {
    const r = compareDocuments({ m: [[1, 2]] }, { m: [[1, 3]] });
    expect(r.findings.some((f) => f.pathA === "$.m[0][1]" && f.category === "modified")).toBe(true);
  });
  it("ignored paths (incl. subtrees) vanish; bad patterns warn loudly", () => {
    const a = { keep: 1, skip: { deep: 2 } };
    const b = { keep: 9, skip: { deep: 3 } };
    const r = compareDocuments(a, b, { ignorePaths: ["$.skip", "nope"] });
    expect(r.findings.map((f) => f.pathA)).toEqual(["$.keep"]);
    expect(r.warnings.some((w) => w.includes("nope"))).toBe(true);
    expect(r.config.ignorePaths).toEqual(["$.skip"]);
  });
  it("strategies: strict vs loose vs type-aware", () => {
    const s = compareDocuments({ v: 1 }, { v: "1" }, { strategy: "strict" });
    expect(s.findings[0].category).toBe("type-changed");
    const l = compareDocuments({ v: 1 }, { v: "1" }, { strategy: "loose" });
    expect(l.findings).toHaveLength(0);
    const t = compareDocuments({ v: 1 }, { v: "1" }, { strategy: "type-aware" });
    expect(t.findings).toHaveLength(0);
    const t2 = compareDocuments({ v: 1 }, { v: "2" }, { strategy: "type-aware" });
    // Values differ AND types differ - type-changed carries both facts.
    expect(t2.findings[0]).toMatchObject({ category: "type-changed", oldValue: 1, newValue: "2" });
  });
  it("root type mismatch is one structural finding", () => {
    const r = compareDocuments({ a: 1 }, [1]);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].category).toBe("structural");
  });
  it("counts agree with findings; ids are stable and ordered", () => {
    const r = compareDocuments({ a: 1, b: 2, c: 3 }, { a: 1, b: 9 });
    expect(r.counts.modified).toBe(1);
    expect(r.counts.removed).toBe(1);
    expect(r.findings.map((f) => f.id)).toEqual(["f1", "f2"]);
    const again = compareDocuments({ a: 1, b: 2, c: 3 }, { a: 1, b: 9 });
    expect(JSON.stringify(again.findings)).toBe(JSON.stringify(r.findings));
  });
  it("special keys stay unambiguous", () => {
    const r = compareDocuments({ "a.b": 1 }, { "a.b": 2 });
    expect(r.findings[0].pathA).toBe('$["a.b"]');
  });
});
