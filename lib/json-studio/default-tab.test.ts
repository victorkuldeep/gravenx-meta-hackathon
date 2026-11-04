import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(
  path.join(process.cwd(), "components/json-studio/JsonStudio.tsx"),
  "utf8"
);

describe("JSON Studio default tab", () => {
  it("lands on the Editor first", () => {
    expect(src).toMatch(/useState<Tab>\("editor"\)/);
  });

  it("still offers both Editor and Compare A/B tabs", () => {
    expect(src).toMatch(/id: "editor", label: "Editor"/);
    expect(src).toMatch(/id: "compare", label: "Compare A\/B"/);
  });
});
