import { describe, expect, it } from "vitest";
import { resolveProxyBase } from "./proxy";

/** Regression net for the proxy boundary (the Groq /models CORS failure). */
describe("resolveProxyBase", () => {
  it("accepts provider origins with versioned paths", () => {
    expect(resolveProxyBase("https://api.groq.com/openai/v1")).toEqual({ ok: true, base: "https://api.groq.com/openai/v1" });
    expect(resolveProxyBase("https://openrouter.ai/api/v1/")).toEqual({ ok: true, base: "https://openrouter.ai/api/v1" });
  });

  it("rejects non-https, credentials and empty input", () => {
    expect(resolveProxyBase("http://x.test/v1").ok).toBe(false);
    expect(resolveProxyBase("https://user:pass@x.test/v1").ok).toBe(false);
    expect(resolveProxyBase("   ").ok).toBe(false);
    expect(resolveProxyBase("not a url").ok).toBe(false);
  });

  it("blocks internal hosts", () => {
    expect(resolveProxyBase("https://localhost:11434/v1").ok).toBe(false);
    expect(resolveProxyBase("https://127.0.0.1/v1").ok).toBe(false);
    expect(resolveProxyBase("https://169.254.169.254/").ok).toBe(false);
  });
});
