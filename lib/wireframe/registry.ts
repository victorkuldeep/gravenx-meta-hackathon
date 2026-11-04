import type { ComponentKind, WireComponent } from "./model";

/**
 * Wireframe component registry (EPIC 03). One definition per kind drives
 * the palette, defaults and renderers - no bespoke files per component.
 * Container kinds nest children; everything else is a leaf.
 */

export type PaletteCategory = "Foundation" | "Form" | "Actions" | "Icons" | "Layout" | "Data" | "Salesforce";

export interface ComponentDef {
  kind: ComponentKind;
  label: string;
  category: PaletteCategory;
  container: boolean;
  defaultLabel: string;
  defaultProps: Record<string, unknown>;
}

function def(kind: ComponentKind, label: string, category: PaletteCategory, extra?: Partial<ComponentDef>): ComponentDef {
  return {
    kind,
    label,
    category,
    container: false,
    defaultLabel: label,
    defaultProps: {},
    ...extra,
  };
}

const TEXT = (kind: ComponentKind, label: string, defaultLabel: string) =>
  def(kind, label, "Foundation", { defaultLabel });

export const COMPONENT_REGISTRY: ComponentDef[] = [
  TEXT("text", "Text", "Body copy"),
  TEXT("heading", "Heading", "Section title"),
  TEXT("label", "Label", "Field label"),
  def("divider", "Divider", "Foundation", { defaultLabel: "" }),
  def("spacer", "Spacer", "Foundation", { defaultLabel: "", defaultProps: { height: 16 } }),

  def("input", "Text Input", "Form", { defaultLabel: "Full name" }),
  def("textarea", "Textarea", "Form", { defaultLabel: "Notes" }),
  def("number", "Number", "Form", { defaultLabel: "Quantity" }),
  def("currency", "Currency", "Form", { defaultLabel: "Amount" }),
  def("select", "Select", "Form", { defaultLabel: "Country", defaultProps: { options: ["Option A", "Option B"] } }),
  def("multiselect", "Multi-select", "Form", { defaultLabel: "Interests", defaultProps: { options: ["Option A", "Option B"] } }),
  def("checkbox", "Checkbox", "Form", { defaultLabel: "Subscribe" }),
  def("radio", "Radio", "Form", { defaultLabel: "Choice", defaultProps: { options: ["Yes", "No"] } }),
  def("toggle", "Toggle", "Form", { defaultLabel: "Enabled" }),
  def("date", "Date", "Form", { defaultLabel: "Start date" }),
  def("datetime", "Date / Time", "Form", { defaultLabel: "Appointment" }),
  def("file", "File Upload", "Form", { defaultLabel: "Attachment" }),

  def("button", "Button", "Actions", { defaultLabel: "Save" }),
  def("buttongroup", "Button Group", "Actions", { defaultLabel: "", defaultProps: { buttons: ["Save", "Cancel"] } }),
  def("iconbutton", "Icon Button", "Actions", { defaultLabel: "" }),
  def("link", "Link", "Actions", { defaultLabel: "Learn more" }),

  def("icon", "Icon", "Icons", { defaultLabel: "", defaultProps: { icon: "star" } }),

  def("container", "Container", "Layout", { defaultLabel: "", container: true }),
  def("card", "Card", "Layout", { defaultLabel: "Details", container: true }),
  def("panel", "Panel", "Layout", { defaultLabel: "Panel", container: true }),
  def("tabs", "Tabs", "Layout", { defaultLabel: "", defaultProps: { tabs: ["Tab 1", "Tab 2"] }, container: true }),
  def("accordion", "Accordion", "Layout", { defaultLabel: "Section", container: true }),
  def("modal", "Modal", "Layout", { defaultLabel: "Confirm", container: true }),
  def("drawer", "Drawer", "Layout", { defaultLabel: "Filters", container: true }),
  def("header", "Header", "Layout", { defaultLabel: "Screen title" }),
  def("sidebar", "Sidebar", "Layout", { defaultLabel: "", container: true }),
  def("form", "Form", "Layout", { defaultLabel: "Record form", container: true }),
  def("recordheader", "Record Header", "Layout", { defaultLabel: "Account" }),

  def("table", "Table", "Data", { defaultLabel: "Records", defaultProps: { columns: ["Name", "Type"], rows: 3 } }),
  def("list", "Data List", "Data", { defaultLabel: "Items", defaultProps: { rows: 3 } }),
  def("pagination", "Pagination", "Data", { defaultLabel: "" }),
  def("search", "Search", "Data", { defaultLabel: "Search records" }),
  def("filter", "Filter", "Data", { defaultLabel: "Filter" }),
  def("emptystate", "Empty State", "Data", { defaultLabel: "No records yet" }),
  def("loadingstate", "Loading State", "Data", { defaultLabel: "Loading…" }),
  def("errorstate", "Error State", "Data", { defaultLabel: "Something went wrong" }),

  def("sffield", "Salesforce Field", "Salesforce", { defaultLabel: "Field" }),
  def("sflookup", "Salesforce Lookup", "Salesforce", { defaultLabel: "Lookup" }),
  def("sfpicklist", "Salesforce Picklist", "Salesforce", { defaultLabel: "Picklist", defaultProps: { options: ["Value A", "Value B"] } }),
  def("sfrecordform", "Record Form", "Salesforce", { defaultLabel: "Record", container: true }),
  def("sfrelatedlist", "Related List", "Salesforce", { defaultLabel: "Related" }),
  def("sfdatatable", "Data Table", "Salesforce", { defaultLabel: "Records", defaultProps: { columns: ["Name"], rows: 3 } }),
  def("sfrecordsearch", "Record Search", "Salesforce", { defaultLabel: "Search" }),
  def("sfrecordheader", "Record Header", "Salesforce", { defaultLabel: "Record" }),
];

