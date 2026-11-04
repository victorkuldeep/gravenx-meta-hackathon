/**
 * ERD live-bridge command handlers.
 *
 * Pure mapping layer between the tab↔hub bridge protocol
 * (`erd.snapshot`, `erd.discover`, `erd.place`, `erd.focus`, `erd.mode`,
 * `erd.filter`, `erd.author_field`, `erd.author_object`, `arch.activity`,
 * `bridge.ping`)
 * and the live SchemaPanel state. SchemaPanel builds one context object from
 * its state and registers these handlers once; every handler reads the latest
 * state through the context getters so results never go stale.
 *
 * Reads (snapshot/ping/discover-shape) execute immediately; writes pause for
 * the architect's in-tab approval in the inbox before they run. Handlers never
 * see tokens - they call the same session-backed callbacks the UI uses.
 */

import { BRIDGE_PROTOCOL_V } from "./protocol";
import type { BridgeHandler } from "./registry";
import { listArchActivity } from "../erd-activity";
import { createTag, ERD_TAG_COLORS } from "../erd/tags";
import type {
  DesignFieldType,
  FieldDraft,
  ObjectDraft,
} from "../salesforce/design";
import {
  defaultFieldDraft,
  defaultObjectDraft,
  relationshipNameFromField,
} from "../salesforce/design";
import type { SalesforceDescribeResult } from "../salesforce/types";

export type ErdFilterMode = "all" | "standard" | "custom" | "manual";

/** Minimal ERD state surface the handlers need. */
export interface ErdBridgeContext {
  /** All known objects (SchemaPanel `objects` prop: { name, label }). */
  objects: { name: string; label: string }[];
  /** Live canvas membership: api name -> describe. */
  describes: Map<string, SalesforceDescribeResult>;
  rootName: string;
  focusName: string;
  view: "erd" | "graph";
  hideSystem: boolean;
  filterMode: ErdFilterMode;
  tagRegistry: { id: string; name: string; color: string }[];
  nodeTags: Record<string, string[]>;
  authorMode: boolean;
  /** Current ReactFlow node positions keyed by object api name. */
  nodePositions: () => Record<string, { x: number; y: number }>;
  focusCanvasOn: (name: string) => void;
  setFocusName: (name: string) => void;
  setView: (view: "erd" | "graph") => void;
  setHideSystem: (hide: boolean) => void;
  /** Fetch describes + merge onto canvas (mirrors the Add/Discover flow). */
  addNames: (names: string[]) => Promise<SalesforceDescribeResult[]>;
  /** Describe through the org cache (null on failure, no throw). */
  describeCached: (name: string) => Promise<SalesforceDescribeResult | null>;
  /** Hide (reversible) or unhide canvas nodes. */
  hideNames: (names: string[], hide: boolean) => void;
  /** Remove nodes from the canvas (re-add via place). */
  removeNames: (names: string[]) => void;
  setFilterMode: (mode: ErdFilterMode) => void;
  upsertTag: (tag: { id: string; name: string; color: string }) => void;
  assignTag: (tagId: string, names: string[], on: boolean) => void;
  deleteTag: (tagId: string) => void;
  /** Author-mode submit paths - open the same deploy confirms as the UI. */
  submitAuthorField: (draft: FieldDraft, childApi: string) => Promise<void>;
  submitAuthorObject: (draft: ObjectDraft) => Promise<void>;
}

export const ERD_BRIDGE_KINDS = [
  "bridge.ping",
  "arch.activity",
  "erd.snapshot",
  "erd.objects",
  "erd.discover",
  "erd.hide",
  "erd.remove",
  "erd.tags",
  "erd.place",
  "erd.focus",
  "erd.mode",
  "erd.filter",
  "erd.author_field",
  "erd.author_object",
] as const;

const FIELD_TYPES: DesignFieldType[] = [
  "Text",
  "TextArea",
  "LongTextArea",
  "Number",
  "Percent",
  "Currency",
  "Checkbox",
  "Date",
  "DateTime",
  "Email",
  "Phone",
  "Url",
  "Picklist",
  "Lookup",
  "MasterDetail",
];

function strArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === "string" ? v.trim() : "";
}

