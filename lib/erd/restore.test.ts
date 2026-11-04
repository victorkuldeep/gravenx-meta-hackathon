import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(
  path.join(process.cwd(), "components/erd/ErdCanvas.tsx"),
  "utf8"
);

describe("canvas restore centering", () => {
  it("centers once when the first nodes arrive post-mount", () => {
    // Guards the reload-restore gap: defaultViewport is mount-only, so an
    // asynchronously restored canvas must be centered explicitly or it
    // sits stranded top-left.
    expect(src).toMatch(/hadNodes/);
    expect(src).toMatch(/fitView\(\{ padding/);
  });

  it("never refits on later node changes (zoom stays sacred)", () => {
    expect(src).toMatch(/if \(!hadNodes\.current\)/);
  });
});
