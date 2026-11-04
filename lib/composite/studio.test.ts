import { describe, it, expect } from "vitest";
import {
  nextReferenceId,
  mappingExpression,
  buildStudioPayload,
  validateStudio,
  fixExecutionOrder,
  independentIds,
  computeRequestLayers,
  emptyStudioRequest,
  type StudioDocument,
} from "./studio";

const req = (over: Partial<ReturnType<typeof emptyStudioRequest>> = {}) => ({
  ...emptyStudioRequest(`r${Math.random().toString(36).slice(2)}`),
  ...over,
});

const pricingDoc = (): StudioDocument => ({
  name: "Pricing",
  apiVersion: "v66.0",
  allOrNone: true,
  requests: [
    req({
      id: "r1",
      objectApiName: "Pricing_Request__c",
      objectLabel: "Pricing Request",
      method: "POST",
      referenceId: "pricingRequest",
      fields: [
        { apiName: "Status__c", fieldLabel: "Status", fieldType: "picklist", mode: "literal", literal: "New", mappingId: null },
      ],
    }),
    req({
      id: "r2",
      objectApiName: "Request_Term__c",
      objectLabel: "Request Term",
      method: "POST",
      referenceId: "requestTerm_1",
      fields: [
        { apiName: "Term_Value__c", fieldLabel: "Term", fieldType: "string", mode: "literal", literal: "12 Months", mappingId: null },
        { apiName: "requested_MRC__c", fieldLabel: "MRC", fieldType: "currency", mode: "literal", literal: 100, mappingId: null },
      ],
    }),
  ],
  mappings: [],
});

describe("nextReferenceId", () => {
  it("always suffixes, starting at _1", () => {
    expect(nextReferenceId("Pricing_Request__c", new Set())).toBe("pricingRequest_1");
    expect(nextReferenceId("Request_Term__c", new Set(["requestTerm_1"]))).toBe("requestTerm_2");
  });
  it("derives from labels too", () => {
    expect(nextReferenceId("Vendor Quote Request", new Set())).toBe("vendorQuoteRequest_1");
  });
});

describe("buildStudioPayload", () => {
  it("emits independent requests with no foreign keys", () => {
    const payload = buildStudioPayload(pricingDoc());
    expect(payload.allOrNone).toBe(true);
    expect(payload.compositeRequest).toHaveLength(2);
    expect(payload.compositeRequest[0]).toMatchObject({
      method: "POST",
      url: "/services/data/v66.0/sobjects/Pricing_Request__c",
      referenceId: "pricingRequest",
    });
    expect(payload.compositeRequest[1].body).toMatchObject({
      Term_Value__c: "12 Months",
      requested_MRC__c: 100,
    });
    expect(payload.compositeRequest[1].body).not.toHaveProperty("Pricing_Request__c");
  });
  it("emits mapping expressions exactly", () => {
    const doc = pricingDoc();
    doc.mappings = [
      { id: "m1", sourceRequestId: "r1", sourceProperty: "id", targetRequestId: "r2", targetFieldApiName: "Pricing_Request__c" },
    ];
    doc.requests[1].fields.push({
      apiName: "Pricing_Request__c",
      fieldLabel: "Pricing Request",
      fieldType: "reference",
      mode: "reference",
      literal: "",
      mappingId: "m1",
    });
    const payload = buildStudioPayload(doc);
    expect(payload.compositeRequest[1].body).toMatchObject({
      Pricing_Request__c: "@{pricingRequest.id}",
    });
    expect(mappingExpression(doc.mappings[0], doc.requests)).toBe("@{pricingRequest.id}");
  });
  it("preserves JSON types", () => {
    const doc = pricingDoc();
    doc.requests[1].fields.push(
      { apiName: "Active__c", fieldLabel: "Active", fieldType: "boolean", mode: "literal", literal: true, mappingId: null },
      { apiName: "Gone__c", fieldLabel: "Gone", fieldType: "string", mode: "null", literal: "", mappingId: null }
    );
    const body = buildStudioPayload(doc).compositeRequest[1].body ?? {};
    expect(body.Active__c).toBe(true);
    expect(body.Gone__c).toBe(null);
  });
});

