import { describe, expect, it } from "vitest";
import { newExperience, newScreen } from "./model";
import { newComponent } from "./registry";
import { buildSpec } from "./buildSpec";

describe("buildSpec", () => {
  it("renders a deterministic, version-stamped spec", () => {
    const s1 = { ...newScreen("Detail", 0, 0), id: "s1", route: "/detail" };
    const bound = {
      ...newComponent("sffield", "s1"),
      id: "c1",
      label: "Name",
      bindingState: "existing" as const,
      binding: { source: "salesforce" as const, object: "Account", field: "Name" },
      validation: { required: true },
    };
    const saver = {
      ...newComponent("button", "s1"),
      id: "c2",
      label: "Save",
      interaction: { trigger: "click" as const, action: "save", target: "Account" },
    };
    const exp = {
      ...newExperience("Portal"),
      version: 3,
      status: "approved" as const,
      screens: [s1],
      components: [bound, saver],
      journeys: [{ id: "j1", name: "Signup", screenIds: ["s1"] }],
      proposedFields: [{ object: "Account", apiName: "Tier__c", label: "Tier", type: "Picklist", values: ["A", "B"] }],
    };
    const spec = buildSpec(exp);
    expect(spec).toContain("# BUILD REQUEST - Portal");
    expect(spec).toContain("experience v3 · status approved");
    expect(spec).toContain("### Detail (/detail)");
    expect(spec).toContain("binds Account.Name");
    expect(spec).toContain("on click → save Account");
    expect(spec).toContain("`Account.Tier__c` Picklist");
    expect(spec).toContain("### Signup");
    expect(spec).toContain("1. Detail");
    expect(spec).toContain("## Build order");
    // Deterministic: same input, byte-identical output.
    expect(buildSpec(exp)).toBe(spec);
  });

  it("degrades gracefully on an empty experience", () => {
    const spec = buildSpec(newExperience("Bare"));
    expect(spec).toContain("_No bindings yet._");
    expect(spec).toContain("_No screens yet._");
  });
});
