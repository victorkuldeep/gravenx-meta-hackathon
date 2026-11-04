import type { SystemProject } from "@/lib/system-design/model";
import type { Experience } from "@/lib/wireframe/model";
import type { SequenceDocument } from "@/lib/sequence/model";
import type { Decision } from "@/lib/decisions/model";
import type { Requirement } from "@/lib/requirements/model";
import type { ConsoleTask } from "@/lib/console/model";
import type { ErdSnapshot } from "@/lib/erd/snapshotDb";
import type { MappingProject } from "@/lib/mapping/types";
import { validateTarget } from "@/lib/mapping/grid";

/**
 * Architecture graph index (Epic 2) - a derived, headless map of how
 * everything references everything else. Built on demand from the
 * feature stores and cached by the caller; never persisted, so it
 * cannot drift from the records it describes.
 *
 * Identity is id-first: a reference resolves to the record with the same
 * id ("id"). When the id is gone (import renames, deleted records) the
 * index falls back to a same-surface name match ("name") and says so.
 * Anything else is "unresolved" - listed visibly, never dropped silently.
 */

export type GraphSurface = "system" | "wireframe" | "sequence" | "draw" | "schema" | "decision" | "console" | "requirement" | "mapping" | "notes";

export type GraphNodeKind =
  | "project"
  | "system"
  | "interface"
  | "operation"
  | "mapping-project"
  | "mapping-plan"
  | "experience"
  | "screen"
  | "component"
  | "sequence"
  | "participant"
  | "decision"
  | "requirement"
  | "console-task"
  | "snapshot"
  | "schema-object"
  | "schema-field"
  | "external-system"
  | "external-issue"
  | "event"
  | "note"
  | "draw-board";

export type GraphEdgeKind =
  | "contains"
  | "connects"
  | "binds"
  | "invokes"
  | "maps-to"
  | "references"
  | "links"
  | "proposes"
  | "supersedes"
  | "message";

export type Resolution = "id" | "name" | "unresolved";

export interface GraphNode {
  key: string;
  kind: GraphNodeKind;
  surface: GraphSurface;
  /** Owning record id for real nodes; absent on stubs. */
  recordId?: string;
  name: string;
  /** True when referenced but not present in the input records. */
  stub?: boolean;
  /** Remote URL for external nodes (pushed JIRA issues / SNOW records). */
  url?: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: GraphEdgeKind;
  label?: string;
  resolution: Resolution;
}

export interface UnresolvedRef {
  from: string;
  surface: GraphSurface;
  /** The id that missed (or the name when there was no id). */
  raw: string;
  /** Human label of the reference, when one was given. */
  name?: string;
}

export interface GraphIndex {
  nodes: GraphNode[];
  edges: GraphEdge[];
  unresolved: UnresolvedRef[];
}

export interface GraphInput {
  systems?: SystemProject[];
  experiences?: Experience[];
  sequences?: SequenceDocument[];
  decisions?: Decision[];
  requirements?: Requirement[];
  tasks?: ConsoleTask[];
  snapshots?: ErdSnapshot[];
  mappings?: MappingProject[];
  /** The Draw canvas is single-slot - include it as one board node. */
  drawBoard?: boolean;
}

const key = (surface: string, id: string) => `${surface}:${id}`;
const schemaObjectKey = (object: string) => `schema:${object}`;
const schemaFieldKey = (object: string, field: string) => `schema:${object}.${field}`;

class Builder {
  nodes = new Map<string, GraphNode>();
  edges: GraphEdge[] = [];
  unresolved: UnresolvedRef[] = [];
  /** surface -> id -> key, for id-first resolution. */
  private byId = new Map<string, Map<string, string>>();
  /** surface -> lower(name) -> key, for name-fallback resolution. */
  private byName = new Map<string, Map<string, string>>();

  add(node: GraphNode): string {
    const prev = this.nodes.get(node.key);
    // A real node always wins over an earlier stub with the same key.
    if (!prev || (prev.stub && !node.stub)) {
      this.nodes.set(node.key, node);
      if (!node.stub) {
        if (node.recordId) {
          let m = this.byId.get(node.surface);
          if (!m) this.byId.set(node.surface, (m = new Map()));
          if (!m.has(node.recordId)) m.set(node.recordId, node.key);
        }
        const n = node.name.toLowerCase();
        let m = this.byName.get(node.surface);
        if (!m) this.byName.set(node.surface, (m = new Map()));
        if (n && !m.has(n)) m.set(n, node.key);
      }
    }
    return node.key;
  }

