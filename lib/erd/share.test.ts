"use client";

import { describe, it, expect } from "vitest";
import { validateSharePayload, shareFileName, ERD_SHARE_KIND } from "./share";

const describeOf = (name: string) => ({ name, label: name, custom: false, fields: [{ name: "Id" }] });

describe("erd share payload", () => {
  it("accepts a well-formed payload", () => {
    const raw = {
      kind: ERD_SHARE_KIND,
      version: 1,
      exportedAt: 123,
      exportedOrg: "x",
      snapshot: { name: "Lead map", root: "Lead", focus: "Lead", describes: [describeOf("Lead")], positions: {} },
    };
    const p = validateSharePayload(raw);
    expect(p?.snapshot.name).toBe("Lead map");
    expect(p?.snapshot.describes).toHaveLength(1);
  });

  it("rejects wrong kind, future version, missing describes", () => {
    expect(validateSharePayload(null)).toBeNull();
    expect(validateSharePayload({ kind: "nope", version: 1, snapshot: {} })).toBeNull();
    expect(
      validateSharePayload({ kind: ERD_SHARE_KIND, version: 99, snapshot: { root: "Lead", describes: [describeOf("Lead")] } })
    ).toBeNull();
    expect(validateSharePayload({ kind: ERD_SHARE_KIND, version: 1, snapshot: { root: "Lead", describes: [] } })).toBeNull();
    expect(
      validateSharePayload({ kind: ERD_SHARE_KIND, version: 1, snapshot: { root: "Lead", describes: [{ name: "Lead" }] } })
    ).toBeNull();
  });

  it("fills sane defaults for optional fields", () => {
    const p = validateSharePayload({
      kind: ERD_SHARE_KIND,
      version: 1,
      snapshot: { root: "Lead", describes: [describeOf("Lead")] },
    });
    expect(p?.snapshot.name).toBe("Shared canvas");
    expect(p?.snapshot.focus).toBe("Lead");
    expect(p?.snapshot.positions).toEqual({});
  });

  it("slugifies file names", () => {
    expect(shareFileName("Lead +3")).toBe("lead-3.sobject-erd.json");
    expect(shareFileName("  ")).toBe("erd.sobject-erd.json");
  });
});
