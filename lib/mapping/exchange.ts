/**
 * Mapping Studio - deterministic portable project serialization,
 * import validation, preview and comparison.
 */

import { MAPPING_FORMAT, MAPPING_FORMAT_VERSION, type MappingProject, type PortableProject } from "./types";

export type ExportKind = "full" | "handoff" | "mapping-only";

export interface ImportPreview {
  name: string;
  sourceApi?: string;
  targetSystem: string;
  objects: number;
  plans: number;
  mappings: number;
  decisions: number;
  versions: number;
  snapshotDate?: string;
  fingerprint?: string;
  warnings: string[];
}

/** Deterministic export: stable key order via explicit construction. */
export function serializeProject(project: MappingProject, kind: ExportKind, exportedAt: string): string {
  const portable: PortableProject = {
    format: MAPPING_FORMAT,
    formatVersion: MAPPING_FORMAT_VERSION,
    exportedAt,
    exportKind: kind,
    project: stripForExport(project, kind),
  };
  return JSON.stringify(portable, null, 2);
}

function stripForExport(project: MappingProject, kind: ExportKind): MappingProject {
  const clone = JSON.parse(JSON.stringify(project)) as MappingProject;
  if (kind === "mapping-only") {
    // Paths + types stay; sample values go.
    if (clone.source) {
      for (const p of clone.source.paths) delete (p as { example?: unknown }).example;
      clone.source.originalText = "";
    }
  }
  if (kind === "handoff") {
    // Full review data, but the caller confirms sharing sample payloads.
  }
  return clone;
}

export interface ImportValidation {
  ok: boolean;
  project?: MappingProject;
  preview?: ImportPreview;
  errors: string[];
  warnings: string[];
}

