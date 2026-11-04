"use client";

import { withStore, STORES } from "@/lib/db";

/** One executed hop inside an edge run (Phase 4 traces). */
export interface SystemRunStep {
  label: string;
  status: number;
  statusText: string;
  durationMs: number;
  endpoint: string;
  /** Scrubbed slices for chain evidence (absent on vintage records). */
  requestBodyPreview?: string;
  responseBodyPreview?: string;
}

/** Deterministic verdict of a scenario-linked run against its expectation.
 * Computed at save and pinned with the evidence; override-pass is a signed
 * human judgment recorded on the run row, never silent. */
export type RunVerdict = "pass" | "fail" | "override-pass";

/** Persisted test-run evidence. Bodies are truncated previews; request
 * headers are stored redacted; query strings are stripped from endpoints.
 * Full bodies live in memory only, for the session response view. */
export interface SystemRunRecord {
  id: string;
  createdAt: number;
  /** Owning project and launching scenario (validation epic). Absent on
   * vintage records - those stay unattributed, never guessed. */
  projectId?: string;
  scenarioId?: string;
  verdict?: RunVerdict;
  verdictNote?: string;
  operationName: string;
  systemName: string;
  environmentName: string;
  method: string;
  endpoint: string;
  status: number;
  statusText: string;
  durationMs: number;
  truncated: boolean;
  requestHeaders: Record<string, string>;
  requestBodyPreview: string;
  responseHeaders: Record<string, string>;
  responseBodyPreview: string;
  /** Edge runs: "single" for TestRunner sends, "edge"/"chain" with per-hop evidence. */
  kind?: "single" | "edge" | "chain";
  steps?: SystemRunStep[];
}

const MAX_RUNS = 100;

export async function saveSystemRun(run: SystemRunRecord): Promise<void> {
  try {
    await withStore(STORES.systemRuns, "readwrite", (store) => store.put({ ...run }));
    const all = await withStore<SystemRunRecord[]>(STORES.systemRuns, "readonly", (store) => store.getAll());
    const extra = (all ?? []).sort((a, b) => b.createdAt - a.createdAt).slice(MAX_RUNS);
    if (extra.length > 0) {
      await withStore(STORES.systemRuns, "readwrite", (store) => {
        for (const r of extra) store.delete(r.id);
        return store.get(run.id);
      });
    }
  } catch {
    throw new Error("Could not save run (IndexedDB unavailable or quota exceeded).");
  }
}

export async function listSystemRuns(limit = 20): Promise<SystemRunRecord[]> {
  try {
    const all = await withStore<SystemRunRecord[]>(STORES.systemRuns, "readonly", (store) => store.getAll());
    return (all ?? []).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  } catch {
    return [];
  }
}

export async function deleteSystemRun(id: string): Promise<void> {
  try {
    await withStore(STORES.systemRuns, "readwrite", (store) => store.delete(id));
  } catch {
    throw new Error("Could not delete run (IndexedDB unavailable).");
  }
}