const BY_KIND = new Map<ComponentKind, ComponentDef>(COMPONENT_REGISTRY.map((d) => [d.kind, d]));

export function defFor(kind: ComponentKind): ComponentDef {
  const d = BY_KIND.get(kind);
  if (!d) throw new Error(`Unknown component kind: ${kind}`);
  return d;
}

export function paletteByCategory(): { category: PaletteCategory; items: ComponentDef[] }[] {
  const order: PaletteCategory[] = ["Foundation", "Form", "Actions", "Icons", "Layout", "Data", "Salesforce"];
  return order.map((category) => ({ category, items: COMPONENT_REGISTRY.filter((d) => d.category === category) }));
}

function nid(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    /* fall through */
  }
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newComponent(kind: ComponentKind, parentId: string, label?: string): WireComponent {
  const d = defFor(kind);
  return {
    id: nid("cmp"),
    kind,
    parentId,
    label: (label ?? d.defaultLabel).slice(0, 160),
    props: { ...d.defaultProps },
  };
}

/** Children of a node in flow order (array order). */
export function childrenOf(components: WireComponent[], parentId: string): WireComponent[] {
  return components.filter((c) => c.parentId === parentId);
}

/** Remove a component plus its whole subtree. */
export function removeSubtree(components: WireComponent[], id: string): WireComponent[] {
  const doomed = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of components) {
      if (c.parentId && doomed.has(c.parentId) && !doomed.has(c.id)) {
        doomed.add(c.id);
        grew = true;
      }
    }
  }
  return components.filter((c) => !doomed.has(c.id));
}

/** Shallow-merge a patch onto one component. */
export function patchComponent(
  components: WireComponent[],
  id: string,
  patch: Partial<WireComponent>,
): WireComponent[] {
  return components.map((c) => (c.id === id ? { ...c, ...patch, id: c.id, kind: c.kind } : c));
}

/** Move within siblings: -1 up, +1 down. No-op at the edges. */
export function reorderSibling(components: WireComponent[], id: string, dir: -1 | 1): WireComponent[] {
  const idx = components.findIndex((c) => c.id === id);
  if (idx < 0) return components;
  const parent = components[idx].parentId;
  const sibs = components.filter((c) => c.parentId === parent);
  const at = sibs.findIndex((c) => c.id === id);
  const swap = sibs[at + dir];
  if (!swap) return components;
  const a = components.findIndex((c) => c.id === id);
  const b = components.findIndex((c) => c.id === swap.id);
  const next = [...components];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
