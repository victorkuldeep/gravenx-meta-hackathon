import { describe, expect, it } from "vitest";
import { parseStatements } from "./dsl";
import { findNode, patchNode, removeNode } from "./edit";

const TEXT = `A -> B: One
if Ready
A -> B: Two
else Waiting
A -> B: Three
end
`;

function nodes() {
  return parseStatements(TEXT).nodes;
}

describe("sequence node edits", () => {
  it("finds nested and else-branch nodes", () => {
    const ns = nodes();
    expect(findNode(ns, "missing")).toBeNull();
    const cond = ns.find((n) => n.nodeType === "block")!;
    expect(findNode(ns, cond.id)).toBe(cond);
    if (cond.nodeType === "block") {
      expect(findNode(ns, cond.elseChildren![0].id)?.nodeType).toBe("message");
    }
  });

  it("patches in place, preserving order", () => {
    const ns = nodes();
    const target = ns[0];
    if (target.nodeType !== "message") throw new Error("fixture changed");
    const next = patchNode(ns, target.id, { ...target, label: "Uno" });
    expect(next[0].nodeType).toBe("message");
    if (next[0].nodeType === "message") expect(next[0].label).toBe("Uno");
    expect(next).toHaveLength(ns.length);
    expect(patchNode(ns, "missing", target)).toHaveLength(ns.length);
  });

  it("removes nodes and prunes emptied else-branches", () => {
    const ns = nodes();
    const cond = ns.find((n) => n.nodeType === "block")!;
    if (cond.nodeType !== "block") throw new Error("fixture changed");
    const elseId = cond.elseChildren![0].id;
    const pruned = removeNode(ns, elseId);
    const after = pruned.find((n) => n.id === cond.id)!;
    if (after.nodeType !== "block") throw new Error("fixture changed");
    expect(after.elseChildren).toBeUndefined();
    expect(removeNode(ns, ns[0].id)).toHaveLength(ns.length - 1);
  });
});
