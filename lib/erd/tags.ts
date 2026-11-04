/** ERD canvas tags: fixed 8-color palette, free-text names.
 *
 * Tags live on the canvas project (persisted in the per-org autosave);
 * the *filter* over them is session-only. A tag is a reference, not a copy:
 * deleting a tag strips it from every node, deleting a node drops its refs.
 */

export interface ErdTag {
  id: string;
  name: string;
  /** One of ERD_TAG_COLORS (hex). */
  color: string;
}

/** Fixed 8-color palette - identity colors, warm on the ivory canvas. */
export const ERD_TAG_COLORS = [
  "#722F37", // burgundy
  "#9A7653", // bronze
  "#2F5D3A", // forest
  "#2B4C7E", // navy
  "#6D3B5D", // plum
  "#1F766E", // teal
  "#B7791F", // ochre
  "#475569", // slate
] as const;

export const ERD_TAG_NAME_MAX = 24;

let tagSeq = 0;

/** Client-side tag id - uniqueness only needs the browser session. */
export function newTagId(): string {
  tagSeq += 1;
  return `tag-${Date.now().toString(36)}-${tagSeq.toString(36)}`;
}

/** Normalize a free-text tag name: trim, cap length, reject empties. */
export function cleanTagName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) return null;
  return name.slice(0, ERD_TAG_NAME_MAX);
}

/** Snap any color to the fixed palette (unknown → first free-ish slot). */
export function snapTagColor(color: string, taken: Set<string> = new Set()): string {
  const want = color.toUpperCase();
  const hit = ERD_TAG_COLORS.find((c) => c.toUpperCase() === want);
  if (hit && !taken.has(hit)) return hit;
  return ERD_TAG_COLORS.find((c) => !taken.has(c)) ?? ERD_TAG_COLORS[0];
}

/** Build a tag: free-text name, palette-snapped color. Null on empty name. */
export function createTag(rawName: string, color: string, existing: ErdTag[] = []): ErdTag | null {
  const name = cleanTagName(rawName);
  if (!name) return null;
  const taken = new Set(existing.map((t) => t.color.toUpperCase()));
  return { id: newTagId(), name, color: snapTagColor(color, taken) };
}

/** Border tint for a node: its first tag's color, null when untagged. */
export function tintForTags(tags: Pick<ErdTag, "color">[]): string | null {
  return tags.length > 0 ? tags[0].color : null;
}

/** Tag filter match: empty filter matches everything (no filtering). */
export function nodeMatchesTagFilter(nodeTagIds: string[], filter: Set<string> | string[]): boolean {
  const list = Array.isArray(filter) ? filter : [...filter];
  if (list.length === 0) return true;
  return list.some((t) => nodeTagIds.includes(t));
}
