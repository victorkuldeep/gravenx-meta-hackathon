import { describe, it, expect } from "vitest";
import { parseJsonInput, formatBytes, formatJson, detectArrayMatchKey, diffTableTsv } from "./studio";
import { compareDocuments } from "./compare";

describe("parseJsonInput", () => {
  it("parses valid JSON", () => {
    const r = parseJsonInput('{"a": 1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });
  it("rejects empty input", () => {
    const r = parseJsonInput("   ");
    expect(r.ok).toBe(false);
  });
  it("reports syntax errors readably", () => {
    const r = parseJsonInput('{\n"a": }');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not valid JSON|line 2/);
  });
});

describe("formatBytes", () => {
  it("formats B/KB/MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
  });
});

describe("formatJson", () => {
  it("pretty-prints with 2-space indent", () => {
    expect(formatJson({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}');
  });
});

describe("detectArrayMatchKey", () => {
  it("detects a shared unique id field", () => {
    const a = { order: [{ id: "1", mrc: 100 }, { id: "2", mrc: 200 }] };
    const b = { order: [{ id: "1", mrc: 100 }, { id: "2", mrc: 300 }] };
    expect(detectArrayMatchKey(a, b)).toBe("id");
  });
  it("lowercase id wins over Salesforce Id and referenceId", () => {
    const doc = {
      items: [
        { id: "a", Id: "x1", referenceId: "r1" },
        { id: "b", Id: "x2", referenceId: "r2" },
      ],
    };
    expect(detectArrayMatchKey(doc, doc)).toBe("id");
  });
  it("falls back to referenceId when no plain id exists", () => {
    const doc = { req: [{ referenceId: "r1", v: 1 }, { referenceId: "r2", v: 2 }] };
    expect(detectArrayMatchKey(doc, doc)).toBe("referenceId");
  });
  it("rejects non-unique keys and single-item arrays", () => {
    expect(detectArrayMatchKey({ items: [{ id: "1" }, { id: "1" }] }, {})).toBe("");
    expect(detectArrayMatchKey({ items: [{ id: "1" }] }, {})).toBe("");
  });
  it("finds usable keys nested deep in the document", () => {
    const doc = { order: { lines: [{ id: "l1" }, { id: "l2" }] } };
    expect(detectArrayMatchKey({}, doc)).toBe("id");
  });
  it("returns empty when nothing qualifies", () => {
    expect(detectArrayMatchKey({ a: 1 }, { b: [1, 2, 3] })).toBe("");
    expect(detectArrayMatchKey({}, {})).toBe("");
  });
});


describe("diffTableTsv", () => {
  const rows = (a: unknown, b: unknown) =>
    compareDocuments(a, b, { arrayMode: "lcs" }).findings.filter((f) =>
      ["added", "removed", "modified"].includes(f.category)
    );

  it("renders Node, Value in A, Value in B with a header", () => {
    const tsv = diffTableTsv(rows({ mrc: 100 }, { mrc: 200 }));
    const lines = tsv.split("\n");
    expect(lines[0]).toBe("Node\tValue in A\tValue in B");
    expect(lines).toContain("$.mrc\t100\t200");
  });
  it("shows null for the absent side", () => {
    expect(diffTableTsv(rows({ a: 1 }, {}))).toContain("$.a\t1\tnull");
    expect(diffTableTsv(rows({}, { b: "x" }))).toContain("$.b\tnull\tx");
  });
  it("quotes cells containing tabs, newlines and quotes", () => {
    const tsv = diffTableTsv(rows({ s: "a\tb" }, { s: 'say "hi"\nbye' }));
    expect(tsv).toContain('$.s\t"a\tb"\t"say ""hi""\nbye"');
  });
});
