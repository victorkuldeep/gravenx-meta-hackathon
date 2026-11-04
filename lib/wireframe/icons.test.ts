import { describe, expect, it } from "vitest";
import { isWireBrand, wireBrandDef, wireIconNames, WIRE_BRANDS, WIRE_ICONS, WIRE_UI_ICONS } from "./icons";

describe("wireframe icon set", () => {
  it("ships named glyphs with no collisions", () => {
    const names = wireIconNames();
    expect(names.length).toBeGreaterThan(20);
    expect(new Set(names).size).toBe(names.length);
    for (const [name, def] of Object.entries(WIRE_ICONS)) {
      expect(def.label.length, name).toBeGreaterThan(0);
    }
  });

  it("covers the everyday UI vocabulary plus brands", () => {
    for (const must of ["menu", "search", "bell", "user", "home", "trash", "star", "mail", "book", "lock", "globe", "github", "linkedin"]) {
      expect(WIRE_ICONS[must], must).toBeDefined();
    }
    expect(Object.keys(WIRE_UI_ICONS)).toContain("refresh");
  });

  it("keeps brand marks vendored with drawable geometry", () => {
    expect(isWireBrand("github")).toBe(true);
    expect(isWireBrand("star")).toBe(false);
    for (const [name, def] of Object.entries(WIRE_BRANDS)) {
      expect(def.els.length, name).toBeGreaterThan(0);
      expect(def.els.every((el) => el.d.length > 100), name).toBe(true);
    }
    expect(wireBrandDef("nope")).toBe(WIRE_BRANDS.linkedin);
  });
});
