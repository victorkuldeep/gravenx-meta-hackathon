import { describe, expect, it } from "vitest";
import { newExperience, newScreen } from "./model";
import { newComponent } from "./registry";
import { behaviorCount, screenBehaviors } from "./behavior";

function interacting(over: Record<string, unknown> = {}) {
  return {
    ...newComponent("button", "s1"),
    interaction: { trigger: "click" as const, action: "save", target: "Account" },
    ...over,
  };
}

describe("screenBehaviors", () => {
  it("groups intents in screen order with orphan bucket last", () => {
    const s1 = { ...newScreen("Search", 0, 0), id: "s1" };
    const s2 = { ...newScreen("Detail", 400, 0), id: "s2" };
    const exp = {
      ...newExperience("B"),
      screens: [s1, s2],
      components: [
        interacting({ id: "c1", parentId: "s2", label: "Save" }),
        interacting({ id: "c2", parentId: "s1", label: "Go", interaction: { trigger: "click" as const, action: "navigate", target: "s2" } }),
        interacting({ id: "c3", parentId: "s1", label: "Lost", interaction: { trigger: "click" as const, action: "navigate", target: "nope" } }),
        { ...newComponent("input", "s1"), id: "c4" },
        interacting({ id: "c5", parentId: "gone", label: "Stray" }),
      ],
    };
    const groups = screenBehaviors(exp);
    expect(groups.map((g) => g.screenName)).toEqual(["Search", "Detail", "No screen"]);
    expect(groups[0].items.map((i) => i.componentId)).toEqual(["c2", "c3"]);
    expect(groups[0].items.find((i) => i.componentId === "c2")!.dangling).toBe(false);
    expect(groups[0].items.find((i) => i.componentId === "c3")!.dangling).toBe(true);
    expect(behaviorCount(exp)).toBe(4);
  });

  it("matches navigate targets by screen name too", () => {
    const s1 = { ...newScreen("Confirm", 0, 0), id: "s1" };
    const exp = {
      ...newExperience("B"),
      screens: [s1],
      components: [interacting({ id: "c1", parentId: "s9", interaction: { trigger: "load" as const, action: "Navigate", target: "confirm" } })],
    };
    expect(screenBehaviors(exp)[0].items[0].dangling).toBe(false);
  });
});
