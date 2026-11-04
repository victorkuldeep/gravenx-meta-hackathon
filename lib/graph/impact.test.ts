import { describe, expect, it } from "vitest";
import { buildIndex } from "./index";
import { summarizeImpact, whereUsedEither } from "./impact";
import type { SystemProject } from "@/lib/system-design/model";
import { linkDecision, newDecision } from "@/lib/decisions/model";

const project = {
  id: "p1",
  name: "Ordering topology",
  systems: [{ id: "s1", name: "Salesforce" }, { id: "s2", name: "Middleware" }],
  interfaces: [],
  operations: [{ id: "op1", interfaceId: "i1", name: "Create order", method: "POST", path: "/orders" }],
  connections: [{ id: "c1", sourceId: "s1", targetId: "s2", label: "Create Order" }],
} as unknown as SystemProject;

describe("impact analysis", () => {
  it("groups inbound hits by surface with cited edges", () => {
    const d = linkDecision(newDecision("Middleware owns orchestration", "ADR-001", 1), {
      surface: "system",
      recordId: "s2",
      label: "Middleware",
    });
    const g = buildIndex({ systems: [project], decisions: [d] });
    const impact = summarizeImpact(g, { surface: "system", id: "s2" });
    expect(impact.target?.name).toBe("Middleware");
    const kinds = impact.groups.flatMap((gr) => gr.hits.map((h) => h.via.kind));
    expect(kinds).toContain("contains");
    expect(kinds).toContain("connects");
    expect(kinds).toContain("links");
    expect(impact.groups[0].href).toBe("/system");
    expect(impact.total).toBe(3);
  });

  it("flags refs still naming a deleted target", () => {
    const d = linkDecision(newDecision("Gone", "ADR-009", 1), {
      surface: "system",
      recordId: "s-gone",
      label: "Ghost Hop",
    });
    const g = buildIndex({ systems: [project], decisions: [d] });
    const impact = summarizeImpact(g, { surface: "system", id: "s-gone" });
    expect(impact.target).toBeNull();
    expect(impact.dangling.some((u) => u.raw === "s-gone" && u.name === "Ghost Hop")).toBe(true);
  });

  it("resolves free text as id-then-name and misses cleanly", () => {
    const g = buildIndex({ systems: [project] });
    expect(whereUsedEither(g, "system", "op1").node?.kind).toBe("operation");
    expect(whereUsedEither(g, "system", "POST /orders").node?.kind).toBe("operation");
    expect(whereUsedEither(g, "system", "nope").node).toBeNull();
    expect(summarizeImpact(g, { surface: "system", id: "nope" }).groups).toEqual([]);
  });
});
