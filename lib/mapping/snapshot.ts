/**
 * Mapping Studio - Salesforce metadata snapshots + fingerprinting.
 *
 * Snapshots freeze the metadata a mapping was designed against.
 * Fingerprints are deterministic change-detection aids (sorted keys,
 * relevant properties only) - not security proofs.
 */

import type { SalesforceDescribeResult, SalesforceField, SalesforceObject } from "../salesforce/types";
import type { SalesforceSnapshot, SnapshotField, SnapshotObject } from "./types";

export function toSnapshotField(f: SalesforceField): SnapshotField {
  return {
    name: f.name,
    label: f.label,
    type: f.type,
    length: f.length,
    precision: f.precision,
    scale: f.scale,
    nillable: f.nillable,
    createable: f.createable,
    updateable: f.updateable,
    calculated: f.calculated,
    defaultedOnCreate: f.defaultedOnCreate,
    unique: f.unique,
    externalId: f.externalId,
    referenceTo: [...(f.referenceTo ?? [])].sort(),
    relationshipName: f.relationshipName,
    restrictedPicklist: f.restrictedPicklist,
    defaultValue: f.defaultValue ?? null,
    picklistValues: (f.picklistValues ?? []).map((p) => ({ value: p.value, label: p.label, active: p.active })),
  };
}

export function buildSnapshot(
  id: string,
  objects: { meta: SalesforceObject; describe: SalesforceDescribeResult }[],
  orgAlias: string | undefined,
  now: string
): SalesforceSnapshot {
  const snapObjects: SnapshotObject[] = objects.map(({ meta, describe }) => ({
    name: meta.name,
    label: meta.label,
    custom: meta.custom,
    fields: [...(describe.fields ?? [])].sort((a, b) => a.name.localeCompare(b.name)).map(toSnapshotField),
  }));
  snapObjects.sort((a, b) => a.name.localeCompare(b.name));
  const snapshot: SalesforceSnapshot = { id, capturedAt: now, orgAlias, fingerprint: "", objects: snapObjects };
  snapshot.fingerprint = fingerprintSnapshot(snapshot);
  return snapshot;
}

/** Deterministic fingerprint over identity + constraint-relevant props. */
export function fingerprintSnapshot(snapshot: SalesforceSnapshot): string {
  const parts: string[] = [];
  for (const o of snapshot.objects) {
    parts.push(`obj:${o.name}|${o.label}|${o.custom ? "c" : "s"}`);
    for (const f of o.fields) {
      const picks = f.picklistValues.map((p) => `${p.value}:${p.active ? 1 : 0}`).sort().join(",");
      parts.push(
        `fld:${o.name}.${f.name}|${f.type}|len${f.length}|p${f.precision}s${f.scale}|n${f.nillable ? 1 : 0}|c${f.createable ? 1 : 0}|u${f.updateable ? 1 : 0}|d${f.defaultedOnCreate ? 1 : 0}|ref[${f.referenceTo.join(",")}]|rel[${f.relationshipName ?? ""}]|rp${f.restrictedPicklist ? 1 : 0}|pv[${picks}]`
      );
    }
  }
  // FNV-1a 32-bit over the canonical string - deterministic, dependency-free.
  let hash = 0x811c9dc5;
  const text = parts.join("\n");
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export interface DriftFinding {
  kind:
    | "field-removed"
    | "field-added"
    | "type-changed"
    | "length-changed"
    | "precision-changed"
    | "capability-changed"
    | "picklist-changed"
    | "relationship-changed"
    | "object-removed"
    | "object-added";
  objectName: string;
  fieldName?: string;
  before?: string;
  after?: string;
  message: string;
}

/** Compare an old snapshot against fresh metadata. Pure + deterministic. */
export function diffSnapshots(oldSnap: SalesforceSnapshot, fresh: SalesforceSnapshot): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const freshObjs = new Map(fresh.objects.map((o) => [o.name, o]));
  const oldObjs = new Map(oldSnap.objects.map((o) => [o.name, o]));

  for (const [name, o] of oldObjs) {
    const n = freshObjs.get(name);
    if (!n) {
      findings.push({ kind: "object-removed", objectName: name, message: `Object ${name} no longer exists in refreshed metadata.` });
      continue;
    }
    const nFields = new Map(n.fields.map((f) => [f.name, f]));
    const oFields = new Map(o.fields.map((f) => [f.name, f]));
    for (const [fname, f] of oFields) {
      const nf = nFields.get(fname);
      if (!nf) {
        findings.push({ kind: "field-removed", objectName: name, fieldName: fname, message: `${name}.${fname} was removed.` });
        continue;
      }
      if (nf.type !== f.type)
        findings.push({ kind: "type-changed", objectName: name, fieldName: fname, before: f.type, after: nf.type, message: `${name}.${fname} type changed ${f.type} → ${nf.type}.` });
      if (nf.length !== f.length)
        findings.push({ kind: "length-changed", objectName: name, fieldName: fname, before: String(f.length), after: String(nf.length), message: `${name}.${fname} length changed ${f.length} → ${nf.length}.` });
      if (nf.precision !== f.precision || nf.scale !== f.scale)
        findings.push({ kind: "precision-changed", objectName: name, fieldName: fname, before: `${f.precision},${f.scale}`, after: `${nf.precision},${nf.scale}`, message: `${name}.${fname} precision/scale changed.` });
      if (nf.createable !== f.createable || nf.updateable !== f.updateable || nf.nillable !== f.nillable || nf.defaultedOnCreate !== f.defaultedOnCreate)
        findings.push({ kind: "capability-changed", objectName: name, fieldName: fname, message: `${name}.${fname} capability changed (createable/updateable/nillable/defaulted).` });
      const pv = (list: SnapshotField["picklistValues"]) => list.map((p) => `${p.value}:${p.active ? 1 : 0}`).sort().join("|");
      if (pv(nf.picklistValues) !== pv(f.picklistValues))
        findings.push({ kind: "picklist-changed", objectName: name, fieldName: fname, message: `${name}.${fname} picklist values or active flags changed.` });
      if (nf.referenceTo.join(",") !== f.referenceTo.join(",") || (nf.relationshipName ?? "") !== (f.relationshipName ?? ""))
        findings.push({ kind: "relationship-changed", objectName: name, fieldName: fname, message: `${name}.${fname} relationship changed.` });
    }
    for (const [fname] of nFields) {
      if (!oFields.has(fname))
        findings.push({ kind: "field-added", objectName: name, fieldName: fname, message: `${name}.${fname} is newly available.` });
    }
  }
  for (const [name] of freshObjs) {
    if (!oldObjs.has(name))
      findings.push({ kind: "object-added", objectName: name, message: `Object ${name} is newly available.` });
  }
  return findings;
}
