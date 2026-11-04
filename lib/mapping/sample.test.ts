import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateImport } from "./exchange";
import { extractPaths } from "./source";

/** The downloadable training sample must stay importable and self-consistent. */
describe("training sample mapping", () => {
  const text = readFileSync(join(process.cwd(), "public", "samples", "product-order-mapping.json"), "utf8");

  it("passes import validation with no errors", () => {
    const v = validateImport(text);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.project?.mappings.length).toBeGreaterThan(0);
  });

  it("stored paths match a fresh parse of the embedded sample", () => {
    const v = validateImport(text);
    const stored = (v.project?.source?.paths ?? []).map((p) => p.id);
    const fresh = extractPaths(JSON.parse(v.project?.source?.originalText ?? "{}")).map((p) => p.id);
    expect(stored).toEqual(fresh);
  });
});
