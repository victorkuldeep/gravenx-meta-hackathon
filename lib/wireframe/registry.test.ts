import { describe, expect, it } from "vitest";
import {
  childrenOf,
  COMPONENT_REGISTRY,
  defFor,
  newComponent,
  paletteByCategory,
  patchComponent,
  removeSubtree,
  reorderSibling,
} from "./registry";

describe("component registry", () => {
  it("covers every model kind exactly once", async () => {
    const { COMPONENT_KINDS } = await import("./model");
    expect(COMPONENT_REGISTRY.map((d) => d.kind).sort()).toEqual([...COMPONENT_KINDS].sort());
  });

  it("groups the palette by category", () => {
    const cats = paletteByCategory();
    expect(cats.map((c) => c.category)).toEqual(["Foundation", "Form", "Actions", "Icons", "Layout", "Data", "Salesforce"]);
    expect(cats.every((c) => c.items.length > 0)).toBe(true);
  });

  it("builds components with registry defaults", () => {
    const c = newComponent("select", "scr_1");
    expect(c.parentId).toBe("scr_1");
    expect(c.label).toBe("Country");
    expect(c.props).toEqual({ options: ["Option A", "Option B"] });
    expect(() => defFor("teleporter" as never)).toThrow();
  });

  it("removes whole subtrees", () => {
    const root = newComponent("card", "scr_1");
    const child = { ...newComponent("input", root.id), id: "child" };
    const grand = { ...newComponent("text", "child"), id: "grand" };
    const other = { ...newComponent("text", "scr_1"), id: "other" };
    const all = [root, child, grand, other];
    expect(childrenOf(all, root.id).map((c) => c.id)).toEqual(["child"]);
    expect(removeSubtree(all, root.id).map((c) => c.id)).toEqual(["other"]);
  });

  it("patches one component without touching identity", () => {
    const a = { ...newComponent("input", "scr_1"), id: "a" };
    const out = patchComponent([a], "a", { label: "Email", bindingState: "existing", id: "hax", kind: "text" });
    expect(out[0].label).toBe("Email");
    expect(out[0].id).toBe("a");
    expect(out[0].kind).toBe("input");
    expect(patchComponent([a], "missing", { label: "x" })[0].label).toBe(a.label);
  });

  it("reorders within siblings only", () => {
    const a = { ...newComponent("text", "scr_1"), id: "a" };
    const b = { ...newComponent("text", "scr_1"), id: "b" };
    const c = { ...newComponent("text", "scr_2"), id: "c" };
    const all = [a, b, c];
    expect(reorderSibling(all, "a", -1).map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(reorderSibling(all, "a", 1).map((x) => x.id)).toEqual(["b", "a", "c"]);
    expect(reorderSibling(all, "missing", 1).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});
