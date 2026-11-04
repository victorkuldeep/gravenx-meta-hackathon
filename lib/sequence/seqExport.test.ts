import { describe, expect, it } from "vitest";
import { seqPngFileName } from "./seqExport";

describe("seqPngFileName", () => {
  it("slugifies the document and stamps the scale", () => {
    expect(seqPngFileName("Order to Fulfillment!", 3)).toMatch(/^order-to-fulfillment-\d{8}-\d{4}@3x\.png$/);
    expect(seqPngFileName("", 2)).toMatch(/^sequence-\d{8}-\d{4}@2x\.png$/);
  });
});
