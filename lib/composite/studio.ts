import type { SalesforceDescribeResult } from "../salesforce/types";
import { isRequiredField } from "../salesforce/metadata";

// ── Canonical Composite Studio model ────────────────────────────────────────
// One source of truth for Requests / Graph / Payload screens. Requests are
// independent by default; a ReferenceMapping is the ONLY thing that creates
// a dependency. Edges, validation and payload all derive from mappings[].

export type StudioMethod = "POST" | "PATCH" | "GET" | "DELETE";
export type FieldMode = "literal" | "reference" | "null";

export interface StudioFieldValue {
  apiName: string;
  fieldLabel: string;
  fieldType: string;
  mode: FieldMode;
  /** Literal JSON value (literal mode). */
  literal: unknown;
  /** Mapping id (reference mode). */
  mappingId: string | null;
}

export interface StudioMapping {
  id: string;
  sourceRequestId: string;
  /** Output property on the source, normally "id". */
  sourceProperty: string;
  targetRequestId: string;
  targetFieldApiName: string;
}

export interface StudioRequest {
  /** Internal stable UI identity - never the Salesforce record id. */
  id: string;
  objectApiName: string;
  objectLabel: string;
  method: StudioMethod;
  /** External Composite API identifier - unique across the batch. */
  referenceId: string;
  displayName: string;
  recordId: string;
  /** ONLY configured fields live here - no 80-checkbox lists. */
  fields: StudioFieldValue[];
  position?: { x: number; y: number };
}

export interface StudioDocument {
  name: string;
  apiVersion: string;
  allOrNone: boolean;
  requests: StudioRequest[];
  mappings: StudioMapping[];
}

export interface StudioIssue {
  level: "error" | "warning";
  scope: "doc" | "request" | "mapping" | "field";
  requestId?: string;
  mappingId?: string;
  fieldApiName?: string;
  message: string;
}

// ── referenceId generation ──────────────────────────────────────────────────
// EVERY instance gets a suffixed id (account_1, account_2…) - no bare base,
// so 2-3 Accounts can never collide. Stable after creation.

function toBase(input: string): string {
  const normalized = (input || "").replace(/[^A-Za-z0-9_]+/g, "_");
  const noSuffix = normalized.replace(/__c$/i, "");
  const words = noSuffix.replace(/__/g, "_").split("_").filter(Boolean);
  if (words.length === 0) return "request";
  return words
    .map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("");
}

