import { describe, expect, it } from "vitest";
import { rankByQuery, rankScore } from "./rank";

const names = (items: { name: string }[]) => items.map((i) => i.name);

describe("rankScore", () => {
  it("ranks an exact name hit above prefix and substring hits", () => {
    expect(rankScore("order", "Order")).toBeGreaterThan(rankScore("order", "OrderItem"));
    expect(rankScore("order", "OrderItem")).toBeGreaterThan(rankScore("order", "AssessmentTaskOrder"));
  });

  it("matches case-insensitively across name and label", () => {
    expect(rankScore("ORDER", "Order")).toBe(100);
    expect(rankScore("order", "Order", "Order")).toBe(100);
    expect(rankScore("account", "Account", "Account")).toBe(100);
  });

  it("returns 0 for non-matches and blank queries", () => {
    expect(rankScore("order", "Account")).toBe(0);
    expect(rankScore("  ", "Order")).toBe(0);
  });
});

describe("rankByQuery", () => {
  const objects = [
    { name: "AssessmentTaskOrder", label: "Assessment Task Order" },
    { name: "OrderItem", label: "Order Item" },
    { name: "Order", label: "Order" },
    { name: "PurchaseOrder__c", label: "Purchase Order" },
    { name: "Account", label: "Account" },
  ];

  it("puts the exact Order match first, not alphabetically first", () => {
    expect(names(rankByQuery(objects, "order"))).toEqual(["Order", "OrderItem", "PurchaseOrder__c", "AssessmentTaskOrder"]);
  });

  it("drops non-matches and keeps input order on empty query", () => {
    expect(names(rankByQuery(objects, "zzz"))).toEqual([]);
    expect(names(rankByQuery(objects, "  "))).toEqual(names(objects));
  });

  it("prefers token-boundary hits over mid-word substrings", () => {
    const items = [{ name: "ReorderPoint__c" }, { name: "Sales_Order__c" }];
    expect(names(rankByQuery(items, "order"))).toEqual(["Sales_Order__c", "ReorderPoint__c"]);
  });
});
