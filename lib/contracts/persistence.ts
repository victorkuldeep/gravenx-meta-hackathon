import type { SalesforceDescribeResult } from "../salesforce/types";
import { STORES, withStore } from "../db";
import { validateProfileConfig } from "./profile-schema";
import { seedLeadAcquisition, seedLeadEnrichment } from "./seeds";
import type { ContractProfile } from "./types";

/**
 * Contract persistence: profiles + embedded metadata snapshots in the
 * central IndexedDB (v6 store). Snapshots travel with the profile so a
 * saved contract stays viewable offline; staleness is computed, not stored.
 */

export interface SnapshotData {
  capturedAt: number;
  describe: SalesforceDescribeResult;
}

export interface StoredContractProfile {
  id: string;
  profile: ContractProfile;
  snapshot: SnapshotData | null;
}

const STORE = STORES.contractProfiles;

export async function listStoredProfiles(): Promise<StoredContractProfile[]> {
  const all = await withStore<StoredContractProfile[]>(STORE, "readonly", (s) => s.getAll());
  return (all ?? []).sort((a, b) => a.profile.updatedAt - b.profile.updatedAt);
}

export async function saveStoredProfile(stored: StoredContractProfile): Promise<void> {
  await withStore(STORE, "readwrite", (s) => s.put(stored));
}

export async function deleteStoredProfile(id: string): Promise<void> {
  await withStore(STORE, "readwrite", (s) => s.delete(id));
}

export function seedStoredProfiles(now = Date.now()): StoredContractProfile[] {
  return [seedLeadAcquisition(), seedLeadEnrichment()].map((profile) => ({
    id: profile.id,
    profile: { ...profile, createdAt: now, updatedAt: now },
    snapshot: null,
  }));
}

export function serializeStoredProfile(stored: StoredContractProfile): string {
  return JSON.stringify({ kind: "sf-contract-profile", version: 1, ...stored }, null, 2);
}

export function parseStoredProfileImport(text: string): StoredContractProfile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("Import is not valid JSON.");
  }
  const rec = raw as { profile?: unknown; snapshot?: unknown; id?: unknown };
  if (!rec || typeof rec !== "object" || !rec.profile) {
    throw new Error("Import is not a contract profile (missing profile).");
  }
  const check = validateProfileConfig(rec.profile);
  if (!check.ok) throw new Error(`Invalid profile: ${check.errors[0]}`);
  const profile = rec.profile as ContractProfile;
  const snapshot =
    rec.snapshot && typeof rec.snapshot === "object"
      ? (rec.snapshot as SnapshotData)
      : null;
  return { id: profile.id, profile, snapshot };
}