export function nextReferenceId(objectLabelOrApi: string, taken: Set<string> | string[]): string {
  const used = taken instanceof Set ? taken : new Set(taken);
  const base = toBase(objectLabelOrApi);
  let n = 1;
  while (used.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

export function isValidReferenceId(id: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(id);
}

// ── mappings ────────────────────────────────────────────────────────────────

export function mappingExpression(
  mapping: StudioMapping,
  requests: StudioRequest[]
): string | null {
  const src = requests.find((r) => r.id === mapping.sourceRequestId);
  if (!src || !src.referenceId) return null;
  return `@{${src.referenceId}.${mapping.sourceProperty || "id"}}`;
}

/** Resolve every reference-mode field to its emitted value. */
export function resolveFieldValue(
  field: StudioFieldValue,
  doc: StudioDocument
): { value: unknown; mapping: StudioMapping | null } {
  if (field.mode === "null") return { value: null, mapping: null };
  if (field.mode === "reference") {
    const mapping = doc.mappings.find((m) => m.id === field.mappingId) ?? null;
    if (!mapping) return { value: undefined, mapping: null };
    const expr = mappingExpression(mapping, doc.requests);
    return { value: expr ?? undefined, mapping };
  }
  return { value: field.literal, mapping: null };
}

function coerceLiteral(fieldType: string, val: unknown): unknown {
  if (val === undefined || val === "") return undefined;
  if (fieldType === "int") {
    const num = parseInt(String(val), 10);
    return isNaN(num) ? val : num;
  }
  if (fieldType === "double" || fieldType === "currency" || fieldType === "percent") {
    const num = parseFloat(String(val));
    return isNaN(num) ? val : num;
  }
  if (fieldType === "boolean") return val === true || val === "true";
  return val;
}

// ── payload ─────────────────────────────────────────────────────────────────

export interface StudioPayloadItem {
  method: StudioMethod;
  url: string;
  referenceId: string;
  body?: Record<string, unknown>;
}

export interface StudioPayload {
  allOrNone: boolean;
  compositeRequest: StudioPayloadItem[];
}

export function buildStudioPayload(doc: StudioDocument): StudioPayload {
  const ver = doc.apiVersion.startsWith("v") ? doc.apiVersion : `v${doc.apiVersion}`;
  const items: StudioPayloadItem[] = [];
  for (const req of doc.requests) {
    if (!req.objectApiName || !req.referenceId) continue;
    let url = `/services/data/${ver}/sobjects/${req.objectApiName}`;
    if ((req.method === "PATCH" || req.method === "DELETE" || req.method === "GET") && req.recordId) {
      url += `/${req.recordId}`;
    }
    const item: StudioPayloadItem = { method: req.method, url, referenceId: req.referenceId };
    if (req.method === "POST" || req.method === "PATCH") {
      const body: Record<string, unknown> = {};
      for (const f of req.fields) {
        const { value } = resolveFieldValue(f, doc);
        if (value === undefined) continue;
        const coerced = f.mode === "literal" ? coerceLiteral(f.fieldType, value) : value;
        if (coerced === undefined) continue;
        body[f.apiName] = coerced;
      }
      item.body = body;
    }
    items.push(item);
  }
  return { allOrNone: doc.allOrNone, compositeRequest: items };
}

// ── validation ──────────────────────────────────────────────────────────────

export function validateStudio(
  doc: StudioDocument,
  describes: Map<string, SalesforceDescribeResult>
): StudioIssue[] {
  const issues: StudioIssue[] = [];
  const byId = new Map(doc.requests.map((r) => [r.id, r]));
  const indexById = new Map(doc.requests.map((r, i) => [r.id, i]));

  if (doc.requests.length === 0) {
    issues.push({ level: "warning", scope: "doc", message: "No requests yet - add your first sObject." });
    return issues;
  }
  if (doc.requests.length > 25) {
    issues.push({ level: "error", scope: "doc", message: `Too many requests (${doc.requests.length}/25).` });
  }

  // Request-level
  const seenRefs = new Map<string, string>();
  for (const req of doc.requests) {
    if (!req.objectApiName) {
      issues.push({ level: "error", scope: "request", requestId: req.id, message: "No object selected." });
      continue;
    }
    if (!req.referenceId) {
      issues.push({ level: "error", scope: "request", requestId: req.id, message: "Missing referenceId." });
    } else {
      if (!isValidReferenceId(req.referenceId)) {
        issues.push({ level: "error", scope: "request", requestId: req.id, message: `Invalid referenceId "${req.referenceId}".` });
      }
      const first = seenRefs.get(req.referenceId);
      if (first !== undefined && first !== req.id) {
        issues.push({ level: "error", scope: "request", requestId: req.id, message: `Duplicate referenceId "${req.referenceId}".` });
      } else {
        seenRefs.set(req.referenceId, req.id);
      }
    }
    if ((req.method === "PATCH" || req.method === "DELETE") && !req.recordId) {
      issues.push({ level: "error", scope: "request", requestId: req.id, message: `${req.method} needs a record ID.` });
    }
    // Required fields for POST from describe metadata
    if (req.method === "POST") {
      const desc = describes.get(req.objectApiName);
      if (desc) {
        const operation = "POST";
        for (const f of desc.fields) {
          if (!isRequiredField(f, operation)) continue;
          const configured = req.fields.find((x) => x.apiName === f.name);
          const { value } = configured
            ? resolveFieldValue(configured, doc)
            : { value: undefined };
          if (value === undefined || value === "" || value === null) {
            issues.push({
              level: "warning",
              scope: "field",
              requestId: req.id,
              fieldApiName: f.name,
              message: `Required field ${f.name} has no value.`,
            });
          }
        }
      }
    }
  }

  // Mapping-level
  const refIds = new Set(doc.requests.map((r) => r.referenceId).filter(Boolean));
  const REF_RE = /@\{([^}.]+)(?:\.[^}]*)?\}/g;
  for (const req of doc.requests) {
    for (const f of req.fields) {
      if (f.mode === "reference") {
        const m = doc.mappings.find((x) => x.id === f.mappingId);
        if (!m) {
          issues.push({
            level: "error",
            scope: "field",
            requestId: req.id,
            fieldApiName: f.apiName,
            message: `${f.apiName} links to a mapping that no longer exists - relink or switch to literal.`,
          });
        }
      } else if (f.mode === "literal" && typeof f.literal === "string") {
        // Raw @{...} expressions typed by hand still get existence-checked.
        REF_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = REF_RE.exec(f.literal)) !== null) {
          if (!refIds.has(m[1])) {
            issues.push({
              level: "warning",
              scope: "field",
              requestId: req.id,
              fieldApiName: f.apiName,
              message: `"@{${m[1]}…}" matches no request referenceId.`,
            });
            break;
          }
        }
      }
    }
  }
  for (const m of doc.mappings) {
    const src = byId.get(m.sourceRequestId);
    const dst = byId.get(m.targetRequestId);
    if (!src) {
      issues.push({ level: "error", scope: "mapping", mappingId: m.id, message: "Mapping source request is gone." });
      continue;
    }
    if (!dst) {
      issues.push({ level: "error", scope: "mapping", mappingId: m.id, message: "Mapping target request is gone." });
      continue;
    }
    if (m.sourceRequestId === m.targetRequestId) {
      issues.push({ level: "error", scope: "mapping", mappingId: m.id, requestId: dst.id, message: "A request cannot reference itself." });
    }
    if ((indexById.get(m.sourceRequestId) ?? 0) >= (indexById.get(m.targetRequestId) ?? 0)) {
      issues.push({
        level: "error",
        scope: "mapping",
        mappingId: m.id,
        requestId: dst.id,
        message: `"${src.referenceId || "source"}" must execute before "${dst.referenceId || "target"}".`,
      });
    }
    // Destination field should be a compatible reference field when known
    const desc = describes.get(dst.objectApiName);
    const dfield = desc?.fields.find((f) => f.name === m.targetFieldApiName);
    if (dfield && dfield.type !== "reference") {
      issues.push({
        level: "warning",
        scope: "mapping",
        mappingId: m.id,
        requestId: dst.id,
        message: `${m.targetFieldApiName} is not a reference field - mapping still emits the expression.`,
      });
    }
  }

  // Cycles
  if (hasCycle(doc)) {
    issues.push({ level: "error", scope: "doc", message: "Dependency cycle detected - mappings must form a DAG." });
  }
  return issues;
}

