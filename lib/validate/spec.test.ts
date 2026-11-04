import { describe, expect, it } from "vitest";
import {
  MAX_SPEC_BYTES,
  detectFormat,
  detectOpenApiVersion,
  findExternalRefs,
  ingestSpec,
  parseSpecText,
} from "./spec";

const MINIMAL_30 = {
  openapi: "3.0.3",
  info: { title: "T", version: "1" },
  paths: {
    "/orders": {
      post: {
        operationId: "createOrder",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: { "201": { description: "Created" } },
      },
    },
  },
};

describe("detectFormat", () => {
  it("uses extension first", () => {
    expect(detectFormat("api.json", "openapi: 3.0.0")).toBe("json");
    expect(detectFormat("api.yaml", "{}")).toBe("yaml");
    expect(detectFormat("api.yml", "{}")).toBe("yaml");
  });
  it("sniffs content without extension", () => {
    expect(detectFormat("spec", '{"openapi":"3.0.0"}')).toBe("json");
    expect(detectFormat("spec", "openapi: 3.0.0")).toBe("yaml");
  });
});

describe("parseSpecText", () => {
  it("parses JSON", () => {
    const { document } = parseSpecText('{"a":1}', "json");
    expect(document).toEqual({ a: 1 });
  });
  it("parses YAML", () => {
    const { document } = parseSpecText("a: 1\nb:\n  - 2\n", "yaml");
    expect(document).toEqual({ a: 1, b: [2] });
  });
  it("reports malformed JSON without throwing", () => {
    const { document, diagnostic } = parseSpecText('{"a":}', "json");
    expect(document).toBeUndefined();
    expect(diagnostic?.severity).toBe("error");
  });
  it("reports malformed YAML without throwing", () => {
    const { diagnostic } = parseSpecText("a:\n  b: 1\n c: bad-indent\n", "yaml");
    expect(diagnostic?.severity).toBe("error");
  });
});

describe("detectOpenApiVersion", () => {
  it("reads the version", () => {
    expect(detectOpenApiVersion({ openapi: "3.1.0" })).toBe("3.1.0");
    expect(detectOpenApiVersion({ swagger: "2.0" })).toBeUndefined();
    expect(detectOpenApiVersion(null)).toBeUndefined();
  });
});

describe("findExternalRefs", () => {
  it("flags remote refs, ignores local", () => {
    const doc = {
      a: { $ref: "#/components/x" },
      b: { $ref: "https://example.com/s.json" },
      c: [{ $ref: "./other.yaml#/y" }],
    };
    expect(findExternalRefs(doc)).toEqual(["https://example.com/s.json", "./other.yaml#/y"]);
  });
});

describe("ingestSpec", () => {
  it("rejects oversize specs", async () => {
    const r = await ingestSpec({ fileName: "big.json", text: "{}", byteSize: MAX_SPEC_BYTES + 1 });
    expect(r.fatal).toBe(true);
    expect(r.diagnostics[0].id).toBe("size-limit");
  });
  it("rejects non-OpenAPI documents", async () => {
    const r = await ingestSpec({ fileName: "api.json", text: '{"foo":1}', byteSize: 9 });
    expect(r.fatal).toBe(true);
    expect(r.diagnostics[0].id).toBe("no-version");
  });
  it("rejects Swagger 2.0 with a targeted message", async () => {
    const r = await ingestSpec({ fileName: "api.json", text: '{"swagger":"2.0"}', byteSize: 17 });
    expect(r.fatal).toBe(true);
    expect(r.diagnostics[0].id).toBe("swagger-2.0");
  });
  it("rejects external refs without fetching", async () => {
    const doc = { ...MINIMAL_30, paths: { "/x": { get: { responses: { "200": { description: "d", content: { "application/json": { schema: { $ref: "https://evil.example/s.json" } } } } } } } } };
    const text = JSON.stringify(doc);
    const r = await ingestSpec({ fileName: "api.json", text, byteSize: text.length });
    expect(r.fatal).toBe(true);
    expect(r.diagnostics.some((d) => d.id === "external-refs")).toBe(true);
  });
  it("ingests a minimal OpenAPI 3.0 JSON spec", async () => {
    const text = JSON.stringify(MINIMAL_30);
    const r = await ingestSpec({ fileName: "orders.json", text, byteSize: text.length });
    expect(r.fatal).toBe(false);
    expect(r.contract.version).toBe("3.0.3");
    expect(r.dereferenced).toBeDefined();
  });
  it("ingests a YAML spec", async () => {
    const text = "openapi: 3.0.3\ninfo:\n  title: T\n  version: '1'\npaths: {}\n";
    const r = await ingestSpec({ fileName: "api.yaml", text, byteSize: text.length });
    expect(r.fatal).toBe(false);
    expect(r.contract.format).toBe("openapi-yaml");
  });
});
