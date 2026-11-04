import { describe, expect, it } from "vitest";
import { computeVerdict } from "./verdict";

describe("run verdict", () => {
  it("passes on exact status match", () => {
    expect(computeVerdict(200, 200)).toBe("pass");
    expect(computeVerdict(500, 500)).toBe("pass");
  });

  it("passes same-class without pretending exactness", () => {
    expect(computeVerdict(200, 201)).toBe("pass");
    // A 502 still reproduces an expected 500-class failure.
    expect(computeVerdict(500, 502)).toBe("pass");
  });

  it("fails across status classes", () => {
    expect(computeVerdict(200, 500)).toBe("fail");
    expect(computeVerdict(500, 200)).toBe("fail");
  });

  it("returns no verdict without an expectation", () => {
    expect(computeVerdict(null, 200)).toBeNull();
  });
});
