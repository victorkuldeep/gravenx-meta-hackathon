/**
 * Draw bridge - the AI's seam into the Excalidraw board.
 *
 * Mirrors lib/ai/{system,wire,seq}Bridge: the canvas registers a live
 * bridge, tools read snapshots and append new elements. Element specs are
 * partial objects - DrawCanvas runs them through Excalidraw's official
 * `restoreElements` before `updateScene`, so seeds, fractional indexes
 * and binding repair come from the engine, not from us.
 */

export type DrawShapeKind = "rectangle" | "ellipse" | "diamond";

/** Partial Excalidraw element - restoreElements fills seeds/index/defaults. */
export type DrawElementSpec = Record<string, unknown>;

export interface DrawElementSummary {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
}

export interface DrawSnapshot {
  elementCount: number;
  counts: Record<string, number>;
  /** Up to 40 summaries - enough to inventory, never a full scene dump. */
  elements: DrawElementSummary[];
  truncated: boolean;
  viewport?: { centerX: number; centerY: number };
}

export interface DrawBridge {
  getSnapshot: () => DrawSnapshot | null;
  append: (specs: DrawElementSpec[]) => { ok: true; added: number } | { ok: false; error: string };
}

let bridge: DrawBridge | null = null;

export function registerDrawBridge(b: DrawBridge | null): void {
  bridge = b;
}

export function getDrawBridge(): DrawBridge | null {
  return bridge;
}

const MAX_SUMMARIES = 40;

function round(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
}

function textOf(el: Record<string, unknown>): string | undefined {
  const t = el.text;
  if (typeof t !== "string") return undefined;
  const s = t.replace(/\s+/g, " ").trim().slice(0, 120);
  return s ? s : undefined;
}

/** Pure census over raw scene elements - testable without Excalidraw. */
export function summarizeDrawElements(
  elements: unknown[],
  viewport?: { centerX: number; centerY: number },
): DrawSnapshot {
  const counts: Record<string, number> = {};
  const summaries: DrawElementSummary[] = [];
  let count = 0;
  for (const raw of elements) {
    if (!raw || typeof raw !== "object") continue;
    const el = raw as Record<string, unknown>;
    if (el.isDeleted === true) continue;
    const type = typeof el.type === "string" ? el.type : "unknown";
    counts[type] = (counts[type] ?? 0) + 1;
    count++;
    if (summaries.length < MAX_SUMMARIES) {
      const s: DrawElementSummary = {
        id: typeof el.id === "string" ? el.id : `element_${count}`,
        type,
        x: round(el.x),
        y: round(el.y),
        width: round(el.width),
        height: round(el.height),
      };
      const t = textOf(el);
      if (t) s.text = t;
      summaries.push(s);
    }
  }
  return {
    elementCount: count,
    counts,
    elements: summaries,
    truncated: count > summaries.length,
    ...(viewport ? { viewport } : {}),
  };
}

let idCounter = 0;

function newId(prefix: string): string {
  idCounter++;
  return `ai_${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

const INK = "#1e1e1e";

function baseSpec(type: string, x: number, y: number, width: number, height: number): DrawElementSpec {
  return {
    id: newId(type),
    type,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.max(10, Math.round(width)),
    height: Math.max(10, Math.round(height)),
    angle: 0,
    strokeColor: INK,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: type === "ellipse" ? { type: 2 } : { type: 3 },
    boundElements: [],
    link: null,
    locked: false,
  };
}

/**
 * Shape with its label as a grouped text element (unbound, same group -
 * avoids hand-rolling container bindings that restore would have to repair).
 */
export function buildShapeSpecs(
  shape: DrawShapeKind,
  label: string,
  centerX: number,
  centerY: number,
  width = 240,
  height = 120,
): DrawElementSpec[] {
  const groupId = newId("group");
  const x = Math.round(centerX - width / 2);
  const y = Math.round(centerY - height / 2);
  const box = baseSpec(shape, x, y, width, height);
  box.groupIds = [groupId];
  const clean = label.replace(/\s+/g, " ").trim().slice(0, 120);
  const text = {
    ...baseSpec("text", centerX - 100, centerY - 16, 200, 32),
    groupIds: [groupId],
    text: clean,
    fontSize: 20,
    fontFamily: 1,
    textAlign: "center",
    verticalAlign: "middle",
    autoResize: true,
  };
  return [box, text];
}

export function buildTextSpec(text: string, centerX: number, centerY: number): DrawElementSpec {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 280);
  const lines = clean.split("\n").length;
  return {
    ...baseSpec("text", Math.round(centerX - 140), Math.round(centerY - 16 * lines), 280, 32 * lines),
    text: clean,
    fontSize: 20,
    fontFamily: 1,
    textAlign: "center",
    verticalAlign: "middle",
    autoResize: true,
  };
}

export function buildArrowSpec(
  centerX: number,
  centerY: number,
  dx = 220,
  dy = 0,
): DrawElementSpec {
  const fromX = Math.round(centerX - dx / 2);
  const fromY = Math.round(centerY - dy / 2);
  return {
    ...baseSpec("arrow", fromX, fromY, Math.abs(dx) || 10, Math.abs(dy) || 10),
    points: [
      [0, 0],
      [dx, dy],
    ],
    elbowed: false,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
  };
}
