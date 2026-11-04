import { describe, expect, it, beforeEach } from "vitest";
import {
  clearProviderEndpoints,
  getProviderEndpoint,
  hasProviderEndpoint,
  setProviderEndpoint,
} from "./endpointStore";
import { AI_ACTIVATE_EVENT, dispatchAiActivate, subscribeAiActivate } from "./activateEvent";

beforeEach(() => {
  clearProviderEndpoints();
  sessionStorage.clear();
});

describe("ai endpoint store", () => {
  it("round-trips endpoints and mirrors sessionStorage", () => {
    setProviderEndpoint("custom", "https://my-host/v1/");
    expect(getProviderEndpoint("custom")).toBe("https://my-host/v1");
    expect(hasProviderEndpoint("custom")).toBe(true);
    expect(JSON.parse(sessionStorage.getItem("gravenx_ai_endpoints_v1") ?? "{}")).toEqual({
      custom: "https://my-host/v1",
    });
  });

  it("blank endpoint removes the entry", () => {
    setProviderEndpoint("custom", "https://my-host/v1");
    setProviderEndpoint("custom", "   ");
    expect(hasProviderEndpoint("custom")).toBe(false);
  });

  it("clear wipes memory and storage", () => {
    setProviderEndpoint("custom", "https://my-host/v1");
    clearProviderEndpoints();
    expect(getProviderEndpoint("custom")).toBe("");
    expect(sessionStorage.getItem("gravenx_ai_endpoints_v1")).toBeNull();
  });

  it("ignores corrupt store content", () => {
    sessionStorage.setItem("gravenx_ai_endpoints_v1", "[[broken");
    expect(getProviderEndpoint("custom")).toBe("");
  });
});

describe("ai activate event", () => {
  it("delivers provider + model to subscribers, never keys", () => {
    const seen: Array<{ providerId: string; modelId: string }> = [];
    const unsub = subscribeAiActivate((d) => seen.push(d));
    dispatchAiActivate("groq", "llama-3.3-70b");
    unsub();
    dispatchAiActivate("openai", "gpt-4o");
    expect(seen).toEqual([{ providerId: "groq", modelId: "llama-3.3-70b" }]);
  });

  it("ignores malformed dispatches", () => {
    let calls = 0;
    const unsub = subscribeAiActivate(() => calls++);
    window.dispatchEvent(new CustomEvent(AI_ACTIVATE_EVENT, { detail: null }));
    expect(calls).toBe(0);
    unsub();
  });
});
