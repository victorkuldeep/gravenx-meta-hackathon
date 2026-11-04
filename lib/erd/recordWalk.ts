"use client";

/**
 * Record Walk engine (pure): on-demand live record traversal for the ERD.
 * Root loads automatically from a Record Id; every other node resolves
 * reachability against already-loaded records and pulls with ONE deliberate
 * query per click - no BFS storms, no governor risk by construction.
 *
 * Session-only by design: loaded records live in component memory and are
 * never persisted, exported, or shared.
 */

export const RECORD_ROW_LIMIT = 11; // 10 shown + 1 overflow probe ("+N more")

export interface WalkField {
  name: string;
  type: string;
  referenceTo: string[];
  nameField?: boolean;
}

export interface WalkDescribe {
  fields: WalkField[];
  childRelationships: { childSObject: string; relationshipName: string | null }[];
}

/** One fetched record: display fields + every lookup value (for traversal). */
export interface LoadedSingle {
  id: string;
  fields: Record<string, unknown>;
}

export interface ChildRows {
  childApi: string;
  lookupField: string;
  parentApi: string;
  parentId: string;
  rows: Record<string, unknown>[];
  offset: number;
  exhausted: boolean;
}

export interface LoadedState {
  /** apiName -> record id -> record (insertion-ordered). */
  singles: Map<string, Map<string, LoadedSingle>>;
  /** `${childApi}::${lookupField}::${parentId}` -> page. */
  children: Map<string, ChildRows>;
}

export const emptyLoadedState = (): LoadedState => ({ singles: new Map(), children: new Map() });

export const childPageKey = (childApi: string, lookupField: string, parentId: string) =>
  `${childApi}::${lookupField}::${parentId}`;

/** 15- or 18-char Salesforce Id (prefix validated against the record itself). */
export function isValidRecordId(id: string): boolean {
  return /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(id.trim());
}

export function escapeSoqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Id + name field + every lookup (traversal needs all of them). */
export function displayFieldNames(fields: WalkField[]): { select: string[]; nameField: string | null } {  const has = (n: string) => fields.some((f) => f.name === n);
  const nameField = fields.find((f) => f.nameField)?.name ?? (has("Name") ? "Name" : null);
  const lookups = fields.filter((f) => f.type === "reference" && (f.referenceTo ?? []).length > 0).map((f) => f.name);
  const select = ["Id", ...(nameField && nameField !== "Id" ? [nameField] : []), ...lookups.filter((l) => l !== "Id" && l !== nameField)];
  return { select: [...new Set(select)], nameField };
}

/**
 * Key-field cascade for lookup display labels: the describe nameField
 * (covers Name, OrderNumber, CaseNumber…), then well-known key fields,
 * else null (caller renders the raw Id). Resolves against the TARGET's
 * describe so e.g. Order.OwnerId shows the User's Name.
 *
 * Special case: User and Group (queues) have no nameField flag in some
 * describes - cascade covers them (User.Name, Group Name/Type fallback).
 */
const KEY_FIELD_FALLBACKS = ["Name", "Subject", "OrderNumber", "CaseNumber", "ContractNumber", "Title", "DeveloperName", "Label", "Email", "Username", "Type"];

export function keyFieldFor(fields: WalkField[]): string | null {
  const named = fields.find((f) => f.nameField)?.name;
  if (named) return named;
  for (const cand of KEY_FIELD_FALLBACKS) {
    if (fields.some((f) => f.name === cand)) return cand;
  }
  return null;
}

/**
 * Salesforce Id prefixes for polymorphic owner-style lookups (no describe
 * needed): 005 = User, 00G = Group (queue). Used to pick the right target
 * object when the field declares both (OwnerId, CreatedById…).
 */
export function targetApiForId(declared: string[], targetId: string): string | null {
  const prefix = targetId.slice(0, 3);
  if (prefix === "005" && declared.includes("User")) return "User";
  if (prefix === "00G" && declared.includes("Group")) return "Group";
  return null;
}

/** Human kind for a target id: "User", "Queue" (Group), or null. */
export function kindForId(targetApi: string): string | null {
  if (targetApi === "User") return "User";
  if (targetApi === "Group") return "Queue";
  return null;
}

