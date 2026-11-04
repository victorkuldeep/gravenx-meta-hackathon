/**
 * Laser stroke math (pure, framework-free): point capping for long trails
 * and the hold-then-melt opacity curve behind the smooth tail. The animated
 * `<g>` in LaserLayer reads these constants so CSS and cleanup agree.
 */

export interface LaserPoint {
  x: number;
  y: number;
}

/** Hold full opacity this long after the stroke's last point lands. */
export const LASER_HOLD_MS = 1000;
/** Melt from full to gone over this long after the hold. */
export const LASER_FADE_MS = 800;
/** Total CSS animation length: hold + fade. */
export const LASER_LIFETIME_MS = LASER_HOLD_MS + LASER_FADE_MS;
/** Longest single trail (pointer events per frame, capped). */
export const LASER_MAX_PTS = 120;
/** Concurrent fading trails before the oldest is dropped. */
export const LASER_MAX_STROKES = 12;

/** Append a point, keeping the newest MAX (default 120). */
export function appendPoint(pts: LaserPoint[], p: LaserPoint, max: number = LASER_MAX_PTS): LaserPoint[] {
  if (pts.length < max) return [...pts, p];
  return [...pts.slice(pts.length - max + 1), p];
}

/** 1 during the hold, linear melt to 0 across the fade, 0 after. */
export function opacityForAge(ageMs: number): number {
  if (ageMs < 0) return 1;
  if (ageMs < LASER_HOLD_MS) return 1;
  if (ageMs < LASER_LIFETIME_MS) return 1 - (ageMs - LASER_HOLD_MS) / LASER_FADE_MS;
  return 0;
}