  edge(from: string, to: string, kind: GraphEdgeKind, resolution: Resolution, label?: string): void {
    this.edges.push(label === undefined ? { from, to, kind, resolution } : { from, to, kind, resolution, label });
  }

  stub(surface: GraphSurface, kind: GraphNodeKind, name: string, id?: string): string {
    const k = key(surface, id ?? `~${kind}:${name.toLowerCase()}`);
    this.add({ key: k, kind, surface, name, stub: true });
    return k;
  }

  /** Non-creating lookup: exact id first, then case-insensitive name. */
  lookup(surface: GraphSurface, ref: { id?: string; name?: string }): { to: string; resolution: Resolution } | null {
    const idHit = ref.id ? this.byId.get(surface)?.get(ref.id) : undefined;
    if (idHit) return { to: idHit, resolution: "id" };
    const nameHit = ref.name ? this.byName.get(surface)?.get(ref.name.toLowerCase()) : undefined;
    if (nameHit) return { to: nameHit, resolution: "name" };
    return null;
  }

  /**
   * Resolve a same-surface reference: exact id first, then a
   * case-insensitive name match, else a visible unresolved stub.
   */
  resolve(from: string, surface: GraphSurface, kind: GraphNodeKind, ref: { id?: string; name: string }): { to: string; resolution: Resolution } {
    const idHit = ref.id ? this.byId.get(surface)?.get(ref.id) : undefined;
    if (idHit) return { to: idHit, resolution: "id" };
    const nameHit = ref.name ? this.byName.get(surface)?.get(ref.name.toLowerCase()) : undefined;
    if (nameHit) return { to: nameHit, resolution: "name" };
    const raw = ref.id ?? ref.name;
    this.unresolved.push(ref.name && ref.name !== raw ? { from, surface, raw, name: ref.name } : { from, surface, raw });
    return { to: this.stub(surface, kind, ref.name || raw), resolution: "unresolved" };
  }
}

function indexSystem(b: Builder, p: SystemProject): void {
  const projectKey = b.add({ key: key("system", p.id), kind: "project", surface: "system", recordId: p.id, name: p.name });
  for (const s of p.systems ?? []) {
    const sk = b.add({ key: key("system", s.id), kind: "system", surface: "system", recordId: s.id, name: s.name });
    b.edge(projectKey, sk, "contains", "id");
  }
  for (const i of p.interfaces ?? []) {
    const sysHit = b.resolve(projectKey, "system", "system", { id: i.systemId, name: i.systemId });
    const ik = b.add({
      key: key("system", i.id),
      kind: "interface",
      surface: "system",
      recordId: i.id,
      name: `${i.name} (${i.protocol})`,
    });
    b.edge(sysHit.to, ik, "contains", sysHit.resolution);
  }
  for (const op of p.operations ?? []) {
    const ifHit = b.resolve(projectKey, "system", "interface", { id: op.interfaceId, name: op.interfaceId });
    const ok = b.add({
      key: key("system", op.id),
      kind: "operation",
      surface: "system",
      recordId: op.id,
      name: `${op.method} ${op.path}`.trim() || op.name,
    });
    b.edge(ifHit.to, ok, "contains", ifHit.resolution);
  }
  for (const c of p.connections ?? []) {
    const from = b.resolve(projectKey, "system", "system", { id: c.sourceId, name: c.sourceId });
    const to = b.resolve(projectKey, "system", "system", { id: c.targetId, name: c.targetId });
    b.edge(from.to, to.to, "connects", from.resolution === "id" && to.resolution === "id" ? "id" : "unresolved", c.label || undefined);
    if (c.sourceOperationId) {
      const op = b.resolve(projectKey, "system", "operation", { id: c.sourceOperationId, name: c.sourceOperationId });
      b.edge(from.to, op.to, "binds", op.resolution);
    }
    if (c.targetOperationId) {
      const op = b.resolve(projectKey, "system", "operation", { id: c.targetOperationId, name: c.targetOperationId });
      b.edge(to.to, op.to, "binds", op.resolution);
    }
  }
}