/** Validate an imported file. Never throws; never writes to IDB. */
export function validateImport(text: string): ImportValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`], warnings: [] };
  }
  const doc = parsed as Partial<PortableProject>;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (doc.format !== MAPPING_FORMAT) {
    return { ok: false, errors: [`Not a mapping project file (expected format "${MAPPING_FORMAT}").`], warnings: [] };
  }
  if (typeof doc.formatVersion !== "number" || doc.formatVersion > MAPPING_FORMAT_VERSION) {
    return { ok: false, errors: [`Unsupported format version ${String(doc.formatVersion)} - this app reads v${MAPPING_FORMAT_VERSION}.`], warnings: [] };
  }
  if (doc.formatVersion < MAPPING_FORMAT_VERSION) {
    warnings.push(`Older format v${doc.formatVersion} - imported as-is; re-export to upgrade.`);
  }
  const p = doc.project;
  if (!p || typeof p !== "object") return { ok: false, errors: ["Missing project body."], warnings };
  if (typeof p.id !== "string" || !p.id) errors.push("Project id is missing.");
  if (typeof p.name !== "string" || !p.name) errors.push("Project name is missing.");
  if (!Array.isArray(p.mappings)) errors.push("Mappings array is missing.");
  if (!Array.isArray(p.recordPlans)) errors.push("Record plans array is missing.");
  if (!Array.isArray(p.decisions)) errors.push("Decisions array is missing.");

  if (errors.length > 0) return { ok: false, errors, warnings };

  // Referential integrity.
  const planIds = new Set(p.recordPlans.map((r) => r.id));
  const mappingIds = new Set<string>();
  for (const m of p.mappings) {
    if (mappingIds.has(m.id)) errors.push(`Duplicate mapping id ${m.id}.`);
    mappingIds.add(m.id);
    if (m.planId && !planIds.has(m.planId)) errors.push(`Mapping ${m.id} references unknown plan ${m.planId}.`);
  }
  const decisionIds = new Set<string>();
  for (const d of p.decisions ?? []) {
    if (decisionIds.has(d.id)) errors.push(`Duplicate decision id ${d.id}.`);
    decisionIds.add(d.id);
  }
  for (const ext of Object.keys(p.extensions ?? {})) {
    warnings.push(`Unsupported extension "${ext}" preserved untouched.`);
  }
  if (!p.source) warnings.push("No source template in this file - mappings reference paths you cannot browse.");
  if (!p.sfSnapshot) warnings.push("No metadata snapshot in this file - target fields cannot be inspected offline.");

  if (errors.length > 0) return { ok: false, errors, warnings };

  const project = p as MappingProject;
  return {
    ok: true,
    project,
    preview: {
      name: project.name,
      sourceApi: project.sourceApi,
      targetSystem: project.targetSystem,
      objects: project.sfSnapshot?.objects.length ?? 0,
      plans: project.recordPlans.length,
      mappings: project.mappings.length,
      decisions: project.decisions.length,
      versions: project.versions.length,
      snapshotDate: project.sfSnapshot?.capturedAt,
      fingerprint: project.sfSnapshot?.fingerprint,
      warnings,
    },
    errors: [],
    warnings,
  };
}

export interface CompareEntry {
  key: string;
  label: string;
  local: string;
  incoming: string;
  conflict: boolean;
}

/** Flat comparison of two projects sharing an id: mappings + decisions + plans. */
export function compareProjects(local: MappingProject, incoming: MappingProject): CompareEntry[] {
  const out: CompareEntry[] = [];
  const fmtMap = (m: { objectName: string; fieldName: string; kind: string; status: string }) =>
    `${m.objectName}.${m.fieldName || "(no field)"} [${m.kind}/${m.status}]`;

  const localMaps = new Map(local.mappings.map((m) => [m.id, m]));
  const incomingMaps = new Map(incoming.mappings.map((m) => [m.id, m]));
  for (const [id, im] of incomingMaps) {
    const lm = localMaps.get(id);
    if (!lm) out.push({ key: `map:${id}`, label: `Added incoming: ${im.sourcePath}`, local: "—", incoming: fmtMap(im), conflict: false });
    else if (fmtMap(lm) !== fmtMap(im) || (lm.notes ?? "") !== (im.notes ?? "") || (lm.rationale ?? "") !== (im.rationale ?? ""))
      out.push({ key: `map:${id}`, label: `Changed: ${im.sourcePath}`, local: fmtMap(lm), incoming: fmtMap(im), conflict: true });
  }
  for (const [id, lm] of localMaps) {
    if (!incomingMaps.has(id)) out.push({ key: `map:${id}`, label: `Local only: ${lm.sourcePath}`, local: fmtMap(lm), incoming: "—", conflict: false });
  }

  const localPlans = new Map(local.recordPlans.map((p) => [p.id, p]));
  for (const ip of incoming.recordPlans) {
    if (!localPlans.has(ip.id)) out.push({ key: `plan:${ip.id}`, label: `Added plan: ${ip.name}`, local: "—", incoming: `${ip.objectName} · ${ip.intent}`, conflict: false });
  }
  const localDec = new Map(local.decisions.map((d) => [d.id, d]));
  for (const ind of incoming.decisions) {
    const ld = localDec.get(ind.id);
    if (!ld) out.push({ key: `dec:${ind.id}`, label: `Added decision: ${ind.title}`, local: "—", incoming: ind.status, conflict: false });
    else if (ld.status !== ind.status || (ld.decision ?? "") !== (ind.decision ?? ""))
      out.push({ key: `dec:${ind.id}`, label: `Changed decision: ${ind.title}`, local: `${ld.status}`, incoming: `${ind.status}`, conflict: true });
  }
  return out;
}

/** Merge non-conflicting incoming changes into local. Conflicts keep local. */
export function mergeNonConflicting(local: MappingProject, incoming: MappingProject): { merged: MappingProject; applied: number; conflicts: number } {
  const cmp = compareProjects(local, incoming);
  const conflicts = cmp.filter((c) => c.conflict).length;
  const merged = JSON.parse(JSON.stringify(local)) as MappingProject;
  const localMapIds = new Set(merged.mappings.map((m) => m.id));

  for (const entry of cmp) {
    if (entry.conflict) continue;
    if (entry.key.startsWith("map:")) {
      const id = entry.key.slice(4);
      const im = incoming.mappings.find((m) => m.id === id);
      if (im && !localMapIds.has(id)) {
        merged.mappings.push(JSON.parse(JSON.stringify(im)));
      }
    } else if (entry.key.startsWith("plan:")) {
      const id = entry.key.slice(5);
      const ip = incoming.recordPlans.find((p) => p.id === id);
      if (ip && !merged.recordPlans.some((p) => p.id === id)) merged.recordPlans.push(JSON.parse(JSON.stringify(ip)));
    } else if (entry.key.startsWith("dec:")) {
      const id = entry.key.slice(4);
      const ind = incoming.decisions.find((d) => d.id === id);
      if (ind && !merged.decisions.some((d) => d.id === id)) merged.decisions.push(JSON.parse(JSON.stringify(ind)));
    }
  }
  merged.updatedAt = new Date().toISOString();
  return { merged, applied: cmp.length - conflicts, conflicts };
}
