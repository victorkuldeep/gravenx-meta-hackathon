import { describe, it, expect } from "vitest";
import { parseFrontdoorUrl, looksLikeFrontdoor } from "./frontdoor";

describe("parseFrontdoorUrl", () => {
  it("extracts instanceUrl and sid", () => {
    const url =
      "https://myorg.my.salesforce.com/secur/frontdoor.jsp?sid=00D!ARw.AAAA.AbCdEf";
    expect(parseFrontdoorUrl(url)).toEqual({
      instanceUrl: "https://myorg.my.salesforce.com",
      token: "00D!ARw.AAAA.AbCdEf",
    });
  });

  it("strips trailing slash from origin", () => {
    const url = "https://myorg.my.salesforce.com/secur/frontdoor.jsp?sid=abc";
    const { instanceUrl } = parseFrontdoorUrl(url);
    expect(instanceUrl).toBe("https://myorg.my.salesforce.com");
  });

  it("rejects non-https", () => {
    expect(() =>
      parseFrontdoorUrl("http://myorg.my.salesforce.com/secur/frontdoor.jsp?sid=abc")
    ).toThrow(/https/);
  });

  it("rejects when path is not frontdoor.jsp", () => {
    expect(() => parseFrontdoorUrl("https://myorg.my.salesforce.com/?sid=abc")).toThrow(
      /frontdoor/
    );
  });

  it("rejects when sid is missing", () => {
    expect(() =>
      parseFrontdoorUrl("https://myorg.my.salesforce.com/secur/frontdoor.jsp")
    ).toThrow(/sid/);
  });

  it("rejects empty input", () => {
    expect(() => parseFrontdoorUrl("")).toThrow();
    expect(() => parseFrontdoorUrl("   ")).toThrow();
  });

  it("rejects malformed URL", () => {
    expect(() => parseFrontdoorUrl("not a url")).toThrow(/URL/);
  });
});

describe("looksLikeFrontdoor", () => {
  it("returns true for matching patterns", () => {
    expect(looksLikeFrontdoor("https://x.my.salesforce.com/secur/frontdoor.jsp?sid=abc")).toBe(true);
    expect(looksLikeFrontdoor("  HTTPS://x.com/frontdoor.jsp?sid=abc  ")).toBe(true);
  });
  it("returns false for non-frontdoor links", () => {
    expect(looksLikeFrontdoor("https://x.com/login")).toBe(false);
    expect(looksLikeFrontdoor("https://x.com/frontdoor.jsp")).toBe(false);
    expect(looksLikeFrontdoor("http://x.com/frontdoor.jsp?sid=abc")).toBe(false);
  });
});
