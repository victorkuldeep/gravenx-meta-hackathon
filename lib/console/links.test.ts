import { describe, expect, it } from "vitest";
import { consoleLinkHref } from "./model";

describe("console link hrefs", () => {
  it("falls back to the studio tab without a record", () => {
    expect(consoleLinkHref({ surface: "system" })).toBe("/system");
    expect(consoleLinkHref({ surface: "wireframe" })).toBe("/wireframe");
    expect(consoleLinkHref({ surface: "sequence" })).toBe("/sequence");
    expect(consoleLinkHref({ surface: "draw" })).toBe("/draw");
    expect(consoleLinkHref({ surface: "decision" })).toBe("/decisions");
    expect(consoleLinkHref({ surface: "requirement" })).toBe("/requirements");
  });

  it("lands on the exact record when addressable", () => {
    expect(consoleLinkHref({ surface: "decision", recordId: "d1" })).toBe("/decisions?id=d1");
    expect(consoleLinkHref({ surface: "schema", recordId: "tabAbc" })).toBe("/?mode=schema&canvas=tabAbc");
    expect(consoleLinkHref({ surface: "schema" })).toBe("/?mode=schema");
    expect(consoleLinkHref({ surface: "requirement", recordId: "r1" })).toBe("/requirements?id=r1");
    expect(consoleLinkHref({ surface: "sequence", recordId: "s1" })).toBe("/sequence?id=s1");
    expect(consoleLinkHref({ surface: "wireframe", recordId: "e1" })).toBe("/wireframe?exp=e1");
    expect(consoleLinkHref({ surface: "system", recordId: "p1" })).toBe("/system?project=p1");
    expect(consoleLinkHref({ surface: "schema", recordId: "" })).toBe("/?mode=schema");
  });

  it("encodes record ids safely", () => {
    expect(consoleLinkHref({ surface: "decision", recordId: "a b&c" })).toBe("/decisions?id=a%20b%26c");
  });
});
