import { describe, expect, it } from "vitest";
import { newSequence } from "./model";
import { importSequenceFile } from "./packageIo";

describe("importSequenceFile", () => {
  it("round-trips an exported package with a fresh identity", () => {
    const doc = newSequence("Shop");
    const pkg = JSON.stringify({ kind: "gravenx-sequence-package", packageVersion: 1, document: doc });
    const r = importSequenceFile(pkg, "shop-v1-package.json");
    expect(r.ok).toBe(true);
    expect(r.document?.name).toBe("Shop (imported)");
    expect(r.document?.id).not.toBe(doc.id);
  });

  it("imports plain DSL text named after the file", () => {
    const r = importSequenceFile("Salesforce -> Middleware: Create Order\n", "order-flow.txt");
    expect(r.ok).toBe(true);
    expect(r.document?.name).toBe("order flow");
    expect(r.document?.participants.map((p) => p.name)).toEqual(["Salesforce", "Middleware"]);
  });

  it("round-trips the shared builder through the importer", async () => {
    const { sequencePackage } = await import("./packageIo");
    const { newSequence } = await import("./model");
    const doc = newSequence("Round trip");
    const r = importSequenceFile(JSON.stringify(sequencePackage(doc)), "shared-sequence.json");
    expect(r.ok).toBe(true);
    expect(r.document?.name).toBe("Round trip (imported)");
  });

  it("rejects bad JSON, bad schema and bad DSL", () => {
    expect(importSequenceFile("nope", "x.json").ok).toBe(false);
    expect(importSequenceFile(JSON.stringify({ document: { name: 1 } }), "x.json").ok).toBe(false);
    const bad = importSequenceFile("end\n", "x.txt");
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/line 1/);
    expect(importSequenceFile("   \n", "x.txt").ok).toBe(false);
  });
});
