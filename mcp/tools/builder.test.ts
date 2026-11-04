import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addBatchRequest, batchPayload, buildPayload, createBatch, listBatches, validateBatch } from "./builder";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gx-builder-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("builder tools", () => {
  it("builds a single payload and rejects bad methods", async () => {
    const ok = await buildPayload({ method: "POST", objectApiName: "Account", fields: [{ apiName: "Name", value: "Acme" }] });
    expect(ok.ok).toBe(true);
    expect(ok.data).toMatchObject({ payload: { method: "POST", url: "/services/data/v66.0/sobjects/Account" } });
    const bad = await buildPayload({ method: "UPSERT", objectApiName: "Account" });
    expect(bad.ok).toBe(false);
    const needsId = await buildPayload({ method: "PATCH", objectApiName: "Account" });
    expect(needsId.ok).toBe(false);
  });

  it("creates a batch, links requests with references, validates and emits payload", async () => {
    await createBatch(dir, { name: "Order Flow" });
    const acc = await addBatchRequest(dir, { ref: "Order Flow", objectApiName: "Account", fields: [{ apiName: "Name", value: "Acme" }] });
    expect(acc.ok).toBe(true);
    const accRef = (acc.data as { referenceId: string }).referenceId;
    const con = await addBatchRequest(dir, {
      ref: "Order Flow",
      objectApiName: "Contact",
      fields: [
        { apiName: "LastName", value: "Doe" },
        { apiName: "AccountId", from: accRef, property: "id" },
      ],
    });
    expect(con.ok).toBe(true);
    const v = await validateBatch(dir, { ref: "Order Flow" });
    expect(v.ok).toBe(true);
    const p = await batchPayload(dir, { ref: "Order Flow" });
    expect(p.ok).toBe(true);
    const payload = (p.data as { payload: { compositeRequest: { referenceId: string; body?: Record<string, unknown> }[] } }).payload;
    expect(payload.compositeRequest).toHaveLength(2);
    expect(payload.compositeRequest[1].body?.AccountId).toBe(`@{${accRef}.id}`);
    const listed = await listBatches(dir);
    expect((listed.data as { batches: unknown[] }).batches.length).toBe(1);
  });

  it("rejects dangling references without saving", async () => {
    await createBatch(dir, { name: "Broken" });
    const bad = await addBatchRequest(dir, {
      ref: "Broken",
      objectApiName: "Contact",
      fields: [{ apiName: "AccountId", from: "Ghost_1" }],
    });
    expect(bad.ok).toBe(false);
    const v = await validateBatch(dir, { ref: "Broken" });
    expect(v.ok).toBe(true); // failed add saved nothing
    expect((v.data as { warnings: unknown[] }).warnings).toBeDefined();
  });
});
