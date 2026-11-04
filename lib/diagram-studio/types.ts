/**
 * Diagram Studio - deliverable packs over existing canvases (hexagonal core).
 *
 * A studio project holds REFERENCES to Sequence documents and System
 * projects, never copies: the canvases stay the source of truth. Adapters
 * in components/diagram-studio resolve each item to a renderable source
 * behind the DiagramSource port. Deleting a canvas document orphans the
 * item (graceful "source deleted" card), it never deletes studio data.
 */

export const DIAGRAM_STUDIO_SCHEMA_VERSION = 1;

export type StudioItemKind = "sequence" | "system" | "flow";

export interface StudioItem {
  id: string;
  kind: StudioItemKind;
  /** Id of the SequenceDocument / SystemProject in its own store. */
  refId: string;
  /** Optional override; falls back to the source document name. */
  titleOverride?: string;
  addedAt: number;
}

export interface StudioProject {
  id: string;
  name: string;
  description?: string;
  themeId: string;
  items: StudioItem[];
  createdAt: number;
  updatedAt: number;
}

export function newStudioId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function blankStudioProject(name: string): StudioProject {
  const now = Date.now();
  return { id: newStudioId("dstudio"), name: name.trim() || "Untitled pack", themeId: "premium-light", items: [], createdAt: now, updatedAt: now };
}

/** Items whose refId is absent from the live id set (source deleted). */
export function orphanedItems(items: StudioItem[], liveIds: Set<string>): StudioItem[] {
  return items.filter((i) => !liveIds.has(i.refId));
}

function slug(title: string): string {
  return title.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase().replace(/^-+|-+$/g, "").slice(0, 60) || "diagram";
}

/** PNG filename for an item inside an ordered export set (01-, 02-, ...). */
export function studioSetFileName(index: number, title: string, scale: 2 | 3): string {
  return `${String(index + 1).padStart(2, "0")}-${studioItemPngFileName(title, scale)}`;
}

/** PNG filename for one exported studio item. */
export function studioItemPngFileName(title: string, scale: 2 | 3): string {
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${slug(title)}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}@${scale}x.png`;
}
