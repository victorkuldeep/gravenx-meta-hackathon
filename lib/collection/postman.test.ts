import { describe, it, expect } from "vitest";
import { buildPostmanCollection, originOf } from "./postman";
import type { CollectionItem } from "./types";

const item = (over: Partial<CollectionItem>): CollectionItem => ({
  id: "1",
  collectionId: "c1",
  name: "Create Account",
  method: "POST",
  kind: "rest",
  url: "https://myorg.my.salesforce.com/services/data/v66.0/sobjects/Account",
  origin: "https://myorg.my.salesforce.com",
  body: { Name: "Acme" },
  createdAt: Date.now(),
  ...over,
});

describe("originOf", () => {
  it("extracts origin", () => {
    expect(originOf("https://x.com/foo?bar=1")).toBe("https://x.com");
  });
  it("returns empty on invalid", () => {
    expect(originOf("not a url")).toBe("");
  });
});

describe("buildPostmanCollection", () => {
  it("builds a v2.1 collection with variables and bearer auth", () => {
    const out = buildPostmanCollection("My Collection", [item({})]);
    expect((out.info as { name: string }).name).toBe("My Collection");
    expect((out.info as { schema: string }).schema).toContain("v2.1.0");
    const vars = (out.variable as Array<{ key: string }>).map((v) => v.key);
    expect(vars).toContain("baseUrl");
    expect(vars).toContain("accessToken");
  });

  it("substitutes origin with {{baseUrl}} when matching", () => {
    const out = buildPostmanCollection("c", [item({})]);
    const items = out.item as Array<{ request: { url: { raw: string } } }>;
    expect(items[0].request.url.raw).toBe(
      "{{baseUrl}}/services/data/v66.0/sobjects/Account"
    );
  });

  it("preserves url when origin doesn't match", () => {
    const out = buildPostmanCollection("c", [
      item({
        origin: "https://other.com",
        url: "https://myorg.my.salesforce.com/services/data/v66.0/sobjects/Contact",
      }),
    ]);
    const items = out.item as Array<{ request: { url: { raw: string } } }>;
    expect(items[0].request.url.raw).toBe(
      "https://myorg.my.salesforce.com/services/data/v66.0/sobjects/Contact"
    );
  });

  it("first origin sets baseUrl", () => {
    const out = buildPostmanCollection("c", [
      item({}),
      item({
        url: "https://other.com/x",
        origin: "https://other.com",
      }),
    ]);
    const vars = out.variable as Array<{ key: string; value: string }>;
    const baseUrl = vars.find((v) => v.key === "baseUrl");
    expect(baseUrl?.value).toBe("https://myorg.my.salesforce.com");
  });
});
