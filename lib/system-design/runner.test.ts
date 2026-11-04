"use client";

import { describe, it, expect } from "vitest";
import {
  preflightRun,
  redactHeaders,
  endpointForStorage,
  clampTimeoutMs,
  normalizeAuthToken,
  RUNNER_MAX_TIMEOUT_MS,
} from "./runner";

describe("runner policy", () => {
  it("passes a well-formed https call to the declared host", () => {
    const v = preflightRun({
      baseUrl: "https://api.acme.test",
      path: "/v1/orders",
      method: "POST",
      allowHost: "api.acme.test",
      timeoutMs: 10000,
      bodyBytes: 100,
    });
    expect(v.ok).toBe(true);
    expect(v.url).toBe("https://api.acme.test/v1/orders");
  });

  it("blocks http, host mismatch, internals and bad methods", () => {
    const base = { path: "/x", method: "GET", allowHost: "api.acme.test", timeoutMs: 5000, bodyBytes: 0 };
    expect(preflightRun({ ...base, baseUrl: "http://api.acme.test" }).ok).toBe(false);
    expect(preflightRun({ ...base, baseUrl: "https://evil.test" }).reasons.join(" ")).toMatch(/declared host/);
    expect(preflightRun({ ...base, baseUrl: "https://localhost:8080" }).ok).toBe(false);
    expect(preflightRun({ ...base, baseUrl: "https://169.254.169.254" }).ok).toBe(false);
    expect(preflightRun({ ...base, baseUrl: "https://10.1.2.3" }).ok).toBe(false);
    expect(preflightRun({ ...base, baseUrl: "https://api.acme.test", method: "BREW" }).ok).toBe(false);
    expect(preflightRun({ ...base, baseUrl: "not a url" }).ok).toBe(false);
  });

  it("clamps timeouts and caps bodies", () => {
    expect(clampTimeoutMs(999999)).toBe(RUNNER_MAX_TIMEOUT_MS);
    expect(clampTimeoutMs(NaN)).toBe(25000);
    expect(clampTimeoutMs(500)).toBe(1000);
    const v = preflightRun({
      baseUrl: "https://a.test", path: "/", method: "POST",
      allowHost: "a.test", timeoutMs: 99999, bodyBytes: 2 * 1024 * 1024,
    });
    expect(v.ok).toBe(false);
    expect(v.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("redacts secret-bearing headers only", () => {
    const out = redactHeaders({
      Authorization: "Bearer xyz",
      Cookie: "sid=1",
      "X-Api-Key": "k",
      "Content-Type": "application/json",
    });
    expect(out.Authorization).toBe("•••redacted•••");
    expect(out.Cookie).toBe("•••redacted•••");
    expect(out["X-Api-Key"]).toBe("•••redacted•••");
    expect(out["Content-Type"]).toBe("application/json");
  });

  it("strips query strings for storage", () => {
    expect(endpointForStorage("https://a.test/v1?token=secret")).toBe("https://a.test/v1");
    expect(endpointForStorage("garbage")).toBe("garbage");
  });

  it("normalizes pasted tokens (Bearer prefix, stray whitespace)", () => {
    expect(normalizeAuthToken("gsk_abc123")).toBe("gsk_abc123");
    expect(normalizeAuthToken("Bearer gsk_abc123")).toBe("gsk_abc123");
    expect(normalizeAuthToken("bearer   gsk_abc123  ")).toBe("gsk_abc123");
    expect(normalizeAuthToken("  gsk_abc123\n")).toBe("gsk_abc123");
    expect(normalizeAuthToken("")).toBe("");
    expect(normalizeAuthToken(undefined)).toBe("");
  });

  it("explains EVENT/QUERY as non-callable instead of a generic method error", () => {
    const base = {
      baseUrl: "https://api.acme.test",
      path: "/x",
      allowHost: "api.acme.test",
      timeoutMs: 5000,
      bodyBytes: 0,
    };
    for (const method of ["EVENT", "QUERY"]) {
      const v = preflightRun({ ...base, method });
      expect(v.ok).toBe(false);
      expect(v.reasons.join(" ")).toMatch(/not HTTP-callable/);
    }
  });
});
