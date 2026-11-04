import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { SalesforceDescribeResult, SalesforceRecordTypeInfo } from "@/lib/salesforce/types";
import type { ErdTag } from "./tags";

export interface ErdPickValue {
  label: string;
  value: string;
  active: boolean;
  isDefault: boolean;
}

export interface ErdFieldRow {
  name: string;
  /** UI label from describe (falls back to API name). */
  label: string;
  type: string;
  /** Length for text-ish types; precision/scale for number-ish ones. */
  length: number;
  precision: number;
  scale: number;
  /** inlineHelpText - tooltip description, null when absent. */
  description: string | null;
  unique: boolean;
  externalId: boolean;
  calculated: boolean;
  updateable: boolean;
  isId: boolean;
  isName: boolean;
  /** All declared lookup targets, e.g. ["Account", "Opportunity"].
   * Never canvas-filtered: lookup jumps resolve off-canvas. */
  refs: string[];
  /** Resolved at build time from the targets' childRelationships:
   * master-detail when the link cascades deletes, lookup otherwise. */
  refKind?: "lookup" | "master-detail";
  required: boolean;
  /** Picklist options (picklist/multipicklist only, capped). */
  pickValues: ErdPickValue[];
  /** Resolved display label of the loaded lookup target, e.g. "Acme".
   * Key field cascade: Name, then OrderNumber-style fields, else null. */
  refLabel?: string | null;
  /** Authoring sketch: row not yet deployed on the org (amber styling). */
  pending?: boolean;
}

export interface ErdNodeData extends Record<string, unknown> {
  label: string;
  apiName: string;
  custom: boolean;
  /** Object family for the footer tag (standard/custom/setting/metadata/big/external). */
  objectKind: ObjectKind;
  rows: ErdFieldRow[];
  totalFields: number;
  shownChildren: number;
  totalChildren: number;
  isJunction: boolean;
  isRoot: boolean;
  /** Spotlight mode: focused node gets a ring, everything unrelated dims. */
  spotlight: boolean;
  dimmed: boolean;
  /** Link-clicked: related-but-not-focus end of a relationship, dark bold edge. */
  linked: boolean;
  /** Link-clicked focus end of a soft spot: same burgundy frame, no bronze ring. */
  linkFocus: boolean;
  /** True while this node's describe is being refreshed. */
  refreshing: boolean;
  /** User tags (persisted on the canvas project) - footer chips + border tint. */
  tags: ErdTag[];
  /** Open the tag picker for this table (T shortcut). */
  onTagsClick?: (apiName: string) => void;
  /** Remove this table from the canvas (X shortcut → confirm modal). */
  onRemoveClick?: (apiName: string) => void;
  /** Design-note flags (entity notes) - header shows the note icon state. */
  hasNote?: boolean;
  hasTodo?: boolean;
  onNoteClick?: (apiName: string) => void;
  /** Automation footprint (triggers/flows/queues/…) - header Zap icon + total badge. */
  onAutomationClick?: (apiName: string) => void;
  automationTotal?: number | null;
  /** Promote this table to canvas root (shared re-root, both views follow). */
  onMakeRoot?: (apiName: string) => void;
  /** Per-entity pulls: parents / children in one shot, tabbed Custom vs Standard. */
  customParentCount?: number;
  customChildCount?: number;
  standardParentCount?: number;
  standardChildCount?: number;
  onPullCustomParents?: (apiName: string) => void;
  onPullCustomChildren?: (apiName: string) => void;
  /** Copy every field as a Label | API Name table (resolves true on success). */
  onCopyFieldTable?: (apiName: string) => Promise<boolean>;
  /** Copy every field PLUS the visualized record's values as a
   * Label | API Name | Value table - offered only when live data is aboard. */
  onCopyFieldDataTable?: (apiName: string) => Promise<boolean>;
  /** Record-walk eye state: live data aboard, one-click reachable, or locked. */
  recordState?: "live" | "reachable" | "locked";
  /** Record types on the object - badge + popover on the table node. */
  recordTypes: SalesforceRecordTypeInfo[];
  /** Open the record-type popover for this table. */
  onRecordTypesClick?: (apiName: string, anchor: { x: number; y: number; width: number; height: number }) => void;
  recordHint?: string;
  onRecordClick?: (apiName: string, anchor: { x: number; y: number; width: number; height: number }) => void;
  /** Visualized record for this node: selected-row fields (full single when
   * pulled, child-row subset otherwise), its id, and candidate count. */
  recordValues?: Record<string, unknown> | null;
  recordId?: string | null;
  recordCount?: number;
  onRefreshNode?: (id: string) => void;
  /** Schema authoring: canvas is in Author mode (edge drawing + affordances). */
  authorMode?: boolean;
  /** Schema authoring: open the New Field dialog for this object. */
  onAddField?: (apiName: string) => void;
  /** Schema authoring: node is a not-yet-deployed sketch (amber badge). */
  authorPending?: boolean;
  onPicklistClick?: (
    nodeId: string,
    fieldName: string,
    anchor: { x: number; y: number; width: number; height: number }
  ) => void;
  /** Resolved lookup display labels: field -> "label". */
  refLabels?: Record<string, string>;
  /** Lookup jump: click a reference field's label to fetch + view its target. */
  onLookupClick?: (
    sourceApi: string,
    fieldName: string,
    anchor: { x: number; y: number; width: number; height: number }
  ) => void;
  /** Peek-panel single-field edit: resolve the visualized record id + field
   * meta for an updateable field, or null when the field is read-only here. */
  getPeekEdit?: (fieldName: string) => {
    id: string;
    meta: { name: string; label: string; type: string; updateable: boolean; picklistValues?: { label: string; value: string }[] };
  } | null;
  /** PATCH one field from the peek panel, then refresh like any save. */
  onSavePeekField?: (apiName: string, id: string, changes: Record<string, unknown>) => Promise<void>;
}

