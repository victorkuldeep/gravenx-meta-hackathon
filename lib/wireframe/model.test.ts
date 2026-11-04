import { describe, expect, it } from "vitest";
import {
  buildOdaManifest,
  canTransition,
  cloneExperience,
  ExperienceSchema,
  newExperience,
  newScreen,
  renameExperience,
  rollupProposedFields,
  type WireComponent,
} from "./model";

const proposed = (apiName: string): WireComponent => ({
  id: `c_${apiName}`,
  kind: "select",
  label: "Segment",
  props: {},
  bindingState: "proposed",
  binding: { source: "salesforce", object: "Account", field: apiName },
  proposedField: { object: "Account", apiName, label: "Segment", type: "Picklist", values: ["SMB"] },
});

describe("experience model", () => {
  it("creates valid defaults", () => {
    const exp = newExperience("  Portal  ");
    expect(exp.name).toBe("Portal");
    expect(exp.version).toBe(1);
    expect(exp.status).toBe("draft");
    expect(ExperienceSchema.safeParse(exp).success).toBe(true);
  });

  it("rejects unknown kinds and bad statuses", () => {
    const exp = { ...newExperience("x"), status: "shipped" };
    expect(ExperienceSchema.safeParse(exp).success).toBe(false);
    const bad = { ...newExperience("x"), components: [{ id: "c", kind: "teleporter", label: "", props: {} }] };
    expect(ExperienceSchema.safeParse(bad).success).toBe(false);
  });

  it("renames only on real change", () => {
    const exp = newExperience("Portal");
    expect(renameExperience(exp, "   ")).toBeNull();
    expect(renameExperience(exp, "Portal")).toBeNull();
    const next = renameExperience(exp, "  Customer Hub  ");
    expect(next?.name).toBe("Customer Hub");
    expect(next?.id).toBe(exp.id);
  });

  it("gates approval through review", () => {
    expect(canTransition("draft", "in-review")).toBe(true);
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("in-review", "approved")).toBe(true);
    expect(canTransition("in-review", "draft")).toBe(true);
    expect(canTransition("approved", "draft")).toBe(false);
  });

  it("dedupes the proposed-fields rollup", () => {
    const out = rollupProposedFields([proposed("Seg__c"), proposed("Seg__c"), proposed("Tier__c")]);
    expect(out.map((p) => p.apiName)).toEqual(["Seg__c", "Tier__c"]);
  });

  it("builds the ODA manifest from bindings and intents", () => {
    const exp = newExperience("Portal");
    exp.screens = [newScreen("Detail")];
    exp.components = [
      { id: "f1", kind: "input", label: "Name", props: {}, bindingState: "existing", binding: { source: "salesforce", object: "Account", field: "Name" }, oda: { implements: ["Account"], consumes: ["REST:GET /sobjects/Account/:id"], emits: [] } },
      { ...proposed("Seg__c"), parentId: exp.screens[0].id },
      { id: "b1", kind: "button", label: "Save", props: {}, interaction: { trigger: "click", action: "save", target: "Account" } },
    ];
    const m = buildOdaManifest(exp);
    expect(m.implements).toEqual(["Account"]);
    expect(m.consumes).toEqual(["REST:GET /sobjects/Account/:id"]);
    expect(m.emits).toContain("save:Account");
    expect(m.schemaDelta.existing).toEqual(["Account.Name"]);
    expect(m.schemaDelta.proposed.map((p) => p.apiName)).toEqual(["Seg__c"]);
    expect(m.screens[0]).toMatchObject({ name: "Detail", components: 1 });
  });

  it("clones with fresh identity and remapped refs", () => {
    const exp = {
      ...newExperience("Shop"),
      status: "approved" as const,
      version: 4,
      screens: [{ ...newScreen("Detail"), id: "s1" }],
      components: [{ ...proposed("Seg__c"), parentId: "s1" }],
      journeys: [{ id: "j1", name: "Signup", screenIds: ["s1", "gone"] }],
    };
    const c = cloneExperience(exp);
    expect(c.id).not.toBe(exp.id);
    expect(c.name).toBe("Shop (copy)");
    expect(c.status).toBe("draft");
    expect(c.version).toBe(1);
    expect(c.screens[0].id).not.toBe("s1");
    expect(c.components[0].parentId).toBe(c.screens[0].id);
    expect(c.components[0].id).not.toBe(exp.components[0].id);
    expect(c.journeys[0].screenIds).toEqual([c.screens[0].id]);
    expect(ExperienceSchema.safeParse(c).success).toBe(true);
  });
});
