import { describe, it, expect } from "vitest";
import { parseCurl } from "./curl";

describe("parseCurl - shape", () => {
  it("returns required keys", () => {
    const r = parseCurl("curl https://example.com");
    expect(r).toHaveProperty("method");
    expect(r).toHaveProperty("url");
    expect(r).toHaveProperty("headers");
    expect(r).toHaveProperty("body");
    expect(r).toHaveProperty("warnings");
  });
});

describe("parseCurl - rejections", () => {
  it("rejects empty", () => {
    expect(() => parseCurl("")).toThrow();
  });
  it("rejects non-curl", () => {
    expect(() => parseCurl("hello world")).toThrow(/cURL/);
  });
  it("rejects no URL", () => {
    expect(() => parseCurl("curl -X POST")).toThrow(/URL/);
  });
  it("rejects unsupported method", () => {
    expect(() => parseCurl("curl -X TRACE https://example.com")).toThrow(/supported/);
  });
});

describe("parseCurl - methods", () => {
  it("defaults GET when no -X and no -d", () => {
    const r = parseCurl("curl https://example.com");
    expect(r.method).toBe("GET");
  });
  it("defaults POST when -d present", () => {
    const r = parseCurl("curl -d 'x=1' https://example.com");
    expect(r.method).toBe("POST");
  });
  it("respects -X POST", () => {
    const r = parseCurl("curl -X POST https://example.com");
    expect(r.method).toBe("POST");
  });
  it("handles -XPOST attached form", () => {
    const r = parseCurl("curl -XPOST https://example.com");
    expect(r.method).toBe("POST");
  });
  it("respects --request PUT", () => {
    const r = parseCurl("curl --request PUT https://example.com");
    expect(r.method).toBe("PUT");
  });
});

describe("parseCurl - headers", () => {
  it("parses single -H", () => {
    const r = parseCurl("curl -H 'Content-Type: application/json' https://x.com");
    expect(r.headers).toEqual([
      { key: "Content-Type", value: "application/json" },
    ]);
  });
  it("parses multiple -H", () => {
    const r = parseCurl(
      "curl -H 'A: 1' -H 'B: 2' https://x.com"
    );
    expect(r.headers).toEqual([
      { key: "A", value: "1" },
      { key: "B", value: "2" },
    ]);
  });
  it("warns on malformed header", () => {
    const r = parseCurl("curl -H 'no-colon' https://x.com");
    expect(r.warnings.length).toBe(1);
    expect(r.headers).toEqual([]);
  });
  it("captures -u as Authorization: Basic", () => {
    const r = parseCurl("curl -u user:pass https://x.com");
    expect(r.headers[0].key).toBe("Authorization");
    expect(r.headers[0].value.startsWith("Basic ")).toBe(true);
  });
});

describe("parseCurl - body", () => {
  it("joins multiple -d with &", () => {
    const r = parseCurl("curl -d 'a=1' -d 'b=2' https://x.com");
    expect(r.body).toBe("a=1&b=2");
  });
  it("accepts --data-raw", () => {
    const r = parseCurl("curl --data-raw '{\"a\":1}' https://x.com");
    expect(r.body).toBe('{"a":1}');
  });
});

describe("parseCurl - quoting", () => {
  it("handles single quotes", () => {
    const r = parseCurl("curl -H 'A: B' https://x.com");
    expect(r.headers[0].value).toBe("B");
  });
  it("handles double quotes with escape", () => {
    const r = parseCurl('curl -H "A: B\\"C" https://x.com');
    expect(r.headers[0].value).toBe('B"C');
  });
  it("handles ANSI-C $'...' quotes", () => {
    const r = parseCurl("curl -d $'line1\\nline2' https://x.com");
    expect(r.body).toBe("line1\nline2");
  });
  it("handles backslash-newline continuations", () => {
    const r = parseCurl(
      "curl \\\n  -H 'A: B' \\\n  https://x.com"
    );
    expect(r.headers[0].value).toBe("B");
  });
});

describe("parseCurl - flags", () => {
  it("ignores -L, -s, -k", () => {
    expect(() => parseCurl("curl -L -s -k https://x.com")).not.toThrow();
  });
  it("warns on unknown flag", () => {
    const r = parseCurl("curl --unknown https://x.com");
    expect(r.warnings.some((w) => /unsupported/.test(w))).toBe(true);
  });
  it("accepts --flag=value (long flags only)", () => {
    const r = parseCurl("curl --request=POST https://x.com");
    expect(r.method).toBe("POST");
  });
});

describe("parseCurl - headers cap", () => {
  it("caps at 10 headers with warning", () => {
    const cmd =
      "curl " +
      Array.from({ length: 12 }, (_, i) => `-H 'H${i}: v'`).join(" ") +
      " https://x.com";
    const r = parseCurl(cmd);
    expect(r.headers.length).toBe(10);
    expect(r.warnings.some((w) => /Kept the first 10/.test(w))).toBe(true);
  });
});