export const ERD_NODE_WIDTH = 300;
export const ERD_MAX_ROWS = 10;
const ROW_H = 26;
// Fixed chrome heights (nodes must match these exactly - dagre + handle docks depend on them)
export const ERD_HEADER_H = 88;
export const ERD_FOOTER_H = 60;
// Header + rows padding + more-button + footer
const CHROME_H = ERD_HEADER_H + 8 + 22 + ERD_FOOTER_H;

export function erdNodeHeight(rowCount: number): number {
  return CHROME_H + Math.min(rowCount, ERD_MAX_ROWS) * ROW_H;
}

/** Split an API name into meaningful words (namespace + __c stripped). */
export function nameWords(apiName: string): string[] {
  const withoutSuffix = apiName.replace(/__c$/i, "");
  const base = withoutSuffix.includes("__") ? (withoutSuffix.split("__").pop() ?? withoutSuffix) : withoutSuffix;
  return base
    .split("_")
    .flatMap((part) => part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" "))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Bubble initials from the LAST two meaningful segments.
 *
 * First-two-chars collapses teams' prefixed names (DESIGNFORM_PRICING_… and
 * DESIGNFORM_REQUEST_… both read "DE"). Instead: strip __c/namespace, split
 * snake + camel, take initials of the last two segments:
 * DESIGNFORM_PRICING_REQUEST__c → PR, DESIGNFORM_REQUEST_TERM → RT,
 * OrderItem → OI, Lead → LE (single word keeps first two letters).
 * Kept as the per-name fallback; graphs use assignBubbleTags for uniqueness.
 */
export function bubbleInitials(apiName: string): string {
  const segments = nameWords(apiName);
  if (segments.length >= 2) {
    const last = segments.slice(-2);
    return (last[0][0] + last[1][0]).toUpperCase();
  }
  const only = segments[0] ?? apiName;
  return only.slice(0, 2).toUpperCase();
}

/** Candidate tags for one name, in preference order:
 * 1. first letters of first two words (DESIGN_REQUEST__c → DR)
 * 2. FIRST + LAST word (collision escape hatch)
 * 3. FIRST + progressively earlier words (SECOND-LAST and so on)
 * 4. three letters (first-3 initials, else first 3 chars)
 * Numeric suffixes are applied by assignBubbleTags, not here.
 */
export function tagCandidates(apiName: string): string[] {
  const words = nameWords(apiName).map((w) => w.toUpperCase());
  const out: string[] = [];
  const push = (t: string) => {
    if (t && t.length >= 2 && !out.includes(t)) out.push(t);
  };
  if (words.length >= 2) {
    push(words[0][0] + words[1][0]);
    push(words[0][0] + words[words.length - 1][0]);
    for (let k = words.length - 2; k >= 1; k--) {
      push(words[0][0] + words[k][0]);
    }
    if (words.length >= 3) {
      push(words[0][0] + words[1][0] + words[2][0]);
    }
  } else {
    const w = words[0] ?? apiName.toUpperCase();
    push(w.slice(0, 2));
    if (w.length >= 2) push(w[0] + w[w.length - 1]);
    if (w.length >= 3) push(w.slice(0, 3));
  }
  if (out.length === 0) push(apiName.slice(0, 2).toUpperCase());
  return out;
}

/** Assign collision-free bubble tags across one graph, deterministically.
 * Sorted apiNames so the same graph always tags identically; first free
 * candidate wins, then BASE2, BASE3… numeric fallback (always terminates).
 */
export function assignBubbleTags(apiNames: string[]): Map<string, string> {
  const used = new Set<string>();
  const assigned = new Map<string, string>();
  for (const api of [...apiNames].sort()) {
    const cands = tagCandidates(api);
    let tag = cands.find((c) => !used.has(c));
    if (!tag) {
      const base = cands[0] ?? api.slice(0, 2).toUpperCase();
      let n = 2;
      while (used.has(`${base}${n}`)) n++;
      tag = `${base}${n}`;
    }
    used.add(tag);
    assigned.set(api, tag);
  }
  return assigned;
}

function toRow(
  f: {
    name: string;
    label: string;
    type: string;
    length: number;
    precision: number;
    scale: number;
    inlineHelpText: string | null;
    unique: boolean;
    externalId: boolean;
    calculated: boolean;
    updateable: boolean;
    nillable: boolean;
    nameField: boolean;
    referenceTo: string[];
    refKind?: "lookup" | "master-detail";
    picklistValues?: { label: string; value: string; active: boolean; defaultValue: boolean }[] | null;
  }
): ErdFieldRow {
  const isPick = f.type === "picklist" || f.type === "multipicklist";
  return {
    name: f.name,
    label: f.label || f.name,
    type: f.type,
    length: f.length,
    precision: f.precision,
    scale: f.scale,
    description: f.inlineHelpText?.trim() ? f.inlineHelpText.trim() : null,
    unique: f.unique,
    externalId: f.externalId,
    calculated: f.calculated,
    updateable: f.updateable,
    isId: f.name === "Id",
    isName: !!f.nameField,
    /** All declared lookup targets (NOT canvas-filtered): lookup jumps work
     * even when the target object is off-canvas. */
    refs: [...(f.referenceTo ?? [])],
    refKind: f.refKind,
    required: !f.nillable,
    pickValues:
      isPick && Array.isArray(f.picklistValues)
        ? f.picklistValues.slice(0, 100).map((p) => ({
            label: p.label ?? p.value,
            value: p.value,
            active: p.active !== false,
            isDefault: !!p.defaultValue,
          }))
        : [],
  };
}

