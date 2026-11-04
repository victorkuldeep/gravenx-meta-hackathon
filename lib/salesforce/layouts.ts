/**
 * Page-layout reader for the record edit modal: one tab per layout, fields
 * grouped under their layout sections. Served by
 * GET /services/data/vXX.X/sobjects/{object}/describe/layouts through the
 * existing /api/salesforce/rest proxy (any /services/ path passes).
 *
 * Tabs follow record-type mappings ("Master", …): each maps to exactly one
 * layout, which is the page-layout tab the user asked for. Parsing is
 * tolerant - unknown shapes skip silently and the modal falls back to its
 * All-fields tab, so a layout API hiccup never blocks editing.
 */

export interface LayoutFieldItem {
  apiName: string;
  label: string;
  required: boolean;
  /** editableForUpdate on the layout item (describe updateable still rules). */
  layoutEditable: boolean;
}

export interface LayoutSection {
  heading: string;
  rows: LayoutFieldItem[][];
}

export interface ObjectLayout {
  id: string;
  /** Record-type name ("Master", …) - the tab label. */
  name: string;
  defaultLayout: boolean;
  sections: LayoutSection[];
}

export interface LayoutsResult {
  layouts: ObjectLayout[];
}

interface RawComponent {
  type?: unknown;
  value?: unknown;
}

interface RawItem {
  editableForUpdate?: unknown;
  label?: unknown;
  placeholder?: unknown;
  required?: unknown;
  layoutComponents?: unknown;
}

interface RawSection {
  heading?: unknown;
  layoutRows?: unknown;
}

interface RawLayout {
  id?: unknown;
  detailLayoutSections?: unknown;
  editLayoutSections?: unknown;
}

interface RawMapping {
  available?: unknown;
  defaultRecordTypeMapping?: unknown;
  layoutId?: unknown;
  name?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function parseSection(raw: unknown): LayoutSection | null {
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as RawSection;
  const rows: LayoutFieldItem[][] = [];
  for (const row of arr(s.layoutRows)) {
    if (typeof row !== "object" || row === null) continue;
    const items: LayoutFieldItem[] = [];
    const layoutItems = (row as { layoutItems?: unknown }).layoutItems;
    for (const item of arr(layoutItems)) {
      if (typeof item !== "object" || item === null) continue;
      const it = item as RawItem;
      if (it.placeholder === true) continue;
      const comps = arr(it.layoutComponents).filter(
        (c): c is RawComponent => typeof c === "object" && c !== null && (c as RawComponent).type === "Field",
      );
      for (const c of comps) {
        const apiName = str(c.value).trim();
        if (!apiName) continue;
        items.push({
          apiName,
          label: str(it.label).trim() || apiName,
          required: it.required === true,
          layoutEditable: it.editableForUpdate !== false,
        });
      }
    }
    if (items.length > 0) rows.push(items);
  }
  if (rows.length === 0) return null;
  const heading = str(s.heading).trim();
  return { heading: heading || "Fields", rows };
}

function parseLayout(raw: unknown): { id: string; sections: LayoutSection[] } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const l = raw as RawLayout;
  const id = str(l.id).trim();
  if (!id) return null;
  // Edit sections rule the edit modal; detail sections backfill read-only context.
  const edit = arr(l.editLayoutSections);
  const source = edit.length > 0 ? edit : arr(l.detailLayoutSections);
  const sections: LayoutSection[] = [];
  for (const s of source) {
    const parsed = parseSection(s);
    if (parsed) sections.push(parsed);
  }
  if (sections.length === 0) return null;
  return { id, sections };
}

/** Record-type mappings ("Master", …) name the tabs; each names its layout. */
export function parseLayouts(payload: unknown): LayoutsResult {
  if (typeof payload !== "object" || payload === null) return { layouts: [] };
  const p = payload as { layouts?: unknown; recordTypeMappings?: unknown };
  const byId = new Map<string, { id: string; sections: LayoutSection[] }>();
  for (const raw of arr(p.layouts)) {
    const parsed = parseLayout(raw);
    if (parsed) byId.set(parsed.id, parsed);
  }
  const layouts: ObjectLayout[] = [];
  for (const raw of arr(p.recordTypeMappings)) {
    if (typeof raw !== "object" || raw === null) continue;
    const m = raw as RawMapping;
    if (m.available === false) continue;
    const layoutId = str(m.layoutId).trim();
    const hit = byId.get(layoutId);
    if (!hit) continue;
    layouts.push({
      id: hit.id,
      name: str(m.name).trim() || "Layout",
      defaultLayout: m.defaultRecordTypeMapping === true,
      sections: hit.sections,
    });
  }
  // Default record type first, then A-Z - stable tab order.
  layouts.sort((a, b) => Number(b.defaultLayout) - Number(a.defaultLayout) || a.name.localeCompare(b.name));
  return { layouts };
}

/** Minimal request surface so tests inject fixtures without fetch. */
export async function fetchObjectLayouts(
  request: (path: string) => Promise<unknown>,
  apiVersion: string,
  objectApiName: string,
): Promise<LayoutsResult> {
  const ver = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
  const payload = await request(`/services/data/${ver}/sobjects/${objectApiName}/describe/layouts`);
  return parseLayouts(payload);
}
