import { describe, expect, it, beforeEach } from "vitest";
import { clearProviderKeys, setProviderKey } from "./keyVault";
import { scrubSecrets } from "@/lib/system-design/credentials";

const STORE_KEY = "gravenx_ai_keys_v1";

beforeEach(() => {
  clearProviderKeys();
  sessionStorage.clear();
  localStorage.clear();
});

/**
 * Key-confinement contract: BYOK provider keys may live in tab memory +
 * one sessionStorage mirror and nowhere else. They must never reach
 * localStorage, IDB, exports or history - and transcripts scrub them.
 */
describe("ai key confinement", () => {
  it("stores keys only under the single session key", () => {
    setProviderKey("openrouter", "sk-or-secret-123");
    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.key(0)).toBe(STORE_KEY);
    expect(localStorage.length).toBe(0);
  });

  it("clearing removes every trace", () => {
    setProviderKey("groq", "gsk_secret");
    clearProviderKeys();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("transcripts scrub key material via the shared scrubber", () => {
    const key = "sk-or-secret-123";
    const vault = { OPENROUTER: key };
    const text = `tried model with ${key} and failed`;
    const scrubbed = scrubSecrets(text, vault);
    expect(scrubbed).not.toContain(key);
    expect(scrubbed).toContain("***");
  });

  it("short/empty values are not treated as scrub targets", () => {
    // Guards against "***"-ing ordinary words: scrubber ignores < 3 chars.
    expect(scrubSecrets("ask ai anything", { X: "ab" })).toBe("ask ai anything");
  });
});