function orderRows(
  rows: ErdFieldRow[]
): ErdFieldRow[] {
  const rank = (r: ErdFieldRow) =>
    r.isId ? 0 : r.isName ? 1 : r.refs.length > 0 ? 2 : r.required ? 3 : 4;
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Audit/system lookups every standard object carries - never junction evidence. */
const SYSTEM_REF_FIELDS = new Set(["CreatedById", "LastModifiedById", "OwnerId"]);

/**
 * Junction heuristic: 2+ required NON-SYSTEM lookups = classic junction, or
 * a master-detail leg paired with another non-system reference leg
 * (lookup+MD junctions often leave the lookup optional). Audit/system
 * lookups never count. mdIndex maps "ChildObject::field" -> cascadeDelete.
 */
export function detectJunction(
  describe: SalesforceDescribeResult,
  mdIndex: Map<string, boolean>
): boolean {
  const legs = describe.fields.filter(
    (f) =>
      f.type === "reference" &&
      !SYSTEM_REF_FIELDS.has(f.name) &&
      (f.referenceTo?.length ?? 0) > 0
  );
  if (legs.filter((f) => !f.nillable).length >= 2) return true;
  const mdLegs = legs.filter((f) => mdIndex.get(`${describe.name}::${f.name}`) === true);
  return mdLegs.length > 0 && legs.length >= 2;
}

export interface ErdElements {
  nodes: Node<ErdNodeData>[];
  edges: Edge[];
}

/** Handle ids used by ErdTableNode. Joins dock on side edges at header/footer height. */
export const parentExitHandleId = "erd-exit";
export const childEntryHandleId = "erd-entry";
export const loopOutHandleId = "erd-loop-out";
export const loopInHandleId = "erd-loop-in";

export interface ErdSpotlight {
  focus: string;
  related: Set<string>;
  /** Link highlight: ring + frames only, everything else stays as-is (no dim). */
  soft?: boolean;
}

/** Object family for the ERD footer tag. Suffixes first, describe flags after. */
export type ObjectKind = "standard" | "custom" | "custom-setting" | "custom-metadata" | "big-object" | "external";

export const OBJECT_KIND_LABEL: Record<ObjectKind, string> = {
  standard: "Standard",
  custom: "Custom",
  "custom-setting": "Custom Setting",
  "custom-metadata": "Custom Metadata",
  "big-object": "Big Object",
  external: "External",
};

export function objectKindOf(
  d: Pick<SalesforceDescribeResult, "name" | "custom"> & { customSetting?: boolean }
): ObjectKind {
  if (d.name.endsWith("__mdt")) return "custom-metadata";
  if (d.name.endsWith("__b")) return "big-object";
  if (d.name.endsWith("__x")) return "external";
  if (d.customSetting === true) return "custom-setting";
  return d.custom ? "custom" : "standard";
}

/**
 * Build ERD nodes + edges from cached describes.
 * Edges are derived from reference fields and only drawn when BOTH ends are described.
 * `pinned` fixes node positions (drags, restores); newcomers spiral to free space.
 */
export function buildErdElements(
  describes: Map<string, SalesforceDescribeResult>,
  labels: Map<string, string>,
  root: string,
  spot: ErdSpotlight | null = null,
  pinned: Map<string, { x: number; y: number }> | null = null
): ErdElements {
  const nodes: Node<ErdNodeData>[] = [];

  // Index cascade-deletes once: "ChildObject::field" -> master-detail?
  // Lets reference rows report Lookup vs Master-Detail in tooltips.
  const mdIndex = new Map<string, boolean>();
  for (const parent of describes.values()) {
    for (const rel of parent.childRelationships ?? []) {
      if (!rel.relationshipName || !rel.field) continue;
      mdIndex.set(`${rel.childSObject}::${rel.field}`, rel.cascadeDelete);
    }
  }

  // Pass 1 - nodes (edges are built centrally by buildEdges below)
  for (const [apiName, describe] of describes) {
    const allRows = orderRows(
      describe.fields.map((f) =>
        toRow(
          {
            name: f.name,
            label: f.label,
            type: f.type,
            length: f.length,
            precision: f.precision,
            scale: f.scale,
            inlineHelpText: f.inlineHelpText ?? null,
            unique: f.unique,
            externalId: f.externalId,
            calculated: f.calculated,
            updateable: f.updateable,
            nillable: f.nillable,
            nameField: f.nameField,
            referenceTo: f.referenceTo ?? [],
            refKind:
              f.type === "reference" && (f.referenceTo ?? []).length > 0
                ? mdIndex.get(`${apiName}::${f.name}`) === true
                  ? "master-detail"
                  : "lookup"
                : undefined,
            picklistValues: f.picklistValues ?? null,
          }
        )
      )
    );
    const rows = allRows;
    const childRels = (describe.childRelationships ?? []).filter((r) => r.relationshipName);

    nodes.push({
      id: apiName,
      type: "erdTable",
      position: { x: 0, y: 0 },
      data: {
        label: describe.label,
        apiName: describe.name,
        custom: describe.custom,
        objectKind: objectKindOf(describe),
        rows,
        totalFields: describe.fields.length,
        shownChildren: 0, // filled by panel
        totalChildren: childRels.length,
        isJunction: detectJunction(describe, mdIndex),
        isRoot: apiName === root,
        recordTypes: describe.recordTypeInfos ?? [],
        spotlight: spot != null && spot.focus === apiName,
        dimmed: spot != null && spot.soft !== true && spot.focus !== apiName && !spot.related.has(apiName),
        linked: spot != null && spot.focus !== apiName && spot.related.has(apiName),
        linkFocus: spot != null && spot.soft === true && spot.focus === apiName,
        // Panel overrides per live refresh state
        refreshing: false,
        // Panel resolves user tags per node (persisted on the canvas project)
        tags: [],
      },
    });
  }

  const edges = buildEdges(describes);

  return { nodes: layoutErd(nodes, edges, pinned), edges };
}

export type ErdEdgeKind = "md" | "lookup";

export interface ErdEdgeData extends Record<string, unknown> {
  kind: ErdEdgeKind;
  loopLane?: number;
  /** Authoring sketch: relationship not yet deployed (amber styling). */
  pending?: boolean;
}

/**
 * Build relationship edges from cached describes. An edge parent → child
 * exists for every lookup whose BOTH ends are described. Kind comes from the
 * parent's childRelationships cascadeDelete flag (true = master-detail).
 */
export function buildEdges(describes: Map<string, SalesforceDescribeResult>): Edge[] {
  const edges: Edge[] = [];
  const seenEdges = new Set<string>();
  const selfLanes = new Map<string, number>();

  for (const [apiName, describe] of describes) {
    // Parent edges: this object's lookups → described targets
    for (const field of describe.fields) {
      if (field.type !== "reference") continue;
      for (const target of field.referenceTo ?? []) {
        if (!describes.has(target)) continue;
        const key = `${target}|${apiName}|${field.name}`;
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);
        const isLoop = target === apiName;
        let loopLane = 0;
        if (isLoop) {
          loopLane = selfLanes.get(apiName) ?? 0;
          selfLanes.set(apiName, loopLane + 1);
        }
        // Master-detail test: the parent's childRelationship for this exact
        // child + lookup field carries cascadeDelete.
        const parentDescribe = describes.get(target);
        const rel = parentDescribe?.childRelationships?.find(
          (r) => r.childSObject === apiName && r.field === field.name
        );
        const kind: ErdEdgeKind = rel?.cascadeDelete === true ? "md" : "lookup";
        edges.push({
          id: key,
          source: target,
          target: apiName,
          sourceHandle: isLoop ? loopOutHandleId : parentExitHandleId,
          targetHandle: isLoop ? loopInHandleId : childEntryHandleId,
          label: field.name,
          // Custom ERD edge: "one" bar at the parent end, crow's foot at the child end.
          type: "erdEdge",
          data: { kind, ...(isLoop ? { loopLane } : {}) } as ErdEdgeData,
        });
      }
    }
  }

  return edges;
}

