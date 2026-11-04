import { stringifyPath, type JsonPath } from "./path";

/**
 * Canonical JSON document model: pure derived data over the parsed value.
 * Stable path-string identity, iterative traversal (no recursion limit),
 * value references (no per-node serialization). Expansion, selection and
 * layout state live in views - never here, never mutating the source.
 */

export type JsonNodeType = "object" | "array" | "string" | "number" | "boolean" | "null";

export interface JsonNode {
  /** Stable identity: the canonical path string ($, $.a[0].b). */
  id: string;
  type: JsonNodeType;
  /** Display label: key, [index], or root marker. */
  label: string;
  path: JsonPath;
  parent: string | null;
  children: string[];
  depth: number;
  /** Object key or array index that produced this node (null at root). */
  key: string | number | null;
  /** Reference into the parsed document (do not mutate). */
  value: unknown;
}

export interface JsonDocument {
  rootId: string;
  nodes: Map<string, JsonNode>;
  /** Number of nodes in the full model (projection may show fewer). */
  size: number;
}

export function nodeTypeOf(value: unknown): JsonNodeType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    default:
      return "string";
  }
}

/** Build the full node map iteratively (safe at any depth). */
export function buildDocument(value: unknown): JsonDocument {
  const nodes = new Map<string, JsonNode>();
  const rootPath: JsonPath = [];
  const rootId = stringifyPath(rootPath);

  const stack: { value: unknown; path: JsonPath; parent: string | null; key: string | number | null; depth: number }[] = [
    { value, path: rootPath, parent: null, key: null, depth: 0 },
  ];

  while (stack.length > 0) {
    const frame = stack.pop() as (typeof stack)[number];
    const type = nodeTypeOf(frame.value);
    const id = stringifyPath(frame.path);
    const label =
      frame.key === null ? "(root)" : typeof frame.key === "number" ? `[${frame.key}]` : frame.key;
    const node: JsonNode = {
      id,
      type,
      label,
      path: frame.path,
      parent: frame.parent,
      children: [],
      depth: frame.depth,
      key: frame.key,
      value: frame.value,
    };
    nodes.set(id, node);
    if (frame.parent !== null) {
      const parent = nodes.get(frame.parent);
      // Parent is always processed before its children are pushed.
      parent?.children.push(id);
    }

    if (type === "array") {
      const arr = frame.value as unknown[];
      // Push in reverse so index 0 is processed first; parent lookup
      // below handles ordering deterministically regardless.
      for (let i = arr.length - 1; i >= 0; i--) {
        stack.push({ value: arr[i], path: [...frame.path, i], parent: id, key: i, depth: frame.depth + 1 });
      }
    } else if (type === "object") {
      const entries = Object.entries(frame.value as Record<string, unknown>);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [k, v] = entries[i];
        stack.push({ value: v, path: [...frame.path, k], parent: id, key: k, depth: frame.depth + 1 });
      }
    }
  }

  // Children arrive in document order: entries are pushed reversed so the
  // stack pops index 0 / first key first, appending in order.
  return { rootId, nodes, size: nodes.size };
}

/** Children arrays hold node ids in document order regardless of traversal. */
export function getNode(doc: JsonDocument, id: string): JsonNode | undefined {
  return doc.nodes.get(id);
}

/** Extract the exact subtree value (valid JSON, structural share). */
export function subtreeValue(doc: JsonDocument, id: string): { found: boolean; value: unknown } {
  const node = doc.nodes.get(id);
  if (!node) return { found: false, value: undefined };
  return { found: true, value: node.value };
}

/** Ancestor chain from root to (excluding) the node, for expansion. */
export function ancestorIds(doc: JsonDocument, id: string): string[] {
  const out: string[] = [];
  let cur = doc.nodes.get(id)?.parent ?? null;
  const guard = new Set<string>();
  while (cur !== null && !guard.has(cur)) {
    guard.add(cur);
    out.unshift(cur);
    cur = doc.nodes.get(cur)?.parent ?? null;
  }
  return out;
}

/** Short human preview for leaves (full value stays in the inspector). */
export function previewValue(node: JsonNode, max = 48): string {
  const v = node.value;
  if (node.type === "string") {
    const s = v as string;
    return s.length > max ? `${s.slice(0, max)}…` : s;
  }
  if (node.type === "object") return `Object · ${Object.keys(v as object).length} keys`;
  if (node.type === "array") return `Array · ${(v as unknown[]).length} items`;
  return String(v);
}