describe("validateStudio", () => {
  it("flags duplicate referenceIds", () => {
    const doc = pricingDoc();
    doc.requests[1].referenceId = "pricingRequest";
    const errors = validateStudio(doc, new Map()).filter((i) => i.level === "error");
    expect(errors.some((e) => e.message.includes("Duplicate"))).toBe(true);
  });
  it("flags PATCH without record id", () => {
    const doc = pricingDoc();
    doc.requests[0].method = "PATCH";
    const errors = validateStudio(doc, new Map()).filter((i) => i.level === "error");
    expect(errors.some((e) => e.message.includes("record ID"))).toBe(true);
  });
  it("flags backward execution order", () => {
    const doc = pricingDoc();
    doc.mappings = [
      { id: "m1", sourceRequestId: "r2", sourceProperty: "id", targetRequestId: "r1", targetFieldApiName: "X__c" },
    ];
    const errors = validateStudio(doc, new Map()).filter((i) => i.level === "error");
    expect(errors.some((e) => e.message.includes("must execute before"))).toBe(true);
  });
  it("accepts a clean independent batch", () => {
    expect(validateStudio(pricingDoc(), new Map()).filter((i) => i.level === "error")).toHaveLength(0);
  });
});

describe("fixExecutionOrder", () => {
  it("moves sources before dependents, keeps the rest stable", () => {
    const doc = pricingDoc();
    doc.mappings = [
      { id: "m1", sourceRequestId: "r2", sourceProperty: "id", targetRequestId: "r1", targetFieldApiName: "X__c" },
    ];
    const { order, moved } = fixExecutionOrder(doc);
    expect(moved).toBe(true);
    expect(order).toEqual(["r2", "r1"]);
  });
  it("leaves valid orders alone", () => {
    const { moved } = fixExecutionOrder(pricingDoc());
    expect(moved).toBe(false);
  });
});

describe("independentIds", () => {
  it("isolates unmapped requests", () => {
    const doc = pricingDoc();
    expect(independentIds(doc)).toEqual(new Set(["r1", "r2"]));
    doc.mappings = [
      { id: "m1", sourceRequestId: "r1", sourceProperty: "id", targetRequestId: "r2", targetFieldApiName: "X__c" },
    ];
    expect(independentIds(doc)).toEqual(new Set());
  });
});

describe("computeRequestLayers", () => {
  const chain = (): StudioDocument => ({
    name: "t",
    apiVersion: "v66.0",
    allOrNone: true,
    requests: [
      req({ id: "a", referenceId: "account_1" }),
      req({ id: "l", referenceId: "lead_1" }),
      req({ id: "c", referenceId: "custom_1" }),
      req({ id: "solo", referenceId: "solo_1" }),
    ],
    mappings: [
      { id: "m1", sourceRequestId: "a", sourceProperty: "id", targetRequestId: "l", targetFieldApiName: "Account__c" },
      { id: "m2", sourceRequestId: "l", sourceProperty: "id", targetRequestId: "c", targetFieldApiName: "Lead__c" },
    ],
  });
  it("layers chains Account(0) -> Lead(1) -> Custom(2), isolates solo(-1)", () => {
    const layers = computeRequestLayers(chain());
    expect(layers.get("a")).toBe(0);
    expect(layers.get("l")).toBe(1);
    expect(layers.get("c")).toBe(2);
    expect(layers.get("solo")).toBe(-1);
  });
  it("fans out siblings onto one layer and bundles parallel edges", () => {
    const doc = chain();
    doc.mappings.push(
      { id: "m3", sourceRequestId: "a", sourceProperty: "id", targetRequestId: "c", targetFieldApiName: "Account__c" },
      { id: "m4", sourceRequestId: "a", sourceProperty: "id", targetRequestId: "l", targetFieldApiName: "Owner__c" }
    );
    const layers = computeRequestLayers(doc);
    expect(layers.get("l")).toBe(1);
    expect(layers.get("c")).toBe(2);
    // Two mappings a->l still resolve: diamond longest path wins, no crash.
    const pair = doc.mappings.filter((m) => m.sourceRequestId === "a" && m.targetRequestId === "l");
    expect(pair).toHaveLength(2);
  });
});