/** Queue display: Group rows carry Name + Type - "Ops Queue", never an Id. */
export function queueLabelFromRow(row: Record<string, unknown> | undefined): string | null {
  if (!row) return null;
  const name = row.Name;
  if (typeof name !== "string" || !name) return null;
  const type = row.Type;
  const suffix = typeof type === "string" && type.toLowerCase() === "queue" ? " (queue)" : "";
  return `${name}${suffix}`;
}

/** Pull the single human label for one record id (one deliberate query).
 * Returns null when the target has no text key field or the row is hidden -
 * the caller then shows the raw Id. FLS failures return null (never throw). */
export function buildLabelQuery(apiName: string, keyField: string, id: string): string {
  return `SELECT Id, ${keyField} FROM ${apiName} WHERE Id = '${escapeSoqlString(id.trim())}' LIMIT 1`;
}

/**
 * Lookup picker search: up to 20 candidates with a human name. Empty text
 * browses (LIKE '%%'). Group (queues) always pulls Type alongside Name so
 * the picker can tell queues apart. displayField null = Id-only object:
 * LIKE is illegal on Id fields, so empty text browses without a WHERE and
 * typed text matches by exact Id.
 */
export function buildLookupSearchQuery(apiName: string, displayField: string | null, query: string, limit = 20): string {
  const q = `%${escapeSoqlString(query.trim())}%`;
  if (apiName === "Group") {
    return `SELECT Id, Name, Type FROM Group WHERE Name LIKE '${q}' LIMIT ${limit}`;
  }
  if (!displayField || displayField === "Id") {
    const id = escapeSoqlString(query.trim());
    return id === ""
      ? `SELECT Id FROM ${apiName} LIMIT ${limit}`
      : `SELECT Id FROM ${apiName} WHERE Id = '${id}' LIMIT ${limit}`;
  }
  return `SELECT Id, ${displayField} FROM ${apiName} WHERE ${displayField} LIKE '${q}' LIMIT ${limit}`;
}

/** Read the label back out of a label-query row (type-checked, null-safe). */
export function labelFromRow(row: Record<string, unknown> | undefined, keyField: string): string | null {
  if (!row) return null;
  const v = row[keyField];
  return typeof v === "string" && v ? v : null;
}

export function buildRootQuery(apiName: string, select: string[], id: string): string {
  return `SELECT ${select.join(", ")} FROM ${apiName} WHERE Id = '${escapeSoqlString(id.trim())}' LIMIT 1`;
}

/** Compound/blob types SOQL cannot select directly - excluded from full-row pulls. */
const UNQUERYABLE_TYPES = new Set(["address", "location", "base64"]);

/** Every directly-selectable field, Id first (full-row pulls for single views). */
export function queryableFieldNames(fields: WalkField[]): string[] {
  const names = fields
    .filter((f) => !UNQUERYABLE_TYPES.has(f.type))
    .map((f) => f.name);
  const rest = names.filter((n) => n !== "Id");
  return ["Id", ...rest];
}

/** Split a select list into chunks that stay under maxChars joined - one
 * SOQL call per chunk, merged afterward. Keeps huge objects under the
 * query-length cap without dropping fields. */
export function chunkSelect(names: string[], maxChars = 15000): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const n of names) {
    const add = cur.length === 0 ? n.length : 2 + n.length;
    if (cur.length > 0 && len + add > maxChars) {
      chunks.push(cur);
      cur = [];
      len = 0;
    }
    len += cur.length === 0 ? n.length : 2 + n.length;
    cur.push(n);
  }
  if (cur.length > 0) chunks.push(cur);
  return chunks.length > 0 ? chunks : [[]];
}

