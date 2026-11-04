import type { SeqNode } from "./model";

/**
 * Structural node edits (EPIC 04): find, patch and remove by id.
 * The Inspector and (later) AI tools share these; text reprints from
 * the model after every edit so the DSL never drifts.
 */

/** Depth-first search for any message or block. */
export function findNode(nodes: SeqNode[], id: string): SeqNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.nodeType === "block") {
      const hit = findNode(n.children, id) ?? (n.elseChildren ? findNode(n.elseChildren, id) : null);
      if (hit) return hit;
    }
  }
  return null;
}

/** Replace one node, preserving order everywhere else. */
export function patchNode(nodes: SeqNode[], id: string, next: SeqNode): SeqNode[] {
  return nodes.map((n) => {
    if (n.id === id) return next;
    if (n.nodeType === "block") {
      const children = patchNode(n.children, id, next);
      const elseChildren = n.elseChildren ? patchNode(n.elseChildren, id, next) : undefined;
      if (children !== n.children || elseChildren !== n.elseChildren) {
        return { ...n, children, ...(elseChildren !== undefined ? { elseChildren } : {}) };
      }
    }
    return n;
  });
}

/** Remove one node (and prune empty else-branches to undefined). */
export function removeNode(nodes: SeqNode[], id: string): SeqNode[] {
  const out: SeqNode[] = [];
  for (const n of nodes) {
    if (n.id === id) continue;
    if (n.nodeType === "block") {
      const children = removeNode(n.children, id);
      const elseKept = n.elseChildren ? removeNode(n.elseChildren, id) : undefined;
      out.push({
        ...n,
        children,
        ...(elseKept !== undefined ? { elseChildren: elseKept.length > 0 ? elseKept : undefined } : {}),
      });
    } else {
      out.push(n);
    }
  }
  return out;
}
