import type { Journey } from "./model";

/**
 * EPIC 08 - experience journeys. A journey is an ordered path through
 * screens: the workshop walkthrough, the click path, the demo script.
 * Screens keep their canvas positions; the journey owns the order.
 */

function wid(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    /* fall through */
  }
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createJourney(name: string): Journey {
  const clean = name.trim().slice(0, 120) || "Untitled journey";
  return { id: wid("jor"), name: clean, screenIds: [] };
}

/** Toggle a screen's membership; adding appends at the end. */
export function toggleJourneyScreen(j: Journey, screenId: string): Journey {
  const has = j.screenIds.includes(screenId);
  return {
    ...j,
    screenIds: has ? j.screenIds.filter((id) => id !== screenId) : [...j.screenIds, screenId],
  };
}

/** Move a member screen -1 earlier / +1 later. No-op at the edges. */
export function moveJourneyScreen(j: Journey, screenId: string, dir: -1 | 1): Journey {
  const i = j.screenIds.indexOf(screenId);
  if (i < 0) return j;
  const k = i + dir;
  if (k < 0 || k >= j.screenIds.length) return j;
  const next = [...j.screenIds];
  [next[i], next[k]] = [next[k], next[i]];
  return { ...j, screenIds: next };
}

/** Drop ids that no longer exist (after a screen delete). */
export function pruneJourney(j: Journey, validIds: Set<string>): Journey {
  const kept = j.screenIds.filter((id) => validIds.has(id));
  return kept.length === j.screenIds.length ? j : { ...j, screenIds: kept };
}
