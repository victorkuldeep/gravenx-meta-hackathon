import { describe, it, expect } from "vitest";
import { rankObjects } from "./rank";

const objs = [
  { name: "Contact", label: "Contact" },
  { name: "ContactEncounterParticipantFeed", label: "Contact Encounter Participant Feed" },
  { name: "AccountContactRelation", label: "Account Contact Relation" },
  { name: "Opportunity", label: "Opportunity" },
];

describe("rankObjects", () => {
  it("returns the full list when query is empty", () => {
    expect(rankObjects(objs, "").length).toBe(objs.length);
  });

  it("exact name match outranks everything else", () => {
    const out = rankObjects(objs, "Contact");
    expect(out[0].name).toBe("Contact");
  });

  it("name prefix outranks name includes", () => {
    const out = rankObjects(objs, "Acc");
    expect(out[0].name).toBe("AccountContactRelation");
  });

  it("label match is considered", () => {
    const out = rankObjects(objs, "Opportunity");
    expect(out[0].name).toBe("Opportunity");
  });

  it("respects the limit", () => {
    const out = rankObjects(objs, "x", 2);
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it("is case-insensitive", () => {
    const out = rankObjects(objs, "CONTACT");
    expect(out[0].name).toBe("Contact");
  });
});
