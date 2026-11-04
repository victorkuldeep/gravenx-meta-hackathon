import { describe, expect, it } from "vitest";
import { newExperience, newScreen } from "./model";
import { newComponent } from "./registry";
import { apiImpact, experienceToDraft, externalEndpoints } from "./systemBridge";

function experience() {
  const s1 = { ...newScreen("Detail", 0, 0), id: "s1" };
  const s2 = { ...newScreen("Empty", 400, 0), id: "s2" };
  const sf = {
    ...newComponent("sffield", "s1"),
    id: "c1",
    bindingState: "existing" as const,
    binding: { source: "salesforce" as const, object: "Account", field: "Name", writeApi: "PATCH /sobjects/Account/:id" },
    interaction: { trigger: "click" as const, action: "save", target: "Account" },
  };
  const ext = {
    ...newComponent("input", "s1"),
    id: "c2",
    bindingState: "external" as const,
    binding: { source: "rest" as const, externalLabel: "Credit API", readApi: "GET /score/:id" },
  };
  const plain = { ...newComponent("input", "s2"), id: "c3" };
  return { ...newExperience("Shop"), screens: [s1, s2], components: [sf, ext, plain] };
}

describe("externalEndpoints", () => {
  it("dedupes external labels case-insensitively", () => {
    expect(externalEndpoints(experience())).toEqual([{ key: "ext:credit api", name: "Credit API" }]);
  });
});

describe("experienceToDraft", () => {
  it("anchors Salesforce and fans out one edge per screen pair", () => {
    const draft = experienceToDraft(experience());
    expect(draft.systems.map((s) => s.name)).toEqual(["Salesforce", "Credit API"]);
    expect(draft.connections).toHaveLength(1);
    expect(draft.connections[0]).toMatchObject({ fromKey: "ext:credit api", toKey: "sf" });
    expect(draft.connections[0].label).toMatch(/Detail.*GET \/score/);
    expect(draft.warnings.join(" ")).toMatch(/Empty/);
  });

  it("warns when nothing is bound", () => {
    const draft = experienceToDraft(newExperience("Bare"));
    expect(draft.systems).toEqual([]);
    expect(draft.warnings.join(" ")).toMatch(/Nothing bound/);
  });
});

describe("apiImpact", () => {
  it("collects refs, bindings and externals per screen", () => {
    const impact = apiImpact(experience());
    expect(impact[0]).toMatchObject({
      screenName: "Detail",
      reads: ["GET /score/:id"],
      bindings: ["Account.Name"],
      externals: ["Credit API"],
    });
    expect(impact[0].writes).toEqual(expect.arrayContaining(["PATCH /sobjects/Account/:id", "save:Account"]));
    expect(impact[1]).toMatchObject({ reads: [], writes: [], bindings: [], externals: [] });
  });
});
