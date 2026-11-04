import { describe, it, expect } from "vitest";
import { compileContract } from "./openapi-compiler";
import { adaptDescribe } from "./metadata-adapter";
import { seedLeadAcquisition } from "./seeds";
import { leadDescribeFixture } from "./test-fixtures";
import type { ContractFieldMeta } from "./metadata-adapter";

/**
 * Proves @scalar/openapi-parser validates our compiler output.
 * The Validate tab lazy-loads the same call in the browser.
 */
describe("scalar openapi validation", () => {
  it("accepts the compiled Acquisition contract", async () => {
    const { validate } = await import("@scalar/openapi-parser");
    const meta = new Map<string, ContractFieldMeta>();
    for (const f of adaptDescribe(leadDescribeFixture()).fields) meta.set(f.apiName, f);
    const compiled = compileContract({
      profile: seedLeadAcquisition(),
      metaByName: meta,
      snapshotCapturedAt: 1758412800000,
      now: 1758412800000,
    });
    const result = await validate(compiled.document);
    const errors = (result.errors ?? []).filter((e) => {
      const msg = String((e as { message?: string }).message ?? e);
      return !msg.toLowerCase().includes("warning");
    });
    expect(errors).toEqual([]);
  }, 30000);
});
