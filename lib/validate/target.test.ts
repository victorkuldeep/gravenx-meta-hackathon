import { describe, expect, it } from "vitest";
import { validatePayload } from "./engine";
import { loadContract } from "./load";
import { resolveTarget } from "./target";
import { SAMPLE_SPEC } from "./sample";

async function sampleContract() {
  const c = await loadContract("example.json", SAMPLE_SPEC, SAMPLE_SPEC.length);
  if (c.status === "invalid" || c.status === "unsupported") throw new Error("sample failed to load");
  return c;
}

describe("resolveTarget", () => {
  it("resolves the exact request schema", async () => {
    const c = await sampleContract();
    const r = resolveTarget(c, "POST /orders", "request", undefined, "application/json");
    expect(r.target?.operationId).toBe("POST /orders");
    expect(r.target?.schema).toBeDefined();
  });

  it("resolves the exact 201 response schema", async () => {
    const c = await sampleContract();
    const r = resolveTarget(c, "POST /orders", "response", "201", "application/json");
    expect(r.target?.statusCode).toBe("201");
  });

  it("never substitutes another status code", async () => {
    const c = await sampleContract();
    const r = resolveTarget(c, "POST /orders", "response", "200", "application/json");
    expect(r.target).toBeUndefined();
    expect(r.blocked).toMatch(/200/);
  });

  it("explains body-less statuses instead of validating", async () => {
    const c = await sampleContract();
    const r = resolveTarget(c, "POST /orders", "response", "400", "application/json");
    expect(r.target).toBeUndefined();
    expect(r.blocked).toBeTruthy();
  });

  it("blocks unknown operations", async () => {
    const c = await sampleContract();
    const r = resolveTarget(c, "DELETE /nope", "request", undefined, "application/json");
    expect(r.blocked).toBeTruthy();
  });
});

describe("OpenAPI 3.1 end-to-end", () => {
  const SPEC_31 = JSON.stringify({
    openapi: "3.1.0",
    info: { title: "T", version: "1" },
    paths: {
      "/users": {
        post: {
          operationId: "createUser",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string" },
                    nickname: { type: ["string", "null"] },
                    tags: { type: "array", prefixItems: [{ type: "string" }] },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created" } },
        },
      },
    },
  });

  it("loads, resolves and validates natively (no adapter rewrite)", async () => {
    const c = await loadContract("api-31.json", SPEC_31, SPEC_31.length);
    expect(c.status).toBe("parsed");
    expect(c.version).toBe("3.1.0");
    const r = resolveTarget(c, "POST /users", "request", undefined, "application/json");
    expect(r.target).toBeDefined();
    // Native 3.1 union type passes through untouched.
    expect(JSON.stringify(r.target!.schema)).toContain('"type":["string","null"]');
    const ok = validatePayload(r.target!, { name: "Ada", nickname: null, tags: ["x"] });
    expect(ok.report?.outcome).toBe("valid");
    const bad = validatePayload(r.target!, { nickname: 7 });
    expect(bad.report?.outcome).toBe("invalid");
  });
});
