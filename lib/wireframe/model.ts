import { z } from "zod";

/**
 * GRAVENX Wireframe Studio - Experience Model (EPIC 01).
 *
 * Source-of-truth rule: the canvas visualizes, this model decides.
 * Every component is a structured, composable IT asset: asset identity +
 * version, `implements` (data contract: Salesforce object / SID entity),
 * `consumes` (APIs: OpenAPI specs, Salesforce REST), `emits` (events /
 * interaction intents). That ODA-aligned contract is what makes a
 * wireframe pluggable anywhere later - portal, storefront, Canvas, agent.
 */

export const SCHEMA_VERSION = 1;

export const COMPONENT_KINDS = [
  "text", "heading", "label", "divider", "spacer",
  "input", "textarea", "number", "currency", "select", "multiselect",
  "checkbox", "radio", "toggle", "date", "datetime", "file",
  "button", "buttongroup", "iconbutton", "link",
  "container", "card", "panel", "tabs", "accordion", "modal", "drawer",
  "header", "sidebar",
  "table", "list", "pagination", "search", "filter",
  "emptystate", "loadingstate", "errorstate",
  "form", "recordheader",
  "sffield", "sflookup", "sfpicklist", "sfrecordform", "sfrelatedlist",
  "sfdatatable", "sfrecordsearch", "sfrecordheader",
  "icon",
] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/** Binding state - first-class, drives badges + schema delta. */
export const BINDING_STATES = ["existing", "proposed", "external"] as const;
export type BindingState = (typeof BINDING_STATES)[number];

export const BINDING_SOURCES = ["salesforce", "rest", "event"] as const;
export type BindingSource = (typeof BINDING_SOURCES)[number];

const dataBindingSchema = z.object({
  source: z.enum(BINDING_SOURCES),
  /** Object / entity, e.g. Account (SID: Party when mapped). */
  object: z.string().min(1).max(120).optional(),
  field: z.string().min(1).max(120).optional(),
  /** Read API ref, e.g. GET /services/data/v66.0/sobjects/Account/:id */
  readApi: z.string().max(300).optional(),
  /** Write API ref, e.g. PATCH /services/data/v66.0/sobjects/Account/:id */
  writeApi: z.string().max(300).optional(),
  /** External label when source is not Salesforce, e.g. "Credit API". */
  externalLabel: z.string().max(120).optional(),
});
export type DataBinding = z.infer<typeof dataBindingSchema>;

const proposedFieldSchema = z.object({
  object: z.string().min(1).max(120),
  apiName: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
  type: z.string().min(1).max(60),
  precision: z.number().int().optional(),
  scale: z.number().int().optional(),
  values: z.array(z.string().max(120)).max(200).optional(),
  required: z.boolean().optional(),
});
export type ProposedField = z.infer<typeof proposedFieldSchema>;

/** ODA-aligned asset contract: what this asset is, needs and emits. */
const odaContractSchema = z.object({
  /** Data contracts implemented, e.g. ["Account", "SID:Party"]. */
  implements: z.array(z.string().max(160)).max(50).default([]),
  /** APIs consumed, e.g. ["OpenAPI:ProductOrder", "REST:PATCH /sobjects/Account/:id"]. */
  consumes: z.array(z.string().max(200)).max(50).default([]),
  /** Events/intents emitted, e.g. ["save:Account", "navigate:confirmation"]. */
  emits: z.array(z.string().max(160)).max(50).default([]),
});
export type OdaContract = z.infer<typeof odaContractSchema>;

const interactionSchema = z.object({
  trigger: z.enum(["click", "change", "load", "submit", "delete"]),
  action: z.string().min(1).max(120),
  /** Target, e.g. "Account" for save, screen id for navigate. */
  target: z.string().max(160).optional(),
});
export type InteractionIntent = z.infer<typeof interactionSchema>;

const validationSchema = z.object({
  required: z.boolean().optional(),
  maxLength: z.number().int().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().max(300).optional(),
});
export type ValidationRule = z.infer<typeof validationSchema>;

const componentSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(COMPONENT_KINDS),
  /** Nesting only - layout inside a screen is flow, never absolute. */
  parentId: z.string().max(80).optional(),
  /** Stable asset identity for cross-screen reuse. */
  assetId: z.string().max(80).optional(),
  label: z.string().max(160).default(""),
  props: z.record(z.string(), z.unknown()).default({}),
  binding: dataBindingSchema.optional(),
  bindingState: z.enum(BINDING_STATES).optional(),
  proposedField: proposedFieldSchema.optional(),
  validation: validationSchema.optional(),
  visibleWhen: z.string().max(300).optional(),
  interaction: interactionSchema.optional(),
  oda: odaContractSchema.optional(),
});
export type WireComponent = z.infer<typeof componentSchema>;

const screenSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  route: z.string().max(200).optional(),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }),
  /** Screens are the only absolutely-positioned unit (canvas world). */
  position: z.object({ x: z.number(), y: z.number() }),
});
export type WireScreen = z.infer<typeof screenSchema>;

const journeySchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  screenIds: z.array(z.string()).max(100).default([]),
});
export type Journey = z.infer<typeof journeySchema>;

export const SNAPSHOT_STATUSES = ["draft", "in-review", "approved"] as const;
export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];

const experienceSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  version: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
  status: z.enum(SNAPSHOT_STATUSES),
  screens: z.array(screenSchema).max(200).default([]),
  components: z.array(componentSchema).max(2000).default([]),
  journeys: z.array(journeySchema).max(50).default([]),
  /** Rollup of every proposedField on components - the Author worklist. */
  proposedFields: z.array(proposedFieldSchema).max(500).default([]),
  /** ODA domain, e.g. "Engagement" - advisory, never certification. */
  domain: z.string().max(80).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Experience = z.infer<typeof experienceSchema>;

export const ExperienceSchema = experienceSchema;

function wid(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    /* fall through */
  }
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newExperience(name: string): Experience {
  const now = Date.now();
  const clean = name.trim().slice(0, 160) || "Untitled experience";
  return {
    id: wid("exp"),
    name: clean,
    version: 1,
    schemaVersion: SCHEMA_VERSION,
    status: "draft",
    screens: [],
    components: [],
    journeys: [],
    proposedFields: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function newScreen(name: string, x = 120, y = 120): WireScreen {
  return {
    id: wid("scr"),
    name: name.trim().slice(0, 120) || "Untitled screen",
    viewport: { width: 390, height: 844 },
    position: { x, y },
  };
}

/** Rename rule: trimmed, capped, null when unchanged/blank (no-op). */
export function renameExperience(exp: Experience, draft: string): Experience | null {
  const clean = draft.trim().slice(0, 160);
  if (!clean || clean === exp.name) return null;
  return { ...exp, name: clean };
}

/**
 * Deep clone for the library workflow: fresh document identity, remapped
 * screen/component ids (parents and journey steps follow), back to draft.
 * Snapshots stay with the original - history never clones.
 */
export function cloneExperience(exp: Experience): Experience {
  const now = Date.now();
  const screenIds = new Map(exp.screens.map((s) => [s.id, wid("scr")]));
  return {
    ...exp,
    id: wid("exp"),
    name: `${exp.name} (copy)`.slice(0, 160),
    version: 1,
    status: "draft",
    screens: exp.screens.map((s) => ({ ...s, id: screenIds.get(s.id)! })),
    components: exp.components.map((c) => ({
      ...c,
      id: wid("cmp"),
      parentId: c.parentId ? (screenIds.get(c.parentId) ?? c.parentId) : c.parentId,
    })),
    journeys: exp.journeys.map((j) => ({
      ...j,
      id: wid("jor"),
      screenIds: j.screenIds.filter((id) => screenIds.has(id)).map((id) => screenIds.get(id)!),
    })),
    createdAt: now,
    updatedAt: now,
  };
}

/** Approval workflow: review first, build only from approved. */
export function canTransition(from: SnapshotStatus, to: SnapshotStatus): boolean {
  if (from === to) return true;
  if (from === "draft" && to === "in-review") return true;
  if (from === "in-review" && (to === "approved" || to === "draft")) return true;
  return false;
}

/** Recompute the proposed-fields rollup from components. */
export function rollupProposedFields(components: WireComponent[]): ProposedField[] {
  const seen = new Set<string>();
  const out: ProposedField[] = [];
  for (const c of components) {
    const p = c.proposedField;
    if (!p) continue;
    const key = `${p.object}.${p.apiName}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export interface OdaManifest {
  component: string;
  version: number;
  domain?: string;
  implements: string[];
  consumes: string[];
  emits: string[];
  screens: { name: string; route?: string; components: number }[];
  schemaDelta: { existing: string[]; proposed: ProposedField[] };
}

/** ODA-aligned export manifest: identity, deps, delta. Advisory, never certification. */
export function buildOdaManifest(exp: Experience): OdaManifest {
  const impl = new Set<string>();
  const cons = new Set<string>();
  const emits = new Set<string>();
  const existing = new Set<string>();
  for (const c of exp.components) {
    if (c.binding?.object && c.bindingState === "existing") {
      existing.add(c.binding.field ? `${c.binding.object}.${c.binding.field}` : c.binding.object);
    }
    for (const i of c.oda?.implements ?? []) impl.add(i);
    for (const a of c.oda?.consumes ?? []) cons.add(a);
    for (const e of c.oda?.emits ?? []) emits.add(e);
    if (c.interaction) emits.add(`${c.interaction.action}:${c.interaction.target ?? c.label}`);
  }
  return {
    component: exp.name,
    version: exp.version,
    domain: exp.domain,
    implements: [...impl].sort(),
    consumes: [...cons].sort(),
    emits: [...emits].sort(),
    screens: exp.screens.map((s) => ({
      name: s.name,
      route: s.route,
      components: exp.components.filter((c) => c.parentId === s.id).length,
    })),
    schemaDelta: { existing: [...existing].sort(), proposed: rollupProposedFields(exp.components) },
  };
}
