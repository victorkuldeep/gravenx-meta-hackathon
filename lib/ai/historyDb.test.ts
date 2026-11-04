import { describe, expect, it } from "vitest";
import { deleteAiSession, listAiSessions, loadAiSession, saveAiSession, titleForTurns } from "./historyDb";

describe("session titles", () => {
  it("derives from the first user message, markdown-stripped", () => {
    expect(titleForTurns([])).toBe("New conversation");
    expect(titleForTurns([{ role: "assistant", content: "hi" }])).toBe("New conversation");
    expect(titleForTurns([{ role: "user", content: "  **Map** `Account` [fields]?  " }])).toBe("Map Account fields?");
    const long = titleForTurns([{ role: "user", content: `x`.repeat(100) }]);
    expect(long.length).toBeLessThanOrEqual(53);
  });
});

describe("session store degradation", () => {
  it("never throws off-browser", async () => {
    // happy-dom has no IndexedDB: every op degrades to a safe empty.
    await expect(listAiSessions("org")).resolves.toEqual([]);
    await expect(loadAiSession("missing")).resolves.toBeNull();
    await expect(
      saveAiSession("org", "id", { providerId: "p", modelId: "m", skillName: "s", turns: [{ role: "user", content: "hi" }], totalIn: 1, totalOut: 2 }),
    ).resolves.toBe(false);
    await expect(deleteAiSession("id")).resolves.toBe(false);
  });
});
