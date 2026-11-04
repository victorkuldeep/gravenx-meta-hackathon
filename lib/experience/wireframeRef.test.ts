import { describe, expect, it } from "vitest";
import { newExperience, newScreen } from "@/lib/wireframe/model";
import { summarizeWireScreen } from "./wireframeRef";

function fixture() {
  const exp = newExperience("Portal");
  const s1 = newScreen("Lead form");
  const s2 = newScreen("Confirm");
  exp.screens = [s1, s2];
  exp.components = [
    { id: "c1", kind: "input", parentId: s1.id, label: "Email", binding: { source: "salesforce", object: "Lead", field: "Email" }, bindingState: "existing", props: {}, oda: { implements: [], consumes: [], emits: [] } },
    { id: "c2", kind: "input", parentId: s1.id, label: "Tier", bindingState: "proposed", proposedField: { object: "Lead", apiName: "Tier__c", label: "Tier", type: "Picklist" }, props: {}, oda: { implements: [], consumes: [], emits: [] } },
    { id: "c3", kind: "heading", parentId: s2.id, label: "Done", props: {}, oda: { implements: [], consumes: [], emits: [] } },
  ];
  return { exp, s1 };
}

describe("summarizeWireScreen", () => {
  it("summarizes components, bindings and proposed fields for the linked screen only", () => {
    const { exp, s1 } = fixture();
    const sum = summarizeWireScreen(exp, s1.id);
    expect(sum?.screenName).toBe("Lead form");
    expect(sum?.components).toBe(2);
    expect(sum?.salesforceBindings).toEqual(["Lead.Email"]);
    expect(sum?.proposedFields).toEqual(["Lead.Tier__c"]);
  });

  it("returns null for stale refs", () => {
    const { exp } = fixture();
    expect(summarizeWireScreen(exp, "missing")).toBeNull();
    expect(summarizeWireScreen(null, "x")).toBeNull();
  });
});
