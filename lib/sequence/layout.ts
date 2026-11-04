import type { Participant, SeqBlock, SeqMessage, SeqNode } from "./model";

/**
 * Sequence layout (EPIC 02): deterministic projection of the interaction
 * model into rows, columns and block frames. Pure and tested - the SVG
 * renderer draws exactly what this computes, nothing more.
 */

export const COL_W = 220;
export const ROW_H = 46;
export const HEAD_H = 30;
export const FOOT_H = 14;
/** Breathing room between sibling blocks so stacked frames never touch. */
export const BLOCK_GAP = 18;
export const TOP_PAD = 70;
export const SIDE_PAD = 40;
export const BOTTOM_PAD = 30;

export interface Column {
  id: string;
  name: string;
  kind: string;
  x: number;
}

export type RowKind = "message" | "note" | "block-start" | "block-else" | "block-end";

export interface Row {
  kind: RowKind;
  node: SeqMessage | SeqBlock;
  y: number;
}

export interface Frame {
  id: string;
  type: string;
  title: string;
  y0: number;
  y1: number;
  depth: number;
  /** True when the block holds no messages - the renderer hints at the fix. */
  empty: boolean;
}

export interface SequenceLayout {
  columns: Column[];
  rows: Row[];
  frames: Frame[];
  width: number;
  height: number;
}

export function layoutSequence(participants: Participant[], nodes: SeqNode[]): SequenceLayout {
  const columns: Column[] = participants.map((p, i) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    x: SIDE_PAD + COL_W / 2 + i * COL_W,
  }));
  const width = SIDE_PAD * 2 + Math.max(1, participants.length) * COL_W;
  const rows: Row[] = [];
  const frames: Frame[] = [];
  let y = TOP_PAD;

  const walk = (list: SeqNode[], depth: number) => {
    for (const n of list) {
      if (n.nodeType === "message") {
        rows.push({ kind: "message", node: n, y });
        y += ROW_H;
      } else if (n.type === "note") {
        rows.push({ kind: "note", node: n, y });
        y += ROW_H;
      } else {
        const y0 = y;
        rows.push({ kind: "block-start", node: n, y });
        y += HEAD_H;
        walk(n.children, depth + 1);
        if (n.type === "condition" && (n.elseChildren ?? []).length > 0) {
          rows.push({ kind: "block-else", node: n, y });
          y += HEAD_H;
          walk(n.elseChildren ?? [], depth + 1);
        }
        rows.push({ kind: "block-end", node: n, y });
        y += FOOT_H;
        const empty = n.children.length === 0 && (n.elseChildren ?? []).length === 0;
        frames.push({ id: n.id, type: n.type, title: blockTitle(n), y0, y1: y, depth, empty });
        // Gap after the frame (not inside it) so consecutive top-level
        // blocks read as separate cards instead of one glued slab.
        y += BLOCK_GAP;
      }
    }
  };
  walk(nodes, 0);
  return { columns, rows, frames, width, height: y + BOTTOM_PAD };
}

export function blockTitle(b: SeqBlock): string {
  switch (b.type) {
    case "loop":
      return `LOOP${b.iterator ? `: ${b.iterator}` : ""}${b.title && b.title !== b.iterator ? ` - ${b.title}` : ""}`;
    case "condition":
      return b.condition ? `IF ${b.condition}` : b.title || "IF";
    case "parallel":
      return b.title ? `PARALLEL - ${b.title}` : "PARALLEL";
    case "retry":
      return `RETRY${b.attempts ? ` ${b.attempts}×` : ""}${b.title ? ` - ${b.title}` : ""}`;
    case "note":
      return b.title;
    default:
      return b.title;
  }
}
