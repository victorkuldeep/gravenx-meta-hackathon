import { beforeEach, describe, expect, it } from "vitest";
import { getPmoDefaults, setPmoDefaults } from "./defaults";

beforeEach(() => {
  localStorage.clear();
});

describe("per-org pmo defaults", () => {
  it("round-trips non-secret defaults per org", () => {
    setPmoDefaults({ provider: "jira", projectKey: "ACME", issueTypeId: "10001" }, "org:00D1");
    setPmoDefaults({ provider: "snow", snowInstance: "https://acme.service-now.com", snowTable: "incident" }, "org:00D2");
    expect(getPmoDefaults("org:00D1")).toEqual({ provider: "jira", projectKey: "ACME", issueTypeId: "10001" });
    expect(getPmoDefaults("org:00D2")).toEqual({
      provider: "snow",
      snowInstance: "https://acme.service-now.com",
      snowTable: "incident",
    });
    expect(getPmoDefaults("org:00D3")).toEqual({});
  });

  it("merges patches without clobbering", () => {
    setPmoDefaults({ provider: "jira", projectKey: "ACME" }, "org:1");
    setPmoDefaults({ issueTypeId: "10001" }, "org:1");
    expect(getPmoDefaults("org:1")).toEqual({ provider: "jira", projectKey: "ACME", issueTypeId: "10001" });
  });

  it("ignores corrupt stores and unknown shapes", () => {
    localStorage.setItem("gravenx_pmo_defaults_v1", "[[broken");
    expect(getPmoDefaults("org:1")).toEqual({});
    localStorage.setItem("gravenx_pmo_defaults_v1", JSON.stringify({ "org:1": { provider: "vault", token: "x" } }));
    // Unknown providers drop; secrets never belong here.
    expect(getPmoDefaults("org:1")).toEqual({});
  });
});
