import { beforeEach, describe, expect, it } from "vitest";
import { getPreferences, resetPreferences, sanitizePreferences, savePreferences } from "./preferences";

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("preferences", () => {
  it("returns defaults off-browser and on garbage", () => {
    expect(getPreferences().defaultApiVersion).toBe("v66.0");
    expect(getPreferences().erdHideSystem).toBe(true);
    expect(sanitizePreferences(null).apexLogLevel).toBe("Debug");
    expect(sanitizePreferences({ defaultApiVersion: "xx", apexLogCategory: "Nope", apexLogLevel: "Loud", erdHideSystem: "yes" })).toEqual({
      version: 1,
      defaultApiVersion: "v66.0",
      apexLogCategory: "ApexCode",
      apexLogLevel: "Debug",
      erdHideSystem: true,
    });
  });

  it("round-trips valid choices and resets", () => {
    savePreferences({ version: 1, defaultApiVersion: "v65.0", apexLogCategory: "Db", apexLogLevel: "Fine", erdHideSystem: false });
    expect(getPreferences()).toEqual({
      version: 1,
      defaultApiVersion: "v65.0",
      apexLogCategory: "Db",
      apexLogLevel: "Fine",
      erdHideSystem: false,
    });
    resetPreferences();
    expect(getPreferences().erdHideSystem).toBe(true);
  });
});
