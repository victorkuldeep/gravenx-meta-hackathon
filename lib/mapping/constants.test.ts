import { describe, expect, it } from "vitest";
import { freeConstants, mapLeafToConstant, upsertConstant } from "./constants";
import { FREE_SOURCE_PATH, type MappingRow } from "./types";

function row(over: Partial<MappingRow> & { id: string }): MappingRow {
  return {
    sourcePath: "order.id",
    planId: null,
    objectName: "Order",
    fieldName: "Id",
    kind: "direct",
    status: "mapped",
    updatedAt: "t",
    ...over,
  };
}

const OPTS = { planId: null as string | null, uid: () => "new-id", now: "now" };

describe("freeConstants", () => {
  it("returns only free rows", () => {
    const mappings = [row({ id: "a" }), row({ id: "b", sourcePath: FREE_SOURCE_PATH })];
    expect(freeConstants(mappings).map((m) => m.id)).toEqual(["b"]);
  });
});

describe("upsertConstant", () => {
  it("creates a labelled hardcoded free row", () => {
    const next = upsertConstant([], { label: "PRODUCT ORDER", value: "ProductOrder" }, OPTS);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      sourcePath: FREE_SOURCE_PATH,
      kind: "hardcoded",
      status: "hardcoded",
      hardcodedValue: "ProductOrder",
      notes: "PRODUCT ORDER",
    });
  });

  it("falls back to the value when the label is blank", () => {
    const next = upsertConstant([], { label: "  ", value: "v" }, OPTS);
    expect(next[0].notes).toBe("v");
  });

  it("updates an existing constant in place", () => {
    const before = [row({ id: "c", sourcePath: FREE_SOURCE_PATH, hardcodedValue: "old", notes: "Old" })];
    const next = upsertConstant(before, { label: "New", value: "new" }, { ...OPTS, id: "c" });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ hardcodedValue: "new", notes: "New" });
  });
});

describe("mapLeafToConstant", () => {
  const constant = row({ id: "k", sourcePath: FREE_SOURCE_PATH, kind: "hardcoded", status: "hardcoded", hardcodedValue: "ProductOrder", notes: "PRODUCT ORDER", objectName: "", fieldName: "" });

  it("creates a hardcoded leaf row copying the constant", () => {
    const next = mapLeafToConstant([constant], "order.@type", "k", OPTS);
    expect(next).toHaveLength(2);
    expect(next[1]).toMatchObject({
      sourcePath: "order.@type",
      kind: "hardcoded",
      hardcodedValue: "ProductOrder",
      notes: "PRODUCT ORDER",
    });
  });

  it("retargets an already-mapped leaf", () => {
    const leaf = row({ id: "leaf", sourcePath: "order.@type" });
    const next = mapLeafToConstant([constant, leaf], "order.@type", "k", OPTS);
    expect(next).toHaveLength(2);
    expect(next.find((m) => m.id === "leaf")).toMatchObject({ kind: "hardcoded", hardcodedValue: "ProductOrder" });
  });

  it("ignores unknown constant ids", () => {
    expect(mapLeafToConstant([constant], "order.@type", "missing", OPTS)).toEqual([constant]);
  });
});
