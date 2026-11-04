/**
 * Wireframe canvas viewport math (EPIC 02). Pure functions - the canvas
 * component is a thin renderer over these. World units are px at k=1.
 */

export interface Viewport {
  x: number;
  y: number;
  k: number;
}

export const MIN_K = 0.25;
export const MAX_K = 2.5;

export function clampK(k: number): number {
  return Math.min(MAX_K, Math.max(MIN_K, k));
}

/** Zoom keeping the cursor-anchored world point stable. */
export function zoomAt(v: Viewport, cursorX: number, cursorY: number, factor: number): Viewport {
  const k = clampK(v.k * factor);
  const wx = (cursorX - v.x) / v.k;
  const wy = (cursorY - v.y) / v.k;
  return { k, x: cursorX - wx * k, y: cursorY - wy * k };
}

export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, x: v.x + dx, y: v.y + dy };
}

export function worldToScreen(v: Viewport, wx: number, wy: number): { x: number; y: number } {
  return { x: wx * v.k + v.x, y: wy * v.k + v.y };
}

export function screenToWorld(v: Viewport, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - v.x) / v.k, y: (sy - v.y) / v.k };
}

const VIEW_KEY = (expId: string) => `gravenx_wf_view_${expId}`;

export function loadViewport(expId: string): Viewport | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(VIEW_KEY(expId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Viewport>;
    if (typeof v.x !== "number" || typeof v.y !== "number" || typeof v.k !== "number") return null;
    return { x: v.x, y: v.y, k: clampK(v.k) };
  } catch {
    return null;
  }
}

export function storeViewport(expId: string, v: Viewport): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    sessionStorage.setItem(VIEW_KEY(expId), JSON.stringify(v));
  } catch {
    /* private mode - canvas still works for the session */
  }
}