function ensureSchemaObject(b: Builder, from: string, object: string): { to: string; resolution: Resolution } {
  const hit = b.lookup("schema", { name: object });
  if (hit) return hit;
  const k = schemaObjectKey(object);
  if (!b.nodes.has(k)) b.add({ key: k, kind: "schema-object", surface: "schema", name: object, stub: true });
  b.unresolved.push({ from, surface: "schema", raw: object });
  return { to: k, resolution: "unresolved" };
}

function indexExperience(b: Builder, e: Experience): void {
  const expKey = b.add({ key: key("wireframe", e.id), kind: "experience", surface: "wireframe", recordId: e.id, name: e.name });
  for (const s of e.screens ?? []) {
    const sk = b.add({ key: key("wireframe", s.id), kind: "screen", surface: "wireframe", recordId: s.id, name: s.name });
    b.edge(expKey, sk, "contains", "id");
  }
  for (const c of e.components ?? []) {
    const ck = b.add({
      key: key("wireframe", c.id),
      kind: "component",
      surface: "wireframe",
      recordId: c.id,
      name: c.label || c.kind,
    });
    b.edge(expKey, ck, "contains", "id");
    if (c.binding?.object) {
      const obj = ensureSchemaObject(b, ck, c.binding.object);
      if (c.binding.field) {
        const fk = schemaFieldKey(c.binding.object, c.binding.field);
        if (!b.nodes.has(fk)) {
          b.add({ key: fk, kind: "schema-field", surface: "schema", name: `${c.binding.object}.${c.binding.field}`, stub: true });
        }
        b.edge(ck, fk, "binds", obj.resolution === "id" ? "id" : obj.resolution);
      } else {
        b.edge(ck, obj.to, "references", obj.resolution);
      }
    } else if (c.binding?.externalLabel) {
      const ek = b.stub("wireframe", "external-system", c.binding.externalLabel);
      b.edge(ck, ek, "references", "unresolved");
    }
    if (c.proposedField) {
      const fk = schemaFieldKey(c.proposedField.object, c.proposedField.apiName);
      if (!b.nodes.has(fk)) {
        b.add({
          key: fk,
          kind: "schema-field",
          surface: "schema",
          name: `${c.proposedField.object}.${c.proposedField.apiName}`,
          stub: true,
        });
      }
      b.edge(ck, fk, "proposes", "unresolved");
    }
  }
}

function indexSequence(b: Builder, doc: SequenceDocument): void {
  const docKey = b.add({ key: key("sequence", doc.id), kind: "sequence", surface: "sequence", recordId: doc.id, name: doc.name });
  const parts = new Map<string, string>();
  for (const p of doc.participants ?? []) {
    const pk = b.add({ key: key("sequence", p.id), kind: "participant", surface: "sequence", recordId: p.id, name: p.name });
    parts.set(p.id, pk);
    b.edge(docKey, pk, "contains", "id");
    if (p.systemRef) {
      // Match a System node by id, else by name - else a visible stub.
      const hit = b.resolve(pk, "system", "system", { id: p.systemRef, name: p.systemRef });
      b.edge(pk, hit.to, "maps-to", hit.resolution);
    }
  }
  const walk = (nodes: SequenceDocument["nodes"]) => {
    for (const n of nodes ?? []) {
      if (n.nodeType === "block") {
        walk(n.children);
        if (n.elseChildren) walk(n.elseChildren);
        continue;
      }
      if (!parts.has(n.from)) {
        b.unresolved.push({ from: docKey, surface: "sequence", raw: n.from });
      }
      if (!parts.has(n.to)) {
        b.unresolved.push({ from: docKey, surface: "sequence", raw: n.to });
      }
      const from = parts.get(n.from) ?? b.stub("sequence", "participant", n.from);
      const to = parts.get(n.to) ?? b.stub("sequence", "participant", n.to);
      const fromRes: Resolution = parts.has(n.from) ? "id" : "unresolved";
      const toRes: Resolution = parts.has(n.to) ? "id" : "unresolved";
      b.edge(from, to, "message", fromRes === "id" && toRes === "id" ? "id" : "unresolved", n.label || undefined);
      if (n.operationRef) {
        const op = b.resolve(from, "system", "operation", { id: n.operationRef, name: n.operationRef });
        b.edge(from, op.to, "invokes", op.resolution, n.label || undefined);
      }
    }
  };
  walk(doc.nodes);
}