export function buildChildrenQuery(
  childApi: string,
  lookupField: string,
  parentId: string,
  select: string[],
  offset: number
): string {
  return `SELECT ${select.join(", ")} FROM ${childApi} WHERE ${lookupField} = '${escapeSoqlString(parentId)}' ORDER BY Id LIMIT ${RECORD_ROW_LIMIT} OFFSET ${Math.max(0, offset)}`;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const NUMBER_FIELD_TYPES = new Set(["int", "double", "currency", "percent", "long", "number"]);

/**
 * Serialize one edited draft value for the PATCH body: type-aware, skips
 * empties (never sends "" into number/date fields - the server would reject).
 */
export function serializeDraftValue(
  fieldType: string | undefined,
  value: string | boolean
): unknown {
  if (typeof value === "boolean") return value;
  const v = value.trim();
  if (v === "") return undefined;
  if (fieldType && NUMBER_FIELD_TYPES.has(fieldType)) {
    const n = Number(v);
    return Number.isNaN(n) ? v : n;
  }
  if (fieldType === "datetime" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) {
    return `${v}:00.000+0000`;
  }
  return v;
}

/** Every aboard row for an object: singles first, then child rows, deduped by Id. */
export function rowsForApi(state: LoadedState, apiName: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const s of state.singles.get(apiName)?.values() ?? []) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ Id: s.id, ...s.fields });
  }
  for (const page of state.children.values()) {
    if (page.childApi !== apiName) continue;
    for (const row of page.rows) {
      const id = str(row.Id);
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push(row);
    }
  }
  return out;
}