function hasCycle(doc: StudioDocument): boolean {
  const adj = new Map<string, string[]>();
  for (const r of doc.requests) adj.set(r.id, []);
  for (const m of doc.mappings) adj.get(m.sourceRequestId)?.push(m.targetRequestId);
  const color = new Map<string, number>();
  const visit = (id: string): boolean => {
    color.set(id, 1);
    for (const nxt of adj.get(id) ?? []) {
      const c = color.get(nxt) ?? 0;
      if (c === 1) return true;
      if (c === 0 && visit(nxt)) return true;
    }
    color.set(id, 2);
    return false;
  };
  return doc.requests.some((r) => (color.get(r.id) ?? 0) === 0 && visit(r.id));
}

/**
 * Stable topological fix: sources move before their dependents, everything
 * else keeps its relative order. Returns the reordered ids + whether the
 * order changed.
 */
export function fixExecutionOrder(doc: StudioDocument): { order: string[]; moved: boolean } {
  const ids = doc.requests.map((r) => r.id);
  const pos = new Map(ids.map((id, i) => [id, i]));
  const indeg = new Map(ids.map((id) => [id, 0]));
  const adj = new Map(ids.map((id) => [id, [] as string[]]));
  for (const m of doc.mappings) {
    if (!pos.has(m.sourceRequestId) || !pos.has(m.targetRequestId)) continue;
    if (m.sourceRequestId === m.targetRequestId) continue;
    adj.get(m.sourceRequestId)?.push(m.targetRequestId);
    indeg.set(m.targetRequestId, (indeg.get(m.targetRequestId) ?? 0) + 1);
  }
  const order: string[] = [];
  const ready = ids.filter((id) => (indeg.get(id) ?? 0) === 0).sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
  const queue = [...ready];
  while (queue.length > 0) {
    queue.sort((a, b) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0));
    const id = queue.shift() as string;
    order.push(id);
    for (const nxt of adj.get(id) ?? []) {
      indeg.set(nxt, (indeg.get(nxt) ?? 1) - 1);
      if (indeg.get(nxt) === 0) queue.push(nxt);
    }
  }
  if (order.length !== ids.length) return { order: ids, moved: false }; // cycle - leave alone
  return { order, moved: order.some((id, i) => ids[i] !== id) };
}

// ── helpers ─────────────────────────────────────────────────────────────────

let seq = 0;
export function newStudioId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq}`;
}

export function emptyStudioRequest(id: string): StudioRequest {
  return {
    id,
    objectApiName: "",
    objectLabel: "",
    method: "POST",
    referenceId: "",
    displayName: "",
    recordId: "",
    fields: [],
  };
}

/** Requests with no mappings touching them - the independent lane. */
export function independentIds(doc: StudioDocument): Set<string> {
  const linked = new Set<string>();
  for (const m of doc.mappings) {
    linked.add(m.sourceRequestId);
    linked.add(m.targetRequestId);
  }
  return new Set(doc.requests.filter((r) => !linked.has(r.id)).map((r) => r.id));
}

/**
 * Longest-path layer per request (sources = 0, independents = -1).
 * Drives the graph's layered layout: chains, fan-outs and diamonds all
 * resolve to stable layers; multiple mappings between one pair stay one edge.
 */
export function computeRequestLayers(doc: StudioDocument): Map<string, number> {
  const depth = new Map(doc.requests.map((r) => [r.id, -1]));
  const linked = new Set<string>();
  for (const m of doc.mappings) {
    linked.add(m.sourceRequestId);
    linked.add(m.targetRequestId);
  }
  const incoming = new Map<string, string[]>();
  for (const r of doc.requests) incoming.set(r.id, []);
  for (const m of doc.mappings) incoming.get(m.targetRequestId)?.push(m.sourceRequestId);
  const visit = (id: string, stack: Set<string>): number => {
    const known = depth.get(id) ?? -1;
    if (known >= 0) return known;
    if (stack.has(id)) return 0;
    stack.add(id);
    let d = 0;
    for (const s of incoming.get(id) ?? []) {
      if (!linked.has(s)) continue;
      d = Math.max(d, visit(s, stack) + 1);
    }
    stack.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const r of doc.requests) {
    if (linked.has(r.id)) visit(r.id, new Set());
  }
  return depth;
}