function indexRecordLinks(
  b: Builder,
  from: string,
  links: { surface: "system" | "wireframe" | "sequence" | "draw" | "schema" | "decision" | "requirement" | "notes"; recordId: string; label: string }[],
): void {
  for (const l of links) {
    if (l.surface === "draw") {
      const dk = b.nodes.has(key("draw", "current"))
        ? key("draw", "current")
        : b.add({ key: key("draw", "current"), kind: "draw-board", surface: "draw", name: "Draw board", stub: true });
      b.edge(from, dk, "links", "name", l.label);
      continue;
    }
    if (l.surface === "schema") {
      // Schema links carry a snapshot id or an object name; resolve either.
      const hit = b.lookup("schema", { id: l.recordId, name: l.label });
      if (hit) {
        b.edge(from, hit.to, "links", hit.resolution, l.label);
      } else {
        const k = schemaObjectKey(l.label || l.recordId);
        if (!b.nodes.has(k)) b.add({ key: k, kind: "schema-object", surface: "schema", name: l.label, stub: true });
        b.unresolved.push({ from, surface: "schema", raw: l.label });
        b.edge(from, k, "links", "unresolved", l.label);
      }
      continue;
    }
    if (l.surface === "decision" || l.surface === "requirement") {
      const hit = b.resolve(from, l.surface, l.surface, { id: l.recordId, name: l.label });
      b.edge(from, hit.to, "links", hit.resolution, l.label);
      continue;
    }
    if (l.surface === "notes") {
      const hit = b.resolve(from, l.surface, "note", { id: l.recordId, name: l.label });
      b.edge(from, hit.to, "links", hit.resolution, l.label);
      continue;
    }
    const kind = l.surface === "system" ? "project" : l.surface === "wireframe" ? "experience" : "sequence";
    const hit = b.resolve(from, l.surface, kind, { id: l.recordId, name: l.label });
    b.edge(from, hit.to, "links", hit.resolution, l.label);
  }
}

function indexSnapshot(b: Builder, s: ErdSnapshot): void {
  const sk = b.add({ key: key("schema", s.id), kind: "snapshot", surface: "schema", recordId: s.id, name: s.name });
  const objects = new Set([s.root, ...(s.nodes ?? [])].filter(Boolean));
  for (const object of objects) {
    // A canvas-listed object is known, not guessed: a real node (no
    // recordId - identity is the name) that upgrades any earlier stub.
    const ok = schemaObjectKey(object);
    b.add({ key: ok, kind: "schema-object", surface: "schema", name: object });
    b.edge(sk, ok, "contains", "id");
  }
}

/**
 * Field-level mapping cover: projects and plans become nodes; every mapped
 * leaf row becomes a plan → schema-field edge labeled with its source path,
 * so "what breaks if I remove Account.X" resolves to exact rows. Untargeted
 * rows (unmapped/ignored) are skipped; mistyped targets surface unresolved.
 */
function indexMapping(b: Builder, m: MappingProject): void {
  const mk = b.add({
    key: key("mapping", m.id),
    kind: "mapping-project",
    surface: "mapping",
    recordId: m.id,
    name: m.name,
  });
  for (const plan of m.recordPlans ?? []) {
    const pk = b.add({
      key: `mapping:plan:${plan.id}`,
      kind: "mapping-plan",
      surface: "mapping",
      recordId: m.id,
      name: `${plan.name} → ${plan.objectName}`,
    });
    b.edge(mk, pk, "contains", "id", plan.objectName);
    const ohit = b.resolve(pk, "schema", "schema-object", { name: plan.objectName });
    if (ohit.resolution === "unresolved") b.unresolved.push({ from: pk, surface: "mapping", raw: plan.objectName });
    b.edge(pk, ohit.to, "maps-to", ohit.resolution === "unresolved" ? "unresolved" : "id", `${plan.intent} · ${plan.cardinality}`);
    for (const row of m.mappings ?? []) {
      if (row.planId !== plan.id || row.status === "excluded") continue;
      if (!row.objectName || !row.fieldName) continue;
      const target = `${row.objectName}.${row.fieldName}`;
      const check = validateTarget(m, target);
      const label = row.sourcePath || "(constant)";
      if (check.ok) {
        const hit = b.resolve(pk, "schema", "schema-field", { name: target });
        b.edge(pk, hit.to, "maps-to", "id", label);
      } else {
        b.unresolved.push({ from: pk, surface: "mapping", raw: target });
        const hit = b.resolve(pk, "schema", "schema-field", { name: target });
        b.edge(pk, hit.to, "maps-to", "unresolved", label);
      }
    }
  }
}

