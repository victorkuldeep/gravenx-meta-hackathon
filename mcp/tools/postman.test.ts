import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importPostman } from "./postman";
import { importProject } from "@/lib/system-design/model";

let dir = "";

const COLLECTION = JSON.stringify({
  info: { name: "Order API" },
  item: [
    {
      name: "Salesforce",
      item: [
        {
          name: "Create Order",
          request: {
            method: "POST",
            url: "https://acme.my.salesforce.com/services/data/v66.0/sobjects/Order",
            header: [{ key: "Authorization", value: "Bearer SECRET" }],
            body: { mode: "raw", raw: '{"AccountId":"001"}' },
          },
        },
        {
          name: "Get Order",
          request: { method: "GET", url: { raw: "https://acme.my.salesforce.com/services/data/v66.0/sobjects/Order/123" } },
        },
      ],
    },
    {
      name: "Push to Hub",
      item: [
        {
          name: "Send Order",
          request: {
            method: "POST",
            url: { host: ["hub", "example", "com"], path: ["api", "orders"] },
            body: { mode: "raw", raw: "{}" },
          },
        },
      ],
    },
  ],
});

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "gx-postman-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("postman import", () => {
  it("builds a studio-openable system project and drops secrets", async () => {
    const r = await importPostman(dir, { collectionJson: COLLECTION });
    expect(r.ok).toBe(true);
    const data = r.data as { systems: string[]; operations: number; draftEdges: number; secretsDropped: number };
    expect(data.systems).toEqual(["Salesforce", "Push to Hub"]);
    expect(data.operations).toBe(3);
    expect(data.draftEdges).toBe(1);
    expect(data.secretsDropped).toBe(1);
    // The saved file round-trips through the studio validator.
    const { readJson } = await import("../workspace");
    const check = importProject(readJson(r.file as string));
    expect(check.project?.systems).toHaveLength(2);
    expect(check.issues.filter((i) => i.path.startsWith("$.systems"))).toEqual([]);
  });

  it("rejects garbage and oversized collections", async () => {
    expect((await importPostman(dir, { collectionJson: "nope" })).ok).toBe(false);
    expect((await importPostman(dir, { collectionJson: '{"a":1}' })).ok).toBe(false);
    expect((await importPostman(dir, {})).ok).toBe(false);
  });
});