/** Every known record id for an object: singles first, then child-row ids. */
export function knownIdsFor(state: LoadedState, apiName: string): string[] {
  const out: string[] = [];
  const singles = state.singles.get(apiName);
  if (singles) for (const id of singles.keys()) out.push(id);
  for (const page of state.children.values()) {
    if (page.childApi !== apiName) continue;
    for (const row of page.rows) {
      const id = str(row.Id);
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

export type TargetPlan =
  | { kind: "single"; apiName: string; id: string }
  | ({ kind: "children" } & ChildPlan)
  | { kind: "blocked"; missingApi: string; missingLabel: string };

/** One pullable children page: lookup field + the loaded parent id behind it. */
export interface ChildPlan {
  childApi: string;
  lookupField: string;
  parentApi: string;
  parentId: string;
}

export interface ResolveContext {
  rootApi: string | null;
  rootId: string | null;
  /** Canvas objects in a stable order (root first when present). */
  canvasApis: string[];
  getDescribe: (apiName: string) => WalkDescribe | undefined;
  labelOf: (apiName: string) => string;
}

/**
 * Every pullable children page for a node: one plan per (lookup field,
 * loaded parent id) pair, root-first. Multi-parent children (Task WhatId +
 * WhoId, junctions with a lookup and a master-detail) resolve one plan per
 * parent so the pull fans out instead of stopping at the first parent.
 * Deduplicated - the same parent id reached twice yields one plan.
 */
/** Reference fields on a node that can point at a loaded parent. */
function targetLookups(targetApi: string, ctx: ResolveContext) {
  const describe = ctx.getDescribe(targetApi);
  return (describe?.fields ?? []).filter(
    (f) => f.type === "reference" && (f.referenceTo ?? []).length > 0
  );
}

export function resolveChildPlans(
  targetApi: string,
  state: LoadedState,
  ctx: ResolveContext
): ChildPlan[] {
  const lookups = targetLookups(targetApi, ctx);
  if (lookups.length === 0) return [];
  const parentCandidates: { api: string; id: string }[] = [];
  if (ctx.rootApi && ctx.rootId) parentCandidates.push({ api: ctx.rootApi, id: ctx.rootId });
  for (const [api, recs] of state.singles) {
    if (api === ctx.rootApi) continue;
    for (const id of recs.keys()) parentCandidates.push({ api, id });
  }
  for (const page of state.children.values()) {
    for (const row of page.rows) {
      const id = str(row.Id);
      if (id) parentCandidates.push({ api: page.childApi, id });
    }
  }
  const plans: ChildPlan[] = [];
  const seen = new Set<string>();
  for (const parent of parentCandidates) {
    const via = lookups.find((f) => (f.referenceTo ?? []).includes(parent.api));
    if (!via) continue;
    const key = `${via.name}::${parent.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    plans.push({ childApi: targetApi, lookupField: via.name, parentApi: parent.api, parentId: parent.id });
  }
  return plans;
}

/**
 * How to pull one node's data from the current loaded set:
 * - a known id (root or a lookup value seen on a loaded record) -> single GET
 * - a loaded parent id + this node's lookup to it -> children query
 * - otherwise blocked, naming the canvas parent to load first.
 */
export function resolveTarget(targetApi: string, state: LoadedState, ctx: ResolveContext): TargetPlan {
  // Already aboard: show the first known record (insertion order).
  const known = knownIdsFor(state, targetApi);
  if (known.length > 0) return { kind: "single", apiName: targetApi, id: known[0] };
  // A loaded record pointing AT the target via one of its lookups?
  const orderedApis = [...state.singles.keys()].sort((a, b) => {
    if (a === ctx.rootApi) return -1;
    if (b === ctx.rootApi) return 1;
    return 0;
  });
  for (const holderApi of orderedApis) {
    const holderDesc = ctx.getDescribe(holderApi);
    if (!holderDesc) continue;
    for (const f of holderDesc.fields) {
      if (f.type !== "reference" || !(f.referenceTo ?? []).includes(targetApi)) continue;
      for (const rec of state.singles.get(holderApi)?.values() ?? []) {
        const v = str(rec.fields[f.name]);
        if (v) return { kind: "single", apiName: targetApi, id: v };
      }
    }
  }
  // A loaded parent this node looks up to? Every plan, not just the first -
  // multi-parent children pull one page per (lookup, parent id) pair.
  const plans = resolveChildPlans(targetApi, state, ctx);
  if (plans.length > 0) {
    return { kind: "children", ...plans[0] };
  }
  // Blocked: suggest the first on-canvas parent (describe order), else any lookup target.
  const lookups = targetLookups(targetApi, ctx);
  const onCanvas = lookups.find((f) => (f.referenceTo ?? []).some((t) => ctx.canvasApis.includes(t)));
  const hint = onCanvas ?? lookups[0];
  const missingApi = hint ? (hint.referenceTo ?? []).find((t) => ctx.canvasApis.includes(t)) ?? (hint.referenceTo ?? [])[0] : null;
  return {
    kind: "blocked",
    missingApi: missingApi ?? targetApi,
    missingLabel: missingApi ? ctx.labelOf(missingApi) : ctx.labelOf(targetApi),
  };
}

/** Node eye state from the loaded set: live, one-click reachable, or locked. */
export function nodeRecordState(  apiName: string,
  state: LoadedState,
  ctx: ResolveContext
): { state: "live" | "reachable" | "locked"; hint: string | null } {
  if (knownIdsFor(state, apiName).length > 0) return { state: "live", hint: null };
  const plan = resolveTarget(apiName, state, ctx);
  if (plan.kind === "blocked") {
    return {
      state: "locked",
      hint: plan.missingApi === apiName ? "No lookup path from a loaded record" : `Load ${plan.missingLabel} first`,
    };
  }
  if (plan.kind === "single") return { state: "reachable", hint: "Click to pull this record" };
  const planCount = resolveChildPlans(apiName, state, ctx).length;
  return {
    state: "reachable",
    hint: planCount > 1
      ? `Click to pull via ${planCount} parents`
      : `Click to pull via ${ctx.labelOf(plan.parentApi)}`,
  };
}

/**
 * Which record a node visualizes: the explicit pick wins, otherwise the
 * first child-row id across pages (fresh on-demand rows beat cached
 * singles), otherwise the first cached single. Null = nothing aboard.
 */
export function selectedRecordId(
  apiName: string,
  state: LoadedState,
  explicit?: string | null
): string | null {
  if (explicit && knownIdsFor(state, apiName).includes(explicit)) return explicit;
  for (const page of state.children.values()) {
    if (page.childApi !== apiName) continue;
    const id = str(page.rows[0]?.Id);
    if (id) return id;
  }
  const singles = state.singles.get(apiName);
  if (singles) {
    for (const id of singles.keys()) return id;
  }
  return null;
}

/** Display a loaded field value in peeks and pickers: objects stringify,
 * nullish renders as an em dash, long text truncates at 120 chars. */
export function formatWalkValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 120 ? `${s.slice(0, 119)}…` : s;
}