// ── Radial graph view ─────────────────────────────────────────────────────

export type GraphNodeRole = "root" | "parent" | "child";

export interface GraphBubbleData extends Record<string, unknown> {
  label: string;
  apiName: string;
  custom: boolean;
  role: GraphNodeRole;
  /** False for not-yet-loaded neighbors (dashed lite bubbles). */
  loaded: boolean;
  childCount: number;
  isJunction: boolean;
  dimmed: boolean;
  spotlight: boolean;
  /** Link-clicked (ERD): related-but-not-focus end of a relationship, dark bold edge. */
  linked?: boolean;
  /** Graph-scoped collision-free tag (assignBubbleTags). Falls back to initials. */
  bubbleTag?: string;
  /** Entity design note attached - bubble shows a marker dot. */
  hasNote?: boolean;
  hasTodo?: boolean;
}

export interface GraphNeighbor {
  apiName: string;
  label: string;
  custom: boolean;
  role: "parent" | "child";
  /** Lookup field (child side) or relationship driving the link. */
  via: string;
  kind: ErdEdgeKind;
  /** Family-tree link: which already-placed node this hangs off. Defaults to root. */
  attachTo?: string;
  /** Generation depth from the root (1 = immediate neighborhood). */
  depth?: number;
}

/**
 * 1-neighborhood of the root: parents from its lookup targets, children from
 * its childRelationships. Neighbors need not be described — lite bubbles carry
 * just enough to render and to load on click.
 */
export function rootNeighbors(
  root: SalesforceDescribeResult,
  labels: Map<string, string>,
  isCustom: (apiName: string) => boolean
): GraphNeighbor[] {
  const out: GraphNeighbor[] = [];
  const seen = new Set<string>();

  for (const f of root.fields ?? []) {
    if (f.type !== "reference") continue;
    for (const target of f.referenceTo ?? []) {
      if (target === root.name || seen.has(`p:${target}`)) continue;
      seen.add(`p:${target}`);
      out.push({
        apiName: target,
        label: labels.get(target) ?? target,
        custom: isCustom(target),
        role: "parent",
        via: f.name,
        kind: "lookup",
      });
    }
  }

  for (const r of root.childRelationships ?? []) {
    if (!r.relationshipName) continue;
    if (r.childSObject === root.name || seen.has(`c:${r.childSObject}`)) continue;
    seen.add(`c:${r.childSObject}`);
    out.push({
      apiName: r.childSObject,
      label: labels.get(r.childSObject) ?? r.childSObject,
      custom: isCustom(r.childSObject),
      role: "child",
      via: r.field,
      kind: r.cascadeDelete === true ? "md" : "lookup",
    });
  }

  return out;
}

/**
 * One family relationship of an entity: the target object, the driving
 * field, and the line kind. Custom sweeps admit custom (__c) fields only;
 * standard sweeps admit real domain-model standard links (audit lookups,
 * Share/Feed/History and platform plumbing never qualify). Self links
 * excluded, first-seen order kept.
 */
export interface FamilyLink {
  target: string;
  via: string;
  kind: ErdEdgeKind;
}
/** Pre-tabs name for FamilyLink. */
export type CustomLink = FamilyLink;

export function customParentLinks(d: SalesforceDescribeResult): FamilyLink[] {
  const out: FamilyLink[] = [];
  const seen = new Set<string>();
  for (const f of d.fields ?? []) {
    if (f.type !== "reference" || !f.name.endsWith("__c")) continue;
    for (const t of f.referenceTo ?? []) {
      if (t === d.name || seen.has(t)) continue;
      seen.add(t);
      out.push({ target: t, via: f.name, kind: "lookup" });
    }
  }
  return out;
}

export function customChildLinks(d: SalesforceDescribeResult): FamilyLink[] {
  const out: FamilyLink[] = [];
  const seen = new Set<string>();
  for (const r of d.childRelationships ?? []) {
    if (!r.relationshipName) continue;
    if (!(r.field ?? "").endsWith("__c")) continue;
    if (r.childSObject === d.name || seen.has(r.childSObject)) continue;
    seen.add(r.childSObject);
    out.push({
      target: r.childSObject,
      via: r.field,
      kind: r.cascadeDelete === true ? "md" : "lookup",
    });
  }
  return out;
}

export function customParentTargets(d: SalesforceDescribeResult): string[] {
  return customParentLinks(d).map((l) => l.target);
}

export function customChildTargets(d: SalesforceDescribeResult): string[] {
  return customChildLinks(d).map((l) => l.target);
}

/**
 * Standard parents: reference fields NOT ending __c, minus audit lookups
 * (CreatedBy, Owner, RecordType…). Contact → Account survives; Contact →
 * User via OwnerId does not. Same dedupe/order contract as the custom
 * sweep. Powers the Standard tab of the per-entity pull picker.
 */
