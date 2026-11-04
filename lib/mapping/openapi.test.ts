import { describe, expect, it } from "vitest";
import {
  descendantLeafIds,
  flattenFields,
  generateSample,
  ingestMappingSpec,
  schemaForSide,
} from "./openapi";

const ORDER_SCHEMA = {
  type: "object",
  required: ["orderNumber"],
  properties: {
    orderNumber: { type: "string", example: "A1" },
    priority: { type: "string", enum: ["low", "high"], default: "low" },
    customer: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        vip: { type: "boolean" },
      },
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sku: { type: "string" },
          qty: { type: "integer" },
        },
      },
    },
  },
};

describe("flattenFields", () => {
  it("flattens nested objects and arrays with dotted [] ids", () => {
    const ids = flattenFields(ORDER_SCHEMA).map((f) => f.id);
    expect(ids).toContain("orderNumber");
    expect(ids).toContain("customer");
    expect(ids).toContain("customer.name");
    expect(ids).toContain("lines[]");
    expect(ids).toContain("lines[].sku");
  });

  it("marks containers and required flags", () => {
    const fields = flattenFields(ORDER_SCHEMA);
    expect(fields.find((f) => f.id === "customer")?.container).toBe(true);
    expect(fields.find((f) => f.id === "customer.name")?.container).toBe(false);
    expect(fields.find((f) => f.id === "orderNumber")?.required).toBe(true);
    expect(fields.find((f) => f.id === "customer.vip")?.required).toBe(false);
  });

  it("merges allOf branches", () => {
    const fields = flattenFields({
      allOf: [{ type: "object", properties: { a: { type: "string" } } }, { type: "object", properties: { b: { type: "integer" } } }],
    });
    expect(fields.map((f) => f.id)).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("descendantLeafIds expands container subtrees", () => {
    const fields = flattenFields(ORDER_SCHEMA);
    expect(descendantLeafIds(fields, "customer").sort()).toEqual(["customer.name", "customer.vip"]);
    expect(descendantLeafIds(fields, "lines[]")).toEqual(["lines[].sku", "lines[].qty"]);
  });
});

describe("generateSample", () => {
  it("includes only selected fields, single-element arrays", () => {
    const sample = generateSample(ORDER_SCHEMA, new Set(["orderNumber", "lines[].sku"]));
    expect(sample).toEqual({ orderNumber: "A1", lines: [{ sku: "string" }] });
  });

  it("honors enum default over placeholder and example first", () => {
    const sample = generateSample(ORDER_SCHEMA, new Set(["priority"]));
    expect(sample).toEqual({ priority: "low" });
  });

  it("selecting a container subtree via leaf ids keeps ancestors", () => {
    const sample = generateSample(ORDER_SCHEMA, new Set(["customer.name", "customer.vip"]));
    expect(sample).toEqual({ customer: { name: "string", vip: true } });
  });
});

const SPEC = {
  openapi: "3.0.3",
  info: { title: "Orders", version: "1" },
  paths: {
    "/orders": {
      post: {
        operationId: "createOrder",
        summary: "Create order",
        requestBody: {
          content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } },
        },
        responses: {
          "201": {
            description: "created",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } },
          },
        },
      },
    },
  },
  components: { schemas: { Order: ORDER_SCHEMA } },
};

describe("ingestMappingSpec", () => {
  it("ingests a JSON spec and lists operations", async () => {
    const ingested = await ingestMappingSpec(JSON.stringify(SPEC), "orders.json");
    expect(ingested.errors).toEqual([]);
    expect(ingested.operations.map((o) => o.id)).toEqual(["POST /orders"]);
    const op = ingested.operations[0];
    const req = schemaForSide(op, "request");
    expect(req?.label).toBe("request body");
    const res = schemaForSide(op, "response");
    expect(res?.label).toBe("201 response");
    const fields = flattenFields(req?.schema);
    expect(fields.map((f) => f.id)).toContain("lines[].sku");
    const sample = generateSample(req?.schema, new Set(["orderNumber"]));
    expect(sample).toEqual({ orderNumber: "A1" });
  });

  it("rejects non-OpenAPI documents with a clear error", async () => {
    const ingested = await ingestMappingSpec(JSON.stringify({ hello: 1 }), "x.json");
    expect(ingested.operations).toEqual([]);
    expect(ingested.errors.length).toBeGreaterThan(0);
  });

  it("refuses external refs without fetching", async () => {
    const doc = { openapi: "3.0.0", info: { title: "t", version: "1" }, paths: {}, components: { schemas: { A: { $ref: "https://example.com/s.json" } } } };
    const ingested = await ingestMappingSpec(JSON.stringify(doc), "x.json");
    expect(ingested.operations).toEqual([]);
    expect(ingested.errors.join(" ").toLowerCase()).toMatch(/external/);
  });
});
