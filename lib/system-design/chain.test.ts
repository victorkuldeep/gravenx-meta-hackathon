"use client";

import { describe, it, expect } from "vitest";
import { resolveChain, unmappedEdges, CHAIN_MAX_HOPS, CHAIN_MAX_LANES } from "./chain";
import type { SystemConnection } from "./model";

const edge = (id: string, sourceId: string, targetId: string, label = ""): SystemConnection => ({
  id, sourceId, targetId, label, status: "draft",
});

const PROJ = {
  connections: [
    edge("e1", "sf", "mw", "a"),
    edge("e2", "mw", "sap", "b"),
    edge("e3", "mw", "snow", "c"),
    edge("e4", "sap", "sf", "back"),
  ],
};

describe("chain resolution", () => {
  it("walks a linear lane to the dead end", () => {
    const lanes = resolveChain({ connections: [PROJ.connections[0], PROJ.connections[1]] }, "e1");
    expect(lanes).toHaveLength(1);
    expect(lanes[0].edges.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(lanes[0].stopped).toBeNull();
  });

  it("fans out into one lane per branch", () => {
    const lanes = resolveChain(PROJ, "e1");
    expect(lanes).toHaveLength(2);
    expect(lanes[0].edges.map((e) => e.id)).toEqual(["e1", "e2", "e4"]);
    expect(lanes[1].edges.map((e) => e.id)).toEqual(["e1", "e3"]);
  });

  it("stops cycles with a note instead of looping", () => {
    const lanes = resolveChain(
      { connections: [edge("a", "x", "y"), edge("b", "y", "x")] },
      "a"
    );
    expect(lanes).toHaveLength(1);
    expect(lanes[0].edges.map((e) => e.id)).toEqual(["a", "b"]);
    expect(lanes[0].stopped).toMatch(/Cycle/);
  });

  it("caps runaway chains", () => {
    const conns: SystemConnection[] = [];
    for (let i = 0; i < CHAIN_MAX_HOPS + 5; i++) {
      conns.push(edge(`e${i}`, `n${i}`, `n${i + 1}`));
    }
    const lanes = resolveChain({ connections: conns }, "e0");
    expect(lanes).toHaveLength(1);
    expect(lanes[0].edges).toHaveLength(CHAIN_MAX_HOPS);
    expect(lanes[0].stopped).toMatch(/Hop cap/);
  });

  it("returns empty for an unknown start edge", () => {
    expect(resolveChain(PROJ, "ghost")).toEqual([]);
  });

  it("caps lane breadth with a truncation note", () => {
    const conns: SystemConnection[] = [edge("e0", "hub", "fan")];
    for (let i = 0; i < CHAIN_MAX_LANES + 5; i++) {
      conns.push(edge(`f${i}`, "fan", `leaf${i}`));
    }
    const lanes = resolveChain({ connections: conns }, "e0");
    expect(lanes).toHaveLength(CHAIN_MAX_LANES);
    expect(lanes[CHAIN_MAX_LANES - 1].stopped).toMatch(/breadth cap/);
  });

  it("names unmapped edges", () => {
    const lanes = resolveChain(
      { connections: [edge("e1", "a", "b"), { ...edge("e2", "b", "c"), mapping: { mode: "passthrough", template: "" } }] },
      "e1"
    );
    expect(unmappedEdges(lanes[0])).toEqual(["e1"]);
  });
});
