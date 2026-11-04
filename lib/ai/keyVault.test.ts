import { describe, expect, it, beforeEach } from "vitest";
import { clearProviderKeys, getProviderKey, hasProviderKey, keyedProviders, setProviderKey } from "./keyVault";

beforeEach(() => {
  clearProviderKeys();
  sessionStorage.clear();
});

describe("ai key vault", () => {
  it("round-trips keys and mirrors sessionStorage", () => {
    setProviderKey("groq", "gsk_test");
    expect(getProviderKey("groq")).toBe("gsk_test");
    expect(hasProviderKey("groq")).toBe(true);
    expect(JSON.parse(sessionStorage.getItem("gravenx_ai_keys_v1") ?? "{}")).toEqual({ groq: "gsk_test" });
  });

  it("blank key removes the entry", () => {
    setProviderKey("groq", "gsk_test");
    setProviderKey("groq", "   ");
    expect(hasProviderKey("groq")).toBe(false);
    expect(keyedProviders()).toEqual([]);
  });

  it("clear wipes memory and storage", () => {
    setProviderKey("openai", "sk-x");
    clearProviderKeys();
    expect(getProviderKey("openai")).toBe("");
    expect(sessionStorage.getItem("gravenx_ai_keys_v1")).toBeNull();
  });

  it("ignores corrupt store content", () => {
    sessionStorage.setItem("gravenx_ai_keys_v1", "[[broken");
    expect(getProviderKey("groq")).toBe("");
  });
});