/** Build the full index. Two phases: real nodes first, then link resolution. */
export function buildIndex(input: GraphInput): GraphIndex {
  const b = new Builder();
  for (const p of input.systems ?? []) indexSystem(b, p);
  for (const m of input.mappings ?? []) indexMapping(b, m);
  // Snapshots before experiences: bindings resolve to real object nodes.
  for (const s of input.snapshots ?? []) indexSnapshot(b, s);
  for (const e of input.experiences ?? []) indexExperience(b, e);
  for (const d of input.sequences ?? []) indexSequence(b, d);
  if (input.drawBoard) {
    b.add({ key: key("draw", "current"), kind: "draw-board", surface: "draw", recordId: "current", name: "Draw board" });
  }
  for (const d of input.decisions ?? []) {
    const dk = b.add({
      key: key("decision", d.id),
      kind: "decision",
      surface: "decision",
      recordId: d.id,
      name: `${d.number} ${d.title}`,
    });
    indexRecordLinks(b, dk, d.links);
    if (d.supersededBy) {
      const hit = b.resolve(dk, "decision", "decision", { id: d.supersededBy, name: d.supersededBy });
      b.edge(dk, hit.to, "supersedes", hit.resolution);
    }
  }
  for (const r of input.requirements ?? []) {
    const rk = b.add({
      key: key("requirement", r.id),
      kind: "requirement",
      surface: "requirement",
      recordId: r.id,
      name: `${r.number} ${r.title}`,
    });
    indexRecordLinks(b, rk, r.links);
  }
  for (const t of input.tasks ?? []) {
    const tk = b.add({
      key: key("console", t.id),
      kind: "console-task",
      surface: "console",
      recordId: t.id,
      name: t.title,
    });
    indexRecordLinks(b, tk, t.links);
    // Pushed work stays visible: JIRA issues / SNOW records become
    // external nodes carrying the browse URL back out.
    if (t.pmo) {
      const ik = b.add({
        key: `pmo:${t.pmo.system}:${t.pmo.key}`,
        kind: "external-issue",
        surface: "console",
        name: `${t.pmo.key} (${t.pmo.system === "jira" ? "JIRA" : "ServiceNow"})`,
        url: t.pmo.url,
      });
      b.edge(tk, ik, "references", "id", t.pmo.key);
    }
  }
  return { nodes: [...b.nodes.values()], edges: b.edges, unresolved: b.unresolved };
}

export type WhereUsedRef =
  | { surface: GraphSurface; id: string }
  | { surface: GraphSurface; name: string }
  | { object: string; field?: string };

export interface WhereUsed {
  node: GraphNode | null;
  inbound: GraphEdge[];
  outbound: GraphEdge[];
}

/** Everything pointing at a record (inbound) plus what it points at (outbound). */
export function whereUsed(index: GraphIndex, ref: WhereUsedRef): WhereUsed {
  let target: string | null = null;
  if ("object" in ref) {
    target = ref.field ? schemaFieldKey(ref.object, ref.field) : schemaObjectKey(ref.object);
    if (!index.nodes.some((n) => n.key === target)) {
      // Fall back to a same-named real node (snapshot objects, bindings).
      const hit = index.nodes.find(
        (n) => n.surface === "schema" && n.name.toLowerCase() === (ref.field ? `${ref.object}.${ref.field}` : ref.object).toLowerCase(),
      );
      target = hit?.key ?? target;
    }
  } else if ("id" in ref) {
    // Id-only: never fall through to stubs (they carry no recordId).
    target = index.nodes.find((n) => n.surface === ref.surface && n.recordId === ref.id)?.key ?? null;
  } else {
    target = index.nodes.find((n) => n.surface === ref.surface && n.name.toLowerCase() === ref.name.toLowerCase())?.key ?? null;
  }
  if (!target || !index.nodes.some((n) => n.key === target)) return { node: null, inbound: [], outbound: [] };
  const node = index.nodes.find((n) => n.key === target)!;
  return {
    node,
    inbound: index.edges.filter((e) => e.to === target),
    outbound: index.edges.filter((e) => e.from === target),
  };
}
