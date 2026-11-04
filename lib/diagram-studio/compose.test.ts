import { describe, expect, it } from "vitest";
import { resolvePackItems, type InventoryEntry, type PackRequest } from "./compose";

const INV: InventoryEntry[] = [
  { kind: "sequence", id: "seq-rca", name: "RCA Configure Flow" },
  { kind: "sequence", id: "seq-oauth", name: "OAuth Handshake" },
  { kind: "system", id: "sys-rca", name: "RCA Topology" },
  { kind: "system", id: "sys-mw", name: "Middleware Hub" },
];

const req = (kind: "sequence" | "system", name: string): PackRequest => ({ kind, name });

describe("compose eval set: briefs resolve to canvas references", () => {
  it("01 RCA review pack resolves exact names in order", () => {
    const r = resolvePackItems([req("sequence", "RCA Configure Flow"), req("system", "RCA Topology")], INV);
    expect(r.unresolved).toEqual([]);
    expect(r.resolved.map((x) => x.refId)).toEqual(["seq-rca", "sys-rca"]);
  });

  it("02 case-variant names still resolve", () => {
    const r = resolvePackItems([req("sequence", "rca configure flow")], INV);
    expect(r.resolved.map((x) => x.refId)).toEqual(["seq-rca"]);
  });

  it("03 substring names resolve to the live canvas", () => {
    const r = resolvePackItems([req("system", "Middleware")], INV);
    expect(r.resolved.map((x) => x.refId)).toEqual(["sys-mw"]);
  });

  it("04 composite REST pack mixes sequence + system", () => {
    const r = resolvePackItems([req("sequence", "OAuth Handshake"), req("system", "Middleware Hub")], INV);
    expect(r.unresolved).toEqual([]);
    expect(r.resolved).toHaveLength(2);
  });

  it("05 duplicate mentions collapse to one slot", () => {
    const r = resolvePackItems([req("sequence", "RCA Configure Flow"), req("sequence", "RCA Configure Flow")], INV);
    expect(r.resolved).toHaveLength(1);
  });

  it("06 missing canvas name fails honestly", () => {
    const r = resolvePackItems([req("sequence", "Refund Saga")], INV);
    expect(r.resolved).toEqual([]);
    expect(r.unresolved).toEqual([req("sequence", "Refund Saga")]);
  });

  it("07 right name, wrong kind does not cross-match", () => {
    const r = resolvePackItems([req("system", "RCA Configure Flow")], INV);
    expect(r.resolved).toEqual([]);
    expect(r.unresolved).toHaveLength(1);
  });

  it("08 blank names are unresolved, never wildcards", () => {
    const r = resolvePackItems([req("sequence", "   ")], INV);
    expect(r.resolved).toEqual([]);
    expect(r.unresolved).toHaveLength(1);
  });

  it("09 partial pack keeps the live half and reports the dead half", () => {
    const r = resolvePackItems([req("sequence", "OAuth Handshake"), req("system", "Billing Core")], INV);
    expect(r.resolved.map((x) => x.refId)).toEqual(["seq-oauth"]);
    expect(r.unresolved).toEqual([req("system", "Billing Core")]);
  });

  it("10 empty brief resolves nothing", () => {
    expect(resolvePackItems([], INV)).toEqual({ resolved: [], unresolved: [] });
  });
});

describe("flow items", () => {
  it("resolves flow requests against system canvases, keeping the flow kind", () => {
    const r = resolvePackItems([{ kind: "flow", name: "RCA Topology" }], INV);
    expect(r.unresolved).toEqual([]);
    expect(r.resolved).toEqual([{ kind: "flow", refId: "sys-rca", name: "RCA Topology" }]);
  });

  it("leaves missing flows unresolved", () => {
    const r = resolvePackItems([{ kind: "flow", name: "Nope" }], []);
    expect(r.resolved).toEqual([]);
    expect(r.unresolved).toHaveLength(1);
  });
});
