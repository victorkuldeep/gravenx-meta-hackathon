/**
 * Experience Mapping - canvas geometry.
 *
 * Source pixels are canonical. The viewport (scale + translation) is
 * transient and never persisted. All pointer math goes through these
 * pure functions so zoom/pan/resize cannot drift stored coordinates.
 */

export interface Viewport {
  /** Displayed px per source px. */
  scale: number;
  /** Displayed px offset of the source origin. */
  tx: number;
  ty: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const MIN_RECT = 8;

/** Fit scale for a source image inside a container (no upscaling past 1:1... actually allow fit-up for small screens? No: cap at 3x for legibility). */
export function fitScale(sourceW: number, sourceH: number, viewW: number, viewH: number): number {
  if (!sourceW || !sourceH || !viewW || !viewH) return 1;
  return Math.min(3, Math.min(viewW / sourceW, viewH / sourceH));
}

/** Centered viewport for fit-to-view. */
export function fitViewport(sourceW: number, sourceH: number, viewW: number, viewH: number): Viewport {
  const scale = fitScale(sourceW, sourceH, viewW, viewH);
  return { scale, tx: (viewW - sourceW * scale) / 2, ty: (viewH - sourceH * scale) / 2 };
}

/** Zoom about a viewport point (e.g. cursor), clamped. */
export function zoomAbout(vp: Viewport, factor: number, cx: number, cy: number): Viewport {
  const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.scale * factor));
  const k = scale / vp.scale;
  return { scale, tx: cx - (cx - vp.tx) * k, ty: cy - (cy - vp.ty) * k };
}

/** Viewport px -> source px. */
export function toSource(vp: Viewport, px: number, py: number): { x: number; y: number } {
  return { x: (px - vp.tx) / vp.scale, y: (py - vp.ty) / vp.scale };
}

/** Source px -> viewport px. */
export function toView(vp: Viewport, x: number, y: number): { px: number; py: number } {
  return { px: x * vp.scale + vp.tx, py: y * vp.scale + vp.ty };
}

/** Normalize a drag (any direction) into a positive rect, rounded to px. */
export function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    x: Math.round(Math.min(x1, x2)),
    y: Math.round(Math.min(y1, y2)),
    width: Math.round(Math.abs(x2 - x1)),
    height: Math.round(Math.abs(y2 - y1)),
  };
}

/** Clamp a rect inside source bounds. Returns null when nothing usable remains. */
export function clampRect(r: Rect, boundsW: number, boundsH: number): Rect | null {
  const x = Math.max(0, Math.min(r.x, boundsW));
  const y = Math.max(0, Math.min(r.y, boundsH));
  const width = Math.max(0, Math.min(r.x + r.width, boundsW) - x);
  const height = Math.max(0, Math.min(r.y + r.height, boundsH) - y);
  if (width < MIN_RECT || height < MIN_RECT) return null;
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** Validate stored geometry against source bounds. */
export function validateGeometry(r: Rect, boundsW: number, boundsH: number): string | null {
  if (![r.x, r.y, r.width, r.height].every(Number.isFinite)) return "Coordinates must be finite numbers.";
  if (r.width <= 0 || r.height <= 0) return "Width and height must be positive.";
  if (r.x < 0 || r.y < 0 || r.x + r.width > boundsW || r.y + r.height > boundsH)
    return "Rectangle extends outside the source image.";
  return null;
}

export type Handle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w" | "move";

/** Apply a drag delta (in source px) to a rect via a handle. */
export function dragRect(r: Rect, handle: Handle, dx: number, dy: number): Rect {
  const next = { ...r };
  if (handle === "move") {
    next.x += dx;
    next.y += dy;
    return next;
  }
  if (handle.includes("w")) {
    next.x += dx;
    next.width -= dx;
  }
  if (handle.includes("e")) next.width += dx;
  if (handle.includes("n")) {
    next.y += dy;
    next.height -= dy;
  }
  if (handle.includes("s")) next.height += dy;
  // Flip-safe normalize.
  if (next.width < 0) {
    next.x += next.width;
    next.width = -next.width;
  }
  if (next.height < 0) {
    next.y += next.height;
    next.height = -next.height;
  }
  return { x: Math.round(next.x), y: Math.round(next.y), width: Math.round(next.width), height: Math.round(next.height) };
}
