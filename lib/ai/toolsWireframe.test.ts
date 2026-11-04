import { afterEach, describe, expect, it } from "vitest";
import { newExperience, type Experience } from "@/lib/wireframe/model";
import { newComponent } from "@/lib/wireframe/registry";
import { registerWireBridge, wireSnapshotOf } from "./wireBridge";
import { skillForPath } from "./skills";
import { WIREFRAME_TOOLS } from "./toolsWireframe";
import { toolsForSkill } from "./toolsSystem";

let exp: Experience;

function seed() {
  exp = newExperience("AI Lab");
  const s = { id: "s1", name: "Detail", route: undefined, viewport: { width: 390, height: 844 }, position: { x: 0, y: 0 } };
  exp = { ...exp, screens: [s] };
  registerWireBridge({
    getSnapshot: () => wireSnapshotOf(exp),
    getExperience: () => exp,
    apply: (fn) => {
      exp = fn(exp);
      return { ok: true };
    },
  });
}

afterEach(() => registerWireBridge(null));

function tool(name: string) {
  return WIREFRAME_TOOLS.find((t) => t.name === name)!;
}

async function run(name: string, args: unknown = {}) {
  const t = tool(name);
  const parsed = t.schema.safeParse(args);
  if (!parsed.success) throw new Error(`bad test args for ${name}`);
  return t.execute(parsed.data);
}

describe("wireframe skill + tool set", () => {
  it("routes /wireframe to the wireframe pack", () => {
    expect(skillForPath("/wireframe").name).toBe("wireframe");
    expect(toolsForSkill("wireframe")).toHaveLength(8);
    expect(toolsForSkill("wireframe").every((t) => t.name.startsWith("wire_"))).toBe(true);
  });

  it("reports absence outside the canvas", async () => {
    expect((await run("wire_describe")).ok).toBe(false);
    expect((await run("wire_add_screen", { name: "X" })).ok).toBe(false);
  });
});

describe("wireframe reads", () => {
  it("describes, lists, deltas and specs the live experience", async () => {
    seed();
    const d = await run("wire_describe");
    expect(d.ok).toBe(true);
    expect(d.result).toMatchObject({ name: "AI Lab", componentCount: 0 });

    exp = {
      ...exp,
      components: [
        { ...newComponent("sffield", "s1"), id: "c1", label: "Name", bindingState: "existing", binding: { source: "salesforce", object: "Account", field: "Name" } },
        { ...newComponent("button", "s1"), id: "c2", label: "Save", interaction: { trigger: "click", action: "save", target: "Account" } },
      ],
      proposedFields: [{ object: "Account", apiName: "Tier__c", label: "Tier", type: "Picklist", values: ["A"] }],
    };

    const list = await run("wire_components");
    expect(list.ok).toBe(true);
    expect((list.result as unknown[])).toHaveLength(2);
    const filtered = await run("wire_components", { screen: "Detail" });
    expect((filtered.result as unknown[])).toHaveLength(2);
    expect((await run("wire_components", { screen: "Missing" })).ok).toBe(false);

    const delta = await run("wire_delta");
    expect(delta.ok).toBe(true);
    expect(JSON.stringify(delta.result)).toMatch(/Tier__c/);

    const spec = await run("wire_spec");
    expect(spec.ok).toBe(true);
    expect(spec.result as string).toContain("# BUILD REQUEST - AI Lab");
  });
});

describe("wireframe mutations", () => {
  it("adds screens and components through the bridge", async () => {
    seed();
    expect((await run("wire_add_screen", { name: "Search" })).ok).toBe(true);
    expect(exp.screens.map((s) => s.name)).toEqual(["Detail", "Search"]);

    const add = await run("wire_add_component", { kind: "sffield", screen: "Search", label: "Phone", object: "Account", field: "Phone" });
    expect(add.ok).toBe(true);
    expect(exp.components[0]).toMatchObject({ label: "Phone", bindingState: "existing" });

    expect((await run("wire_add_component", { kind: "nope", screen: "Search" })).ok).toBe(false);
    expect((await run("wire_add_component", { kind: "input", screen: "Missing" })).ok).toBe(false);
  });

  it("binds existing, proposed, external and unbound", async () => {
    seed();
    exp = { ...exp, components: [{ ...newComponent("input", "s1"), id: "c1", label: "Tier" }] };

    expect((await run("wire_bind", { component: "c1", state: "existing", object: "Account", field: "Industry" })).ok).toBe(true);
    expect(exp.components[0].binding).toMatchObject({ object: "Account", field: "Industry" });
    expect((await run("wire_bind", { component: "c1", state: "existing" })).ok).toBe(false);

    expect((await run("wire_bind", { component: "Tier", state: "proposed", object: "Account", fieldType: "Picklist", values: ["A", "B"] })).ok).toBe(true);
    expect(exp.components[0].proposedField).toMatchObject({ object: "Account", apiName: "Tier__c" });
    expect(exp.proposedFields).toHaveLength(0); // rollup recomputes on canvas persist, not in the tool

    expect((await run("wire_bind", { component: "c1", state: "external", object: "Credit API" })).ok).toBe(true);
    expect(exp.components[0].binding).toMatchObject({ externalLabel: "Credit API" });

    expect((await run("wire_bind", { component: "c1", state: "unbound" })).ok).toBe(true);
    expect(exp.components[0].bindingState).toBeUndefined();
  });

  it("rejects ambiguous labels and sets interactions", async () => {
    seed();
    exp = {
      ...exp,
      components: [
        { ...newComponent("input", "s1"), id: "c1", label: "Same" },
        { ...newComponent("input", "s1"), id: "c2", label: "Same" },
      ],
    };
    const amb = await run("wire_bind", { component: "Same", state: "unbound" });
    expect(amb.ok).toBe(false);
    expect(amb.error).toMatch(/Ambiguous/);

    const ok = await run("wire_interact", { component: "c1", trigger: "click", action: "save", target: "Account" });
    expect(ok.ok).toBe(true);
    expect(exp.components[0].interaction).toMatchObject({ action: "save", target: "Account" });
  });
});
