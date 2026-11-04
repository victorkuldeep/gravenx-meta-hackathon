// Pure pinch-zoom math shared by the System + ERD canvases.
// Kept DOM-free so the feel factors are pinned by unit tests.

/** Touch exponent on the gesture ratio. 4 ≈ four times the native feel. */
export const DEFAULT_PINCH_AMPLIFICATION = 4;
/** Per-deltaY trackpad coefficient. Native ≈ 0.002, ours quadrupled. */
export const DEFAULT_WHEEL_COEFFICIENT = 0.008;
export const NATIVE_WHEEL_COEFFICIENT = 0.002;

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** Touch scale for a distance ratio r: r^amplification (identity at r = 1). */
export function scaleForTouchRatio(ratio: number, amplification: number): number {
  return Math.pow(ratio, amplification);
}

/** Trackpad scale for a wheel deltaY: scroll up (negative) zooms in. */
export function scaleForWheelDelta(deltaY: number, coefficient: number): number {
  return Math.exp(-deltaY * coefficient);
}

/** Anchor-preserving zoom, clamped to [minZoom, maxZoom]. */
export function zoomAtPoint(
  viewport: Viewport,
  anchorX: number,
  anchorY: number,
  nextZoom: number,
  minZoom: number,
  maxZoom: number,
): Viewport {
  const zoom = Math.min(maxZoom, Math.max(minZoom, nextZoom));
  const k = zoom / viewport.zoom;
  return {
    x: anchorX - (anchorX - viewport.x) * k,
    y: anchorY - (anchorY - viewport.y) * k,
    zoom,
  };
}