export function standardParentLinks(d: SalesforceDescribeResult): FamilyLink[] {
  const out: FamilyLink[] = [];
  const seen = new Set<string>();
  for (const f of d.fields ?? []) {
    if (f.type !== "reference" || f.name.endsWith("__c")) continue;
    if (AUDIT_REFERENCE_FIELDS.has(f.name)) continue;
    for (const t of f.referenceTo ?? []) {
      if (t === d.name || seen.has(t)) continue;
      if (SYSTEM_OBJECTS.has(t)) continue;
      seen.add(t);
      out.push({ target: t, via: f.name, kind: "lookup" });
    }
  }
  return out;
}

/**
 * Standard children: childRelationships driven by a standard (non-__c)
 * field, minus platform plumbing (Share/Feed/History, Task/Event, notes,
 * files…) via the same systemReason rule the graph uses. Account →
 * Contact/Opportunity/Case survive; Account → Task does not.
 */
export function standardChildLinks(d: SalesforceDescribeResult): FamilyLink[] {
  const out: FamilyLink[] = [];
  const seen = new Set<string>();
  for (const r of d.childRelationships ?? []) {
    if (!r.relationshipName) continue;
    if ((r.field ?? "").endsWith("__c")) continue;
    if (r.childSObject === d.name || seen.has(r.childSObject)) continue;
    if (
      systemReason({
        apiName: r.childSObject,
        role: "child",
        via: r.field,
        custom: /__c$/i.test(r.childSObject),
      }) !== null
    ) {
      continue;
    }
    seen.add(r.childSObject);
    out.push({
      target: r.childSObject,
      via: r.field,
      kind: r.cascadeDelete === true ? "md" : "lookup",
    });
  }
  return out;
}

export function standardParentTargets(d: SalesforceDescribeResult): string[] {
  return standardParentLinks(d).map((l) => l.target);
}

export function standardChildTargets(d: SalesforceDescribeResult): string[] {
  return standardChildLinks(d).map((l) => l.target);
}

// ── System-noise detection (architect-grade Hide-system) ────────────────
// Salesforce litters every object with audit lookups (CreatedBy, Owner…)
// and Share/Feed/History children. These are computed from metadata, not a
// vibes list: audit parents are recognized by the driving FIELD, families by
// name shape, core org objects by identity.

/** Lookup fields that only ever point at audit/system parents. */
export const AUDIT_REFERENCE_FIELDS = new Set([
  "CreatedById",
  "LastModifiedById",
  "OwnerId",
  "RecordTypeId",
]);

/** Core org objects that are never domain model. */
export const SYSTEM_OBJECTS = new Set(["User", "RecordType", "Organization", "Profile"]);

/** Child families that are platform plumbing, not domain model. */
const SYSTEM_CHILD_FAMILIES = ["Share", "Feed", "History"];

/**
 * Ubiquitous platform objects: activities, notes/files, email/messaging,
 * approvals/processes/flows, chatter plumbing. They attach to nearly every
 * domain object, so including them turns any sweep into soup. Applies to
 * STANDARD objects only - custom objects always go deep, even with these
 * names (a custom object can never be one of these identities anyway, but
 * the guard keeps the rule honest).
 */
export const SYSTEM_PLATFORM_OBJECTS = new Set([
  // Activities
  "Task", "Event", "TaskRelation", "EventRelation", "AcceptedEventRelation",
  "ActivityHistory", "OpenActivity",
  // Notes, attachments, files
  "Note", "Attachment", "AttachedContentDocument", "CombinedAttachment",
  "ContentDocument", "ContentDocumentLink", "ContentVersion", "ContentNote",
  // Email & messaging
  "EmailMessage", "EmailStatus", "EmailMessageRelation",
  "MessagingSession", "MessagingEndUser",
  // Approvals, processes, flows
  "ProcessInstance", "ProcessInstanceHistory", "ProcessInstanceNode",
  "ProcessInstanceStep", "ProcessInstanceWorkitem", "ApprovalSubmission",
  "AuthorizationFormConsent", "FlowOrchestrationWorkItem",
  "FlowOrchestrationStage", "FlowInterview",
  // Chatter & collaboration plumbing, setup audit
  "CollaborationGroupRecord", "EntitySubscription", "TopicAssignment",
  "UserDefinedLabelAssignment", "NetworkActivityAudit", "ListEmail",
  // Activity, calls and interactions
  "VoiceCall", "VideoCall", "Visit", "EngagementTopic",
  // Document and content infrastructure
  "AttachedContentNote", "GeneratedDocument", "DocumentEnvelope",
  "DocumentChecklistItem", "NoteAndAttachment",
  // System actions and alerts
  "RecordAction", "RecordAlert", "ProcessException", "DuplicateRecordItem",
  // Experience Cloud and OmniStudio
  "NetworkUserHistoryRecent", "OmniAssessmentTask", "GenericVisitTaskContext",
]);

/**
 * Why a graph neighbor counts as system noise, or null when it is real
 * domain model. Parents qualify ONLY via audit fields; children qualify by
 * Share/Feed/History family, platform identity, or core-org identity.
 * Custom objects are exempt (except core-org identity, which is impossible
 * for custom) - custom always goes deep.
 */
export function systemReason(n: { apiName: string; role: "parent" | "child"; via: string; custom?: boolean }): string | null {
  if (SYSTEM_OBJECTS.has(n.apiName)) return "system object";
  if (n.role === "parent" && AUDIT_REFERENCE_FIELDS.has(n.via)) return `audit lookup (${n.via})`;
  if (n.custom) return null;
  if (SYSTEM_PLATFORM_OBJECTS.has(n.apiName)) return "platform object";
  if (n.role === "child" && SYSTEM_CHILD_FAMILIES.some((fam) => n.apiName.endsWith(fam))) {
    return "platform family";
  }
  return null;
}

