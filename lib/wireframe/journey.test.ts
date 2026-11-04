import { describe, expect, it } from "vitest";
import { createJourney, moveJourneyScreen, pruneJourney, toggleJourneyScreen } from "./journey";

describe("journeys", () => {
  it("creates, toggles and reorders members", () => {
    const j = createJourney("  Signup  ");
    expect(j.name).toBe("Signup");
    expect(createJourney("   ").name).toBe("Untitled journey");
    const withAB = toggleJourneyScreen(toggleJourneyScreen(j, "a"), "b");
    expect(withAB.screenIds).toEqual(["a", "b"]);
    expect(toggleJourneyScreen(withAB, "a").screenIds).toEqual(["b"]);
    expect(moveJourneyScreen(withAB, "b", -1).screenIds).toEqual(["b", "a"]);
    expect(moveJourneyScreen(withAB, "a", -1).screenIds).toEqual(["a", "b"]);
    expect(moveJourneyScreen(withAB, "zzz", 1).screenIds).toEqual(["a", "b"]);
  });

  it("prunes deleted screens, stable when nothing is stale", () => {
    const j = { ...createJourney("J"), screenIds: ["a", "b"] };
    const pruned = pruneJourney(j, new Set(["b", "c"]));
    expect(pruned.screenIds).toEqual(["b"]);
    expect(pruneJourney(j, new Set(["a", "b"]))).toBe(j);
  });
});
