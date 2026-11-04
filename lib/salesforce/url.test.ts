import { describe, it, expect } from "vitest";
import {
  normalizeSalesforceUrl,
  validateSalesforceUrl,
  buildSalesforceApiUrl,
  screenTargetHost,
} from "./url";

describe("normalizeSalesforceUrl", () => {
  it("accepts https URLs and trims trailing slashes", () => {
    expect(normalizeSalesforceUrl("https://myorg.my.salesforce.com/")).toBe(
      "https://myorg.my.salesforce.com"
    );
  });

  it("strips paths to origin", () => {
    expect(normalizeSalesforceUrl("https://myorg.my.salesforce.com/some/path")).toBe(
      "https://myorg.my.salesforce.com"
    );
  });

  it("accepts http://localhost for dev", () => {
    expect(normalizeSalesforceUrl("http://localhost:3000")).toBe(
      "http://localhost:3000"
    );
  });

  it("rejects http on non-local hosts", () => {
    expect(() => normalizeSalesforceUrl("http://myorg.example.com")).toThrow(/HTTPS/);
  });

  it("rejects malformed URLs", () => {
    expect(() => normalizeSalesforceUrl("not-a-url")).toThrow();
  });
});

describe("validateSalesforceUrl", () => {
  it("returns true for valid", () => {
    expect(validateSalesforceUrl("https://myorg.my.salesforce.com")).toBe(true);
  });
  it("returns false for invalid", () => {
    expect(validateSalesforceUrl("http://myorg.example.com")).toBe(false);
  });
});

describe("buildSalesforceApiUrl", () => {
  it("builds a path under /services/data", () => {
    expect(
      buildSalesforceApiUrl("https://myorg.my.salesforce.com/", "v66.0", "sobjects")
    ).toBe("https://myorg.my.salesforce.com/services/data/v66.0/sobjects");
  });

  it("ensures path has a leading slash", () => {
    expect(buildSalesforceApiUrl("https://x.com", "v66.0", "/sobjects")).toBe(
      "https://x.com/services/data/v66.0/sobjects"
    );
  });

  it("prepends v when missing", () => {
    expect(buildSalesforceApiUrl("https://x.com", "66.0", "sobjects")).toBe(
      "https://x.com/services/data/v66.0/sobjects"
    );
  });
});

describe("screenTargetHost", () => {
  it("allows public hosts", () => {
    expect(screenTargetHost("myorg.my.salesforce.com")).toBeNull();
    expect(screenTargetHost("example.com")).toBeNull();
  });

  it("blocks localhost variants", () => {
    expect(screenTargetHost("localhost")).toMatch(/internal/);
    expect(screenTargetHost("api.localhost")).toMatch(/internal/);
    expect(screenTargetHost("x.local")).toMatch(/internal/);
    expect(screenTargetHost("x.internal")).toMatch(/internal/);
    expect(screenTargetHost("x.lan")).toMatch(/internal/);
    expect(screenTargetHost("x.home")).toMatch(/internal/);
    expect(screenTargetHost("x.invalid")).toMatch(/internal/);
  });

  it("blocks IPv4 loopback / private / link-local", () => {
    expect(screenTargetHost("127.0.0.1")).toMatch(/private|loopback|link-local/);
    expect(screenTargetHost("10.0.0.1")).toMatch(/private|loopback|link-local/);
    expect(screenTargetHost("192.168.1.1")).toMatch(/private|loopback|link-local/);
    expect(screenTargetHost("172.16.0.1")).toMatch(/private|loopback|link-local/);
    expect(screenTargetHost("172.31.255.255")).toMatch(/private|loopback|link-local/);
    expect(screenTargetHost("169.254.169.254")).toMatch(/private|loopback|link-local/);
    expect(screenTargetHost("0.0.0.0")).toMatch(/private|loopback|link-local/);
  });

  it("allows public IPv4", () => {
    expect(screenTargetHost("8.8.8.8")).toBeNull();
    expect(screenTargetHost("1.1.1.1")).toBeNull();
  });

  it("blocks IPv6 loopback / link-local / ULA", () => {
    expect(screenTargetHost("::1")).toMatch(/loopback|link-local|private/);
    expect(screenTargetHost("fe80::1")).toMatch(/loopback|link-local|private/);
    expect(screenTargetHost("fec0::1")).toMatch(/loopback|link-local|private/);
    expect(screenTargetHost("fc00::1")).toMatch(/loopback|link-local|private/);
    expect(screenTargetHost("fd00::1")).toMatch(/loopback|link-local|private/);
  });

  it("accepts bracketed IPv6 literals", () => {
    expect(screenTargetHost("[::1]")).toMatch(/loopback|link-local|private/);
  });
});
