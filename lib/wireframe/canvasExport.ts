/**
 * Canvas PNG export math (wireframe mirror of the System snapshot export).
 * Pure and tested: union screen-card rects, then fit them into an image
 * frame with padding and minimum dimensions.
 */

export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExportFrame {
  imgW: number;
  imgH: number;
  zoom: number;
  tx: number;
  ty: number;
}

/** Union of card rects in world coordinates; null when there is nothing. */
export function contentBounds(cards: CardRect[]): ContentBounds | null {
  const live = cards.filter((c) => c.width > 0 && c.height > 0);
  if (live.length === 0) return null;
  const minX = Math.min(...live.map((c) => c.x));
  const minY = Math.min(...live.map((c) => c.y));
  const maxX = Math.max(...live.map((c) => c.x + c.width));
  const maxY = Math.max(...live.map((c) => c.y + c.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const PAD = 60;
const MIN_W = 1200;
const MIN_H = 800;
const MAX_ZOOM = 2;

/** Fit bounds into an image frame: padded, minimum-size, capped zoom. */
export function frameFor(bounds: ContentBounds): ExportFrame {
  const imgW = Math.max(MIN_W, Math.ceil(bounds.width + PAD * 2));
  const imgH = Math.max(MIN_H, Math.ceil(bounds.height + PAD * 2));
  const zoom = Math.min(MAX_ZOOM, imgW / (bounds.width + PAD * 2), imgH / (bounds.height + PAD * 2));
  return {
    imgW,
    imgH,
    zoom,
    tx: PAD - bounds.x * zoom,
    ty: PAD - bounds.y * zoom,
  };
}

/** Screen-space rect -> world coords given the viewport transform. */
export function toWorld(
  rect: { left: number; top: number; width: number; height: number },
  area: { left: number; top: number },
  view: { x: number; y: number; k: number },
): CardRect {
  const k = view.k || 1;
  return {
    x: (rect.left - area.left - view.x) / k,
    y: (rect.top - area.top - view.y) / k,
    width: rect.width / k,
    height: rect.height / k,
  };
}

export function wirePngFileName(expName: string, scale: 2 | 3): string {
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  const slug = expName.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase().replace(/^-+|-+$/g, "").slice(0, 60) || "wireframe";
  return `${slug}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}@${scale}x.png`;
}
