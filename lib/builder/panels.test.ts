import { describe, expect, it } from "vitest";
import tailwindConfig from "../../tailwind.config";
import { builderGridClass, builderSectionAvailability } from "./panels";

describe("builder panel grid", () => {
  it("splits evenly with a fixed height when both panels are open", () => {
    expect(builderGridClass(true, true)).toBe("lg:grid-cols-2 lg:h-[620px]");
  });

  it("gives a lone open panel the full width with fixed height", () => {
    // Collapsed panels dock into the rail, so the grid never holds a
    // strip: one child always spans the whole row.
    expect(builderGridClass(true, false)).toBe("lg:h-[620px]");
    expect(builderGridClass(false, true)).toBe("lg:h-[620px]");
  });

  it("collapses to strips with no fixed height when both are docked", () => {
    expect(builderGridClass(false, false)).toBe("");
  });

  it("gates lower sections on connection, fields and payload", () => {
    expect(builderSectionAvailability(false, 3, true)).toEqual({ payload: false, test: true });
    expect(builderSectionAvailability(true, 0, false)).toEqual({ payload: false, test: false });
    expect(builderSectionAvailability(true, 2, false)).toEqual({ payload: true, test: false });
    expect(builderSectionAvailability(true, 2, true)).toEqual({ payload: true, test: true });
  });

  it("lives under a Tailwind-scanned path so its classes are generated", () => {
    // Regression: these literals moved from app/page.tsx into lib/, which
    // the content globs did not cover - the grid shipped without
    // columns/height and both lists expanded without bound.
    const globs = (tailwindConfig.content as unknown[]).filter((c): c is string => typeof c === "string");
    expect(globs.some((g) => g.includes("lib"))).toBe(true);
  });
});
