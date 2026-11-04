import { STORES, withStore } from "../db";
import type { ContractProfile } from "./types";

/**
 * Revision log: every Save with a changed document hash appends an
 * immutable revision carrying the profile snapshot + compiled document.
 * Restore = load profile back into drafts (dirty until re-saved).
 */

export interface ContractRevision {
  id: string;
  profileId: string;
  revision: number;
  hash: string;
  summary: string;
  compiler: string;
  generatedAt: number;
  snapshotRef: string | null;
  profile: ContractProfile;
  document: Record<string, unknown>;
}

const STORE = STORES.contractRevisions;

export async function listRevisions(profileId: string): Promise<ContractRevision[]> {
  const all = await withStore<ContractRevision[]>(STORE, "readonly", (s) => s.getAll());
  return (all ?? [])
    .filter((r) => r.profileId === profileId)
    .sort((a, b) => b.revision - a.revision);
}

export async function saveRevision(rev: ContractRevision): Promise<void> {
  await withStore(STORE, "readwrite", (s) => s.put(rev));
}

export async function deleteRevisionsForProfile(profileId: string): Promise<void> {
  const revs = await listRevisions(profileId).catch(() => []);
  if (revs.length === 0) return;
  await withStore(STORE, "readwrite", (s) => {
    for (const r of revs) s.delete(r.id);
    return s.get(revs[0].id);
  }).catch(() => undefined);
}

/** Human change summary between two profile states (for revision log). */
export function summarizeProfileChange(
  prev: ContractProfile | null,
  next: ContractProfile
): string {
  if (!prev) return "Initial revision.";
  const parts: string[] = [];
  const prevOps = new Set(prev.operations.filter((o) => o.enabled).map((o) => o.operation));
  const nextOps = new Set(next.operations.filter((o) => o.enabled).map((o) => o.operation));
  for (const op of nextOps) if (!prevOps.has(op)) parts.push(`+${op}`);
  for (const op of prevOps) if (!nextOps.has(op)) parts.push(`-${op}`);
  const prevFields = new Map(prev.fields.map((f) => [f.salesforceApiName, f]));
  const nextFields = new Map(next.fields.map((f) => [f.salesforceApiName, f]));
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const [k, f] of nextFields) {
    const p = prevFields.get(k);
    if (!p) added++;
    else if (JSON.stringify(p) !== JSON.stringify(f)) changed++;
  }
  for (const k of prevFields.keys()) if (!nextFields.has(k)) removed++;
  if (added > 0) parts.push(`+${added} field${added === 1 ? "" : "s"}`);
  if (removed > 0) parts.push(`-${removed} field${removed === 1 ? "" : "s"}`);
  if (changed > 0) parts.push(`~${changed} edited`);
  if (prev.apiVersion !== next.apiVersion) parts.push(`version ${prev.apiVersion} → ${next.apiVersion}`);
  if (prev.name !== next.name) parts.push("renamed");
  return parts.length > 0 ? `${parts.join(", ")}.` : "No structural changes.";
}