/** Object-level check for the ERD canvas (no via context there). */
export function isSystemObject(apiName: string, custom = false): boolean {
  return (
    SYSTEM_OBJECTS.has(apiName) ||
    (!custom &&
      (SYSTEM_PLATFORM_OBJECTS.has(apiName) ||
        SYSTEM_CHILD_FAMILIES.some((fam) => apiName.endsWith(fam))))
  );
}

/** Single predicate for sweeps (Neural): never touch system nodes, and never
 * traverse through them either. Custom objects always pass. */
export function isNeuralExcluded(apiName: string, custom: boolean): boolean {
  return isSystemObject(apiName, custom);
}

/**
 * Effective hide decision honoring the user's allow-list: an explicitly
 * allowed name stays visible (and sweepable) even when the system definition
 * flags it. The same predicate drives Hide-system AND Neural, so whatever
 * the modal hides is automatically honored by sweeps.
 */
export function isEffectivelyHidden(apiName: string, custom: boolean, allow: Set<string>): boolean {
  if (allow.has(apiName)) return false;
  return isSystemObject(apiName, custom);
}

const BUBBLE_ROOT = 104;const BUBBLE_NODE = 80;

// Scatter orbits: bubbles sit on concentric rings so dense fans never share
// one crowded circle. Orbits are UNBOUNDED - the ring list grows until every
// neighbor has a slot, because the canvas scrolls/zooms and nothing may hide.
// Kept under 180° so big fans stay wider than tall (never a vertical pipe).
// GENEROUS spacing: rings start far out and step wide, bubbles keep ~2.5
// diameters - Neural-scale sweeps must read as a scattered sky, not a
// crowded core. fitView zooms to fit; the user scrolls for the whole tree.
const ORBIT_0 = 520;
const ORBIT_STEP = 300;
const ARC_DEG = 140;
const MIN_GAP = 200;