function strListArg(args: Record<string, unknown>, key: string): string[] {
  const v = args[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

/**
 * Resolve a human ref ("account", "Order", "acme__Invoice__c") to the exact
 * object api name. Exact api-name match wins; exact label match next; a single
 * substring hit auto-resolves; several hits throw an ambiguous error that
 * lists candidates so the agent can ask the architect to pick one.
 */
export function resolveObjectRef(
  objects: { name: string; label: string }[],
  ref: string,
): string {
  const q = ref.trim();
  if (!q) throw new Error("Object reference is empty.");
  const lower = q.toLowerCase();
  const byApi = objects.find((o) => o.name.toLowerCase() === lower);
  if (byApi) return byApi.name;
  const byLabel = objects.find((o) => o.label.toLowerCase() === lower);
  if (byLabel) return byLabel.name;
  const hits = objects.filter(
    (o) => o.name.toLowerCase().includes(lower) || o.label.toLowerCase().includes(lower),
  );
  if (hits.length === 1) return hits[0].name;
  if (hits.length === 0) throw new Error(`Unknown object "${q}" - no api name or label matches.`);
  const list = hits.slice(0, 8).map((o) => o.name).join(", ");
  throw new Error(`Ambiguous object "${q}" - matches ${hits.length}: ${list}. Ask for the exact api name.`);
}

export interface ErdSnapshot {
  nodes: { apiName: string; label: string; position: { x: number; y: number } | null }[];
  links: { source: string; target: string; label: string; relation: "reference" | "child" }[];
  root: string;
  focus: string;
  view: "erd" | "graph";
  filters: { hideSystem: boolean; filterMode: ErdBridgeContext["filterMode"] };
  authorMode: boolean;
}

const FILTER_MODES: ErdFilterMode[] = ["all", "standard", "custom", "manual"];

function resolveTagRef(
  registry: { id: string; name: string; color: string }[],
  ref: string,
): { id: string; name: string; color: string } {
  const q = ref.trim();
  if (!q) throw new Error("Tag reference is empty.");
  const lower = q.toLowerCase();
  const byId = registry.find((t) => t.id === q || t.id.toLowerCase() === lower);
  if (byId) return byId;
  const byName = registry.find((t) => t.name.toLowerCase() === lower);
  if (byName) return byName;
  const hits = registry.filter((t) => t.name.toLowerCase().includes(lower));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) {
    const known = registry.length > 0 ? registry.map((t) => t.name).join(", ") : "none yet - create one first";
    throw new Error(`Unknown tag "${q}". Known tags: ${known}.`);
  }
  throw new Error(`Ambiguous tag "${q}" - matches ${hits.map((t) => t.name).join(", ")}. Use the exact name.`);
}

function buildSnapshot(ctx: ErdBridgeContext): ErdSnapshot {
  const positions = ctx.nodePositions();
  const nodes = [...ctx.describes.values()].map((d) => ({
    apiName: d.name,
    label: d.label,
    position: positions[d.name] ?? null,
  }));
  const links: ErdSnapshot["links"] = [];
  for (const d of ctx.describes.values()) {
    for (const f of d.fields) {
      for (const target of f.referenceTo ?? []) {
        links.push({
          source: d.name,
          target,
          label: f.relationshipName ?? f.name,
          relation: "reference",
        });
      }
    }
    for (const rel of d.childRelationships ?? []) {
      links.push({ source: d.name, target: rel.childSObject, label: rel.relationshipName ?? rel.field, relation: "child" });
    }
  }
  return {
    nodes,
    links,
    root: ctx.rootName,
    focus: ctx.focusName,
    view: ctx.view,
    filters: { hideSystem: ctx.hideSystem, filterMode: ctx.filterMode },
    authorMode: ctx.authorMode,
  };
}

/** Build the nine tab-side handlers over a live context. */
export function buildErdBridgeHandlers(ctx: ErdBridgeContext): Record<string, BridgeHandler> {
  return {
    "bridge.ping": async () => ({ ok: true, protocol: BRIDGE_PROTOCOL_V, tab: "erd" }),

    // Arch Activity audit trail: read-only, lives in this tab's IndexedDB.
    // Lets agents review what changed on the org, summarize risk, and draft
    // JIRA stories from real actions - no org calls, no approval needed.
    "arch.activity": async (args) => {
      const rawLimit = args.limit;
      const limit =
        typeof rawLimit === "number" && Number.isFinite(rawLimit)
          ? Math.min(Math.max(1, Math.floor(rawLimit)), 200)
          : 50;
      const actor = strArg(args, "actor");
      if (actor && actor !== "architect" && actor !== "agent-bridge") {
        throw new Error(`Unknown actor "${actor}" - use "architect" or "agent-bridge".`);
      }
      const category = strArg(args, "category");
      if (category && category !== "metadata" && category !== "data") {
        throw new Error(`Unknown category "${category}" - use "metadata" or "data".`);
      }
      const all = await listArchActivity(200);
      const entries = all
        .filter((e) => (!actor || e.actor === actor) && (!category || e.category === category))
        .slice(0, limit);
      return { entries, count: entries.length };
    },

    "erd.snapshot": async () => buildSnapshot(ctx),

    "erd.objects": async (args) => {
      const q = strArg(args, "query").toLowerCase();
      const rawLimit = args.limit;
      const limit = Math.min(
        Math.max(typeof rawLimit === "number" && Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 25, 1),
        100,
      );
      const hits = (q
        ? ctx.objects.filter(
            (o) => o.name.toLowerCase().includes(q) || o.label.toLowerCase().includes(q),
          )
        : [...ctx.objects]
      )
        .slice(0, limit)
        .map((o) => ({
          apiName: o.name,
          label: o.label,
          custom: o.name.endsWith("__c"),
          onCanvas: ctx.describes.has(o.name),
        }));
      return { query: strArg(args, "query"), count: hits.length, objects: hits };
    },

    "erd.discover": async (args) => {
      const apiName = resolveObjectRef(ctx.objects, strArg(args, "apiName"));
      const direction = strArg(args, "direction") || "both";
      if (!["parents", "children", "both"].includes(direction)) {
        throw new Error(`Unknown direction "${direction}" - use parents, children or both.`);
      }
      const describe = await ctx.describeCached(apiName);
      if (!describe) throw new Error(`Could not describe ${apiName} from the org.`);
      const out: {
        object: string;
        label: string;
        onCanvas: boolean;
        parents: { apiName: string; viaField: string; label: string; onCanvas: boolean }[];
        children: { apiName: string; viaField: string; label: string; onCanvas: boolean }[];
      } = {
        object: describe.name,
        label: describe.label,
        onCanvas: ctx.describes.has(describe.name),
        parents: [],
        children: [],
      };
      if (direction !== "children") {
        const seen = new Set<string>();
        for (const f of describe.fields) {
          for (const target of f.referenceTo ?? []) {
            if (seen.has(target)) continue;
            seen.add(target);
            const label = ctx.objects.find((o) => o.name === target)?.label ?? target;
            out.parents.push({
              apiName: target,
              viaField: f.name,
              label,
              onCanvas: ctx.describes.has(target),
            });
          }
        }
      }
      if (direction !== "parents") {
        const seen = new Set<string>();
        for (const rel of describe.childRelationships ?? []) {
          if (seen.has(rel.childSObject)) continue;
          seen.add(rel.childSObject);
          const label = ctx.objects.find((o) => o.name === rel.childSObject)?.label ?? rel.childSObject;
          out.children.push({
            apiName: rel.childSObject,
            viaField: rel.field,
            label,
            onCanvas: ctx.describes.has(rel.childSObject),
          });
        }
      }
      return out;
    },

    "erd.place": async (args) => {
      const refs = strListArg(args, "apiNames");
      if (refs.length === 0) throw new Error("Provide at least one object api name to place.");
      const names = refs.map((r) => resolveObjectRef(ctx.objects, r));
      const fresh = await ctx.addNames(names);
      const placed = fresh.map((d) => d.name);
      const first = placed[0] ?? names[0];
      if (first) {
        ctx.setFocusName(first);
        ctx.focusCanvasOn(first);
      }
      return { placed, focused: first ?? null };
    },

    "erd.hide": async (args) => {
      const refs = strListArg(args, "apiNames");
      if (refs.length === 0) throw new Error("Provide at least one object api name to hide or show.");
      const names = refs.map((r) => resolveObjectRef(ctx.objects, r));
      const missing = names.filter((n) => !ctx.describes.has(n));
      if (missing.length > 0) {
        throw new Error(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not on the canvas - place first.`);
      }
      const hide = args.hide !== false;
      ctx.hideNames(names, hide);
      return hide ? { hidden: names } : { shown: names };
    },

    "erd.remove": async (args) => {
      const refs = strListArg(args, "apiNames");
      if (refs.length === 0) throw new Error("Provide at least one object api name to remove.");
      const names = refs.map((r) => resolveObjectRef(ctx.objects, r));
      const missing = names.filter((n) => !ctx.describes.has(n));
      if (missing.length > 0) {
        throw new Error(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not on the canvas - nothing removed.`);
      }
      const removable = names.filter((n) => n !== ctx.rootName);
      if (removable.length === 0) {
        throw new Error(`${ctx.rootName} is the canvas root - switch root before removing it.`);
      }
      ctx.removeNames(removable);
      if (names.includes(ctx.focusName) && ctx.rootName) {
        ctx.setFocusName(ctx.rootName);
        ctx.focusCanvasOn(ctx.rootName);
      }
      return { removed: names };
    },

    "erd.focus": async (args) => {
      const apiName = resolveObjectRef(ctx.objects, strArg(args, "apiName"));
      if (!ctx.describes.has(apiName)) {
        throw new Error(`${apiName} is not on the canvas - place it first with erd.place.`);
      }
      ctx.setFocusName(apiName);
      ctx.focusCanvasOn(apiName);
      return { focused: apiName };
    },

    "erd.mode": async (args) => {
      const mode = strArg(args, "mode");
      if (mode !== "erd" && mode !== "graph") {
        throw new Error(`Unknown mode "${mode}" - use "erd" or "graph".`);
      }
      ctx.setView(mode);
      return { view: mode };
    },

    "erd.filter": async (args) => {
      if (typeof args.hideSystem === "boolean") ctx.setHideSystem(args.hideSystem);
      const rawMode = strArg(args, "mode").toLowerCase();
      if (rawMode) {
        const match = FILTER_MODES.find((m) => m === rawMode);
        if (!match) throw new Error(`Unknown filter mode "${rawMode}" - use ${FILTER_MODES.join(", ")}.`);
        ctx.setFilterMode(match);
      }
      return { hideSystem: ctx.hideSystem, filterMode: ctx.filterMode };
    },

    "erd.tags": async (args) => {
      const action = strArg(args, "action") || "list";
      if (action === "list") {
        const assigned: Record<string, string[]> = {};
        for (const [node, ids] of Object.entries(ctx.nodeTags)) {
          if (ids.length > 0) assigned[node] = ids;
        }
        return { tags: ctx.tagRegistry, assigned };
      }
      if (action === "create") {
        const tag = createTag(strArg(args, "name"), strArg(args, "color") || ERD_TAG_COLORS[0], ctx.tagRegistry);
        if (!tag) throw new Error("Provide a tag name (up to 24 characters).");
        ctx.upsertTag(tag);
        return { created: tag };
      }
      if (action === "delete") {
        const tag = resolveTagRef(ctx.tagRegistry, strArg(args, "tag"));
        ctx.deleteTag(tag.id);
        return { deleted: tag.name };
      }
      if (action === "assign" || action === "unassign") {
        const tag = resolveTagRef(ctx.tagRegistry, strArg(args, "tag"));
        const refs = strListArg(args, "apiNames");
        if (refs.length === 0) throw new Error("Provide at least one object api name.");
        const names = refs.map((r) => resolveObjectRef(ctx.objects, r));
        const missing = names.filter((n) => !ctx.describes.has(n));
        if (missing.length > 0) {
          throw new Error(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not on the canvas - place first.`);
        }
        const on = action === "assign";
        ctx.assignTag(tag.id, names, on);
        return { tag: tag.name, [on ? "assigned" : "unassigned"]: names };
      }
      throw new Error(`Unknown action "${action}" - use list, create, assign, unassign or delete.`);
    },

    "erd.author_field": async (args) => {
      const childApi = resolveObjectRef(ctx.objects, strArg(args, "childApi"));
      const rawApi = strArg(args, "apiName");
      if (!rawApi) throw new Error("Field apiName is required (e.g. Customer_Tier__c).");
      const apiName = /__c$/i.test(rawApi) ? rawApi : `${rawApi}__c`;
      const rawType = strArg(args, "type") || "Text";
      const match = FIELD_TYPES.find((t) => t.toLowerCase() === rawType.toLowerCase());
      if (!match) throw new Error(`Unknown field type "${rawType}" - use one of: ${FIELD_TYPES.join(", ")}.`);
      if (!ctx.authorMode) {
        throw new Error("Author mode is off in the studio tab - switch it on before creating fields.");
      }
      const draft: FieldDraft = {
        ...defaultFieldDraft(),
        label: strArg(args, "label") || apiName.replace(/__c$/i, "").replace(/_/g, " "),
        apiName,
        type: match,
      };
      if (match === "Lookup" || match === "MasterDetail") {
        const target = strArg(args, "referenceTo");
        if (!target) throw new Error("Lookup/MasterDetail needs referenceTo (target object api name).");
        draft.referenceTo = resolveObjectRef(ctx.objects, target);
        draft.relationshipName = relationshipNameFromField(apiName);
        draft.relationshipLabel = draft.label;
      }
      if (match === "Picklist") {
        const values = strListArg(args, "picklistValues");
        if (values.length > 0) draft.picklistValues = values;
      }
      await ctx.submitAuthorField(draft, childApi);
      return { scheduled: true, childApi, apiName };
    },

    "erd.author_object": async (args) => {
      const rawApi = strArg(args, "apiName");
      if (!rawApi) throw new Error("Object apiName is required (e.g. Invoice__c).");
      const apiName = /__c$/i.test(rawApi) ? rawApi : `${rawApi}__c`;
      if (!ctx.authorMode) {
        throw new Error("Author mode is off in the studio tab - switch it on before creating objects.");
      }
      const label = strArg(args, "label") || apiName.replace(/__c$/i, "").replace(/_/g, " ");
      const draft: ObjectDraft = { ...defaultObjectDraft(), label, apiName };
      await ctx.submitAuthorObject(draft);
      return { scheduled: true, apiName };
    },
  };
}