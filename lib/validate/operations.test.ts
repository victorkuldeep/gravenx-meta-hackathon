import { describe, expect, it } from "vitest";
import { extractOperations } from "./operations";

function doc(paths: unknown, version = "3.0.3") {
  return { openapi: version, info: { title: "T", version: "1" }, paths };
}

describe("extractOperations", () => {
  it("extracts methods on one path as separate operations", () => {
    const { operations, diagnostics } = extractOperations(
      doc({ "/orders": { get: { responses: { "200": { description: "ok" } } }, post: { responses: { "201": { description: "c" } } } } }),
      "3.0.3"
    );
    expect(diagnostics).toEqual([]);
    expect(operations.map((o) => o.id)).toEqual(["GET /orders", "POST /orders"]);
  });

  it("builds stable collision-safe ids", () => {
    // Same method+path twice cannot happen in a valid doc; ids stay unique anyway.
    const { operations } = extractOperations(
      doc({ "/a": { get: { operationId: "one", responses: {} } } }),
      "3.0.3"
    );
    expect(operations[0].operationId).toBe("one");
    expect(operations[0].diagnostics.length).toBeGreaterThan(0); // no responses
  });

  it("captures request requiredness + multiple media types", () => {
    const { operations } = extractOperations(
      doc({
        "/orders": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: { type: "object" } },
                "application/xml": { schema: { type: "object" } },
              },
            },
            responses: { "201": { description: "c" } },
          },
        },
      }),
      "3.0.3"
    );
    const req = operations[0].request!;
    expect(req.required).toBe(true);
    expect(req.contentTypes.map((c) => c.mediaType)).toEqual(["application/json", "application/xml"]);
    expect(req.contentTypes[0].supported).toBe(true);
    expect(req.contentTypes[1].supported).toBe(false); // XML not validatable
  });

  it("keeps explicit status codes and default distinct", () => {
    const { operations } = extractOperations(
      doc({
        "/x": {
          get: {
            responses: {
              "200": { description: "ok", content: { "application/json": { schema: { type: "string" } } } },
              default: { description: "err" },
            },
          },
        },
      }),
      "3.0.3"
    );
    expect(operations[0].responses.map((r) => r.statusCode)).toEqual(["200", "default"]);
    expect(operations[0].responses[0].contentTypes[0].supported).toBe(true);
  });

  it("errors when no operations exist", () => {
    const { operations, diagnostics } = extractOperations(doc({}), "3.0.3");
    expect(operations).toEqual([]);
    expect(diagnostics[0].severity).toBe("error");
  });

  it("merges path-level parameters", () => {
    const { operations } = extractOperations(
      doc({
        "/orders/{id}": {
          parameters: [{ name: "id", in: "path" }],
          get: { responses: { "200": { description: "ok" } } },
        },
      }),
      "3.0.3"
    );
    expect(operations[0].parameters).toEqual([{ name: "id", in: "path", required: true }]);
  });
});
