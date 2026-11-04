import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/**
 * Regression pin: the Draw canvas must mount with definite dimensions.
 * A flex-fill-only container measured zero at mount and the Excalidraw
 * toolbar never rendered (white board, no tools, no error).
 */
describe("draw mount dimensions", () => {
  it("studio container uses a deterministic viewport height", () => {
    const src = read("components/draw/DrawStudio.tsx");
    expect(src).toMatch(/100dvh/);
  });

  it("draw page adds no gutters around the canvas", () => {
    const src = read("app/draw/page.tsx");
    expect(src).not.toContain("max-w-[1500px]");
    expect(src).not.toContain("px-5");
  });
});