function orbitSlots(radius: number): number[] {
  const arcLen = radius * ((ARC_DEG * Math.PI) / 180);
  const n = Math.max(3, Math.floor(arcLen / MIN_GAP));
  return Array.from({ length: n }, (_, i) => -ARC_DEG / 2 + (ARC_DEG * i) / Math.max(1, n - 1));
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export interface GraphElements {
  nodes: Node<GraphBubbleData>[];
  edges: Edge[];
  /** Neighbors left out for lack of room - panel surfaces the count. */
  overflow: number;
  /** Family-tree nodes placed beyond level 1. */
  extended: number;
}

/**
 * Radial scatter: root at origin, parents fanning left, children fanning
 * right, spread across concentric orbits. Greedy fill - each bubble takes the
 * first free slot starting from the inner orbit, so dense neighborhoods spill
 * outward like stars instead of piling onto one ring. Fully deterministic:
 * same input, same sky. Anything past capacity is counted as overflow.
 * Lite (undescribed) neighbors render dashed and load on click.
 */
export function buildGraphElements(
  root: SalesforceDescribeResult,
  neighbors: GraphNeighbor[],
  described: Set<string>,
  spot: ErdSpotlight | null = null,
  pinned: Map<string, { x: number; y: number }> | null = null,
  mode: "mesh" | "linear" = "mesh"
): GraphElements {
  const shown = neighbors;
  const overflow = 0;
  // Full 1-level neighborhood + family-tree generations: every neighbor gets
  // a bubble. Described ones are solid; undescribed ones are dashed lite
  // previews that load on click. Depth-1 fans left/right off the root;
  // deeper generations extend outward from their attachTo node so chains
  // read like a family tree instead of piling onto the root. Orbit rings
  // grow without bound - the infinite canvas scrolls, nothing hides.
  const depthOf = (n: GraphNeighbor) => n.depth ?? 1;
  // Level-1 dedupe by apiName (first wins = root fan order): neural sweeps
  // re-list root neighbors as depth-1 rows, and without this they would mint
  // duplicate p:/c: node ids. Deeper generations dedupe by attach path
  // instead (mesh shares, linear duplicates) - see byAttach handling below.
  const seenL1 = new Set<string>();
  const level1 = shown.filter((n) => {
    if (depthOf(n) > 1) return false;
    if (seenL1.has(n.apiName)) return false;
    seenL1.add(n.apiName);
    return true;
  });
  const deeper = shown.filter((n) => depthOf(n) > 1);
  const parents = level1.filter((n) => n.role === "parent");
  const children = level1.filter((n) => n.role === "child");

  // Root MD legs from the neighborhood: parent-role neighbors whose kind is
  // "md" carry the same cascadeDelete evidence the ERD edges use.
  const rootMd = new Map<string, boolean>();
  for (const n of neighbors) {
    if (n.role === "parent" && n.kind === "md" && n.via) rootMd.set(`${root.name}::${n.via}`, true);
  }
  const nodes: Node<GraphBubbleData>[] = [
    {
      id: root.name,
      type: "graphBubble",
      position: { x: -BUBBLE_ROOT / 2, y: -BUBBLE_ROOT / 2 },
      data: {
        label: root.label,
        apiName: root.name,
        custom: root.custom,
        role: "root",
        loaded: true,
        childCount: (root.childRelationships ?? []).filter((r) => r.relationshipName).length,
        isJunction: detectJunction(root, rootMd),
        dimmed: false,
        spotlight: false,
      },
    },
  ];
  const edges: Edge[] = [];
  // Emergency-slot counter for the guaranteed-placement fallback below.
  let placedEmergency = 0;

  // Occupied points: root center + any pinned (dragged) bubbles, matched by
  // bare API name or prefixed graph id.
  const occupied: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  if (pinned) {
    const seen = new Set<string>();
    for (const [key, p] of pinned) {
      const api = key.includes(":") ? key.split(":").slice(1).join(":") : key;
      if (api !== root.name && !seen.has(api)) {
        seen.add(api);
        occupied.push({ x: p.x + BUBBLE_NODE / 2, y: p.y + BUBBLE_NODE / 2 });
      }
    }
  }

  const place = (
    list: GraphNeighbor[],
    centerDeg: number,
    prefix: string
  ) => {
    // Unbounded rings: keep adding orbit lanes until every bubble lands.
    // If 40 lanes still collide (pathological), force a far slot - placement
    // NEVER fails, so the panel never needs an orbit-room badge.
    const taken: boolean[][] = [];
    const slotAngles: number[][] = [];
    const ringRadius = (o: number) => ORBIT_0 + o * ORBIT_STEP;
    const ensureLane = (o: number) => {
      while (taken.length <= o) {
        const r = ringRadius(taken.length);
        taken.push([]);
        slotAngles.push(orbitSlots(r));
      }
    };
    ensureLane(2);
    list.forEach((n) => {
      let placed: { x: number; y: number } | null = null;
      for (let o = 0; o < 40 && !placed; o++) {
        ensureLane(o);
        const angles = slotAngles[o];
        // Start near the middle and alternate outward for a balanced fan
        const order = [...angles.keys()].sort((a, b) => {
          const da = Math.abs(a - (angles.length - 1) / 2);
          const db = Math.abs(b - (angles.length - 1) / 2);
          return da - db || a - b;
        });
        for (const si of order) {
          if (taken[o][si]) continue;
          const rad = ((centerDeg + angles[si]) * Math.PI) / 180;
          const p = { x: ringRadius(o) * Math.cos(rad), y: ringRadius(o) * Math.sin(rad) };
          if (occupied.some((q) => dist(p, q) < MIN_GAP)) continue;
          taken[o][si] = true;
          placed = p;
          break;
        }
      }
      if (!placed) {
        // Emergency slot: far out on the fan edge - always free by construction.
        const r = ringRadius(40 + (placedEmergency++ % 40));
        const edge = centerDeg + (placedEmergency % 2 === 0 ? ARC_DEG / 2 : -ARC_DEG / 2);
        const rad = (edge * Math.PI) / 180;
        placed = { x: r * Math.cos(rad), y: r * Math.sin(rad) };
      }
      occupied.push(placed);
      const loaded = described.has(n.apiName);
      nodes.push({
        id: `${prefix}:${n.apiName}`,
        type: "graphBubble",
        position: { x: placed.x - BUBBLE_NODE / 2, y: placed.y - BUBBLE_NODE / 2 },
        data: {
          label: n.label,
          apiName: n.apiName,
          custom: n.custom,
          role: n.role,
          loaded,
          childCount: 0,
          isJunction: false,
          dimmed: spot != null && spot.focus !== n.apiName && !spot.related.has(n.apiName),
          spotlight: spot != null && spot.focus === n.apiName,
        },
      });
      const isParentSide = n.role === "parent";
      edges.push({
        id: `g|${root.name}|${n.apiName}|${n.via}`,
        source: isParentSide ? `${prefix}:${n.apiName}` : root.name,
        target: isParentSide ? root.name : `${prefix}:${n.apiName}`,
        label: n.via,
        type: "erdEdge",
        data: { kind: n.kind, graphLink: true, target: n.apiName, loaded } as Record<string, unknown>,
      });
    });
  };

  const before = nodes.length;
  const placedCenters = new Map<string, { x: number; y: number }>();
  placedCenters.set(root.name, { x: 0, y: 0 });
  // Bubble id lookup: every placed node by bare apiName → its ACTUAL node id
  // (root / p:X / c:X / x:FROM:X). Extended edges resolve through this so a
  // generation hanging off a level-1 bubble (Account→Asset) links bubble to
  // bubble instead of dangling at a bare name React Flow can't see.
  const bubbleIdOf = (api: string): string => {
    if (api === root.name) return root.name;
    const found = nodes.slice(before).find((n) => (n.data as GraphBubbleData).apiName === api);
    if (found) return found.id;
    const l1 = nodes.slice(0, before).find((n) => (n.data as GraphBubbleData).apiName === api);
    return l1 ? l1.id : api;
  };
  place(parents, 180, "p");
  place(children, 0, "c");
  // Record level-1 centers so deeper generations can extend from them.
  for (const n of nodes.slice(before)) {
    const api = (n.data as GraphBubbleData).apiName;
    placedCenters.set(api, { x: n.position.x + BUBBLE_NODE / 2, y: n.position.y + BUBBLE_NODE / 2 });
  }
  // Family-tree generations: grow as a proper left/right tree. Each node's
  // children march RIGHT in a column, parents march LEFT - siblings stacked
  // vertically with full bubble room (the canvas scrolls; nothing squeezes
  // into the viewport). Lanes walk further in x until a slot is free, so
  // dense sweeps read as a scattered big tree, never a tight vertical pipe.
  const EXTEND_SPREAD = 200;
  const EXTEND_R0 = 520;
  const EXTEND_RSTEP = 320;
  const byAttach = new Map<string, GraphNeighbor[]>();
  for (const n of deeper) {
    const key = n.attachTo ?? root.name;
    if (!byAttach.has(key)) byAttach.set(key, []);
    byAttach.get(key)!.push(n);
  }
  let extended = 0;
  // Edge ids must be unique per from/to/via triple - the SAME object under
  // two parents (Lead>D&B and Account>D&B) yields two honest edges in mesh
  // mode instead of one silently dropped link. Ids stay api-based (stable
  // across layouts); linear duplicates append the node id.
  const seenEdge = new Set<string>(edges.map((e) => e.id));
  const emitEdge = (fromApi: string, toApi: string, fromBubble: string, toBubble: string, n: GraphNeighbor, loaded: boolean) => {
    const id = mode === "linear" && toBubble.startsWith("x:")
      ? `g|${fromApi}|${toApi}|${n.via}|${toBubble}`
      : `g|${fromApi}|${toApi}|${n.via}`;
    if (seenEdge.has(id)) return;
    seenEdge.add(id);
    edges.push({
      id,
      source: fromBubble,
      target: toBubble,
      label: n.via,
      type: "erdEdge",
      data: { kind: n.kind, graphLink: true, target: n.apiName, loaded } as Record<string, unknown>,
    });
  };
  for (const [attachApi, list] of [...byAttach.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const center = placedCenters.get(attachApi);
    if (!center) continue;
    const attachBubble = bubbleIdOf(attachApi);
    const ordered = [...list].sort((a, b) => (a.apiName < b.apiName ? -1 : 1));
    ordered.forEach((n, i) => {
      const up = n.role === "parent";
      const loaded = described.has(n.apiName);
      if (mode === "mesh" && placedCenters.has(n.apiName)) {
        // Already drawn elsewhere: link the attach bubble to the EXISTING
        // bubble instead of skipping. This is the honest mesh edge.
        emitEdge(
          attachApi,
          n.apiName,
          up ? bubbleIdOf(n.apiName) : attachBubble,
          up ? attachBubble : bubbleIdOf(n.apiName),
          n,
          loaded
        );
        return;
      }
      const side = up ? -1 : 1;
      const spread0 = (i - (ordered.length - 1) / 2) * EXTEND_SPREAD;
      // Columnar tree growth: same x-column per generation, siblings stacked
      // at EXTEND_SPREAD apart around the attach node's y. Lanes push the
      // column further right/left until a slot frees. Guaranteed: the final
      // fallback keeps marching out, so every node lands.
      let p: { x: number; y: number } | null = null;
      for (let lane = 0; lane < 80 && !p; lane++) {
        const xStep = EXTEND_R0 + lane * EXTEND_RSTEP;
        const cand = { x: center.x + side * xStep, y: center.y + spread0 };
        if (!occupied.some((q) => dist(cand, q) < MIN_GAP)) p = cand;
      }
      if (!p) {
        const r = EXTEND_R0 + (40 + placedEmergency++ % 40) * EXTEND_RSTEP;
        p = { x: center.x + side * r, y: center.y + spread0 };
      }
      occupied.push(p);
      // Linear mode: same object under several parents gets its OWN bubble
      // per attach path (x:Account:D&B ≠ x:Lead:D&B) so each subtree reads
      // independently. Mesh mode shares one bubble (handled above).
      const nodeId = mode === "linear" ? `x:${attachApi}:${n.apiName}:${extended}` : `x:${attachApi}:${n.apiName}`;
      if (mode === "linear") placedCenters.set(`${attachApi}::${n.apiName}`, p);
      else placedCenters.set(n.apiName, p);
      const isLoaded = described.has(n.apiName);
      nodes.push({
        id: nodeId,
        type: "graphBubble",
        position: { x: p.x - BUBBLE_NODE / 2, y: p.y - BUBBLE_NODE / 2 },
        data: {
          label: n.label,
          apiName: n.apiName,
          custom: n.custom,
          role: n.role,
          loaded: isLoaded,
          childCount: 0,
          isJunction: false,
          dimmed: spot != null && spot.focus !== n.apiName && !spot.related.has(n.apiName),
          spotlight: spot != null && spot.focus === n.apiName,
        },
      });
      emitEdge(
        attachApi,
        n.apiName,
        up ? nodeId : bubbleIdOf(attachApi),
        up ? bubbleIdOf(attachApi) : nodeId,
        n,
        isLoaded
      );
      extended++;
    });
  }
  const unplaced = shown.length - (nodes.length - before);

  // Graph-scoped collision-free tags: same names always tag identically.
  const tags = assignBubbleTags(nodes.map((n) => (n.data as GraphBubbleData).apiName));
  for (const n of nodes) {
    (n.data as GraphBubbleData).bubbleTag = tags.get((n.data as GraphBubbleData).apiName);
  }

  return { nodes, edges, overflow: overflow + unplaced, extended };
}

export function layoutErd(
  nodes: Node<ErdNodeData>[],
  edges: Edge[],
  pinned?: Map<string, { x: number; y: number }> | null
): Node<ErdNodeData>[] {
  if (nodes.length === 0) return nodes;
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 56, ranksep: 120, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  const heights = new Map<string, number>();
  for (const n of nodes) {
    const h = erdNodeHeight((n.data as ErdNodeData).rows.length);
    heights.set(n.id, h);
    g.setNode(n.id, { width: ERD_NODE_WIDTH, height: h });
  }
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  const placed = nodes.map((n) => {
    const p = g.node(n.id);
    const h = heights.get(n.id) ?? 200;
    return { ...n, position: { x: p.x - ERD_NODE_WIDTH / 2, y: p.y - h / 2 } };
  });

  if (!pinned || pinned.size === 0) return placed;

  // 1. Honor pins (user drags + restored snapshots)
  const byId = new Map(placed.map((n) => [n.id, n]));
  for (const [id, p] of pinned) {
    const n = byId.get(id);
    if (n) n.position = { ...p };
  }

  // 2. Push every unpinned node out of overlap - radially away from the
  // clash partner's center, so newcomers cascade to free space instead of
  // stacking under pinned nodes. Pinned nodes (drags, restores) never move.
  const GAP = 28;
  const STEP = 40;
  const rectOf = (n: (typeof placed)[number]) => ({
    x: n.position.x,
    y: n.position.y,
    w: ERD_NODE_WIDTH,
    h: heights.get(n.id) ?? 200,
  });
  const hits = (a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>) =>
    a.x < b.x + b.w + GAP &&
    b.x < a.x + a.w + GAP &&
    a.y < b.y + b.h + GAP &&
    b.y < a.y + a.h + GAP;
  const centerOf = (r: ReturnType<typeof rectOf>) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

  for (const n of placed) {
    if (pinned.has(n.id)) continue;
    let r = rectOf(n);
    let tries = 0;
    while (tries < 200) {
      const clash = placed.find((m) => m.id !== n.id && hits(r, rectOf(m)));
      if (!clash) break;
      tries++;
      const c = centerOf(rectOf(clash));
      const s = centerOf(r);
      let dx = s.x - c.x;
      let dy = s.y - c.y;
      // Dead-center stack (the Lead/Account case): cascade down-right.
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        dx = 1;
        dy = 0.6;
      }
      const len = Math.hypot(dx, dy);
      r = { ...r, x: r.x + (dx / len) * STEP, y: r.y + (dy / len) * STEP };
      n.position = { x: r.x, y: r.y };
    }
  }

  return placed;
}
