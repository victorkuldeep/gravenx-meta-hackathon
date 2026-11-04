"use client";

/**
 * Workspace autosave: the live layer under manual snapshots. Per-org IndexedDB
 * records (schema canvas, builder tabs, composite bundles, last mode) written
 * on a trailing debounce + safety-net interval + pagehide flush, restored
 * as-is on the next connect to the same org - tomorrow, next week, whatever.
 *
 * No tokens here, ever. The org key is resolved from the live session after
 * login; canvas data is just metadata waiting for its org to return.
 *
 * One record per (org, slice) - no read-modify-write races between owners:
 *   id = `${orgKey}::${slice}`  (slice = schema | builder | composite | meta)
 */

import { withStore, STORES } from "@/lib/db";

export type AutosaveSlice = "schema" | "builder" | "composite" | "meta" | "notes";

export interface AutosaveRecord<T = unknown> {
  id: string;
  orgKey: string;
  slice: AutosaveSlice;
  savedAt: number;
  data: T;
}

const recordId = (orgKey: string, slice: AutosaveSlice, tabId?: string) =>
  tabId ? `${orgKey}::tab:${tabId}::${slice}` : `${orgKey}::${slice}`;

export async function loadAutosave<T>(orgKey: string, slice: AutosaveSlice, tabId?: string): Promise<{ savedAt: number; data: T } | null> {
  try {
    const rec = await withStore<AutosaveRecord<T> | undefined>(
      STORES.workspaces,
      "readonly",
      (store) => store.get(recordId(orgKey, slice, tabId))
    );
    if (!rec) return null;
    return { savedAt: rec.savedAt, data: rec.data };
  } catch {
    return null;
  }
}

async function putAutosave<T>(orgKey: string, slice: AutosaveSlice, data: T, tabId?: string): Promise<void> {
  try {
    const rec: AutosaveRecord<T> = { id: recordId(orgKey, slice, tabId), orgKey, slice, savedAt: Date.now(), data };
    await withStore(STORES.workspaces, "readwrite", (store) => store.put(rec));
  } catch {
    /* quota or unavailable - autosave is best-effort */
  }
}

/**
 * Direct write for cross-surface sync (Console pushes into schema notes
 * slices). Same record, same best-effort semantics as the debounced path.
 */
export function writeAutosave<T>(orgKey: string, slice: AutosaveSlice, data: T, tabId?: string): Promise<void> {
  if (typeof window === "undefined" || !orgKey) return Promise.resolve();
  return putAutosave(orgKey, slice, data, tabId);
}

export async function clearAutosave(orgKey: string, slice: AutosaveSlice, tabId?: string): Promise<void> {
  try {
    await withStore(STORES.workspaces, "readwrite", (store) => store.delete(recordId(orgKey, slice, tabId)));
  } catch {
    /* ignore */
  }
}

/**
 * One-time lazy migration: legacy unscoped schema/notes slices become Tab 1's
 * slices. Runs once per org when no tab list exists yet - existing canvases
 * survive the upgrade to tabbed Schema untouched.
 */
export async function migrateLegacyWorkspace(orgKey: string, tabId: string): Promise<void> {
  for (const slice of ["schema", "notes"] as AutosaveSlice[]) {
    try {
      const legacy = await loadAutosave<unknown>(orgKey, slice);
      if (!legacy) continue;
      await putAutosave(orgKey, slice, legacy.data, tabId);
      await clearAutosave(orgKey, slice);
    } catch {
      /* best-effort */
    }
  }
}

// ── Write scheduling: trailing debounce (800ms) + interval safety net (20s
// when dirty) + synchronous flush on pagehide. Owners just call queueAutosave.

const AUTOSAVE_DEBOUNCE_MS = 800;
const AUTOSAVE_INTERVAL_MS = 20_000;

const pending = new Map<string, { orgKey: string; slice: AutosaveSlice; tabId?: string; data: unknown }>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let intervalStarted = false;
let pagehideHooked = false;

function key(orgKey: string, slice: AutosaveSlice, tabId?: string) {
  return recordId(orgKey, slice, tabId);
}

function writeNow(entry: { orgKey: string; slice: AutosaveSlice; tabId?: string; data: unknown }): Promise<void> {
  return putAutosave(entry.orgKey, entry.slice, entry.data, entry.tabId);
}

export function queueAutosave(orgKey: string, slice: AutosaveSlice, data: unknown, tabId?: string): void {
  if (typeof window === "undefined" || !orgKey) return;
  const k = key(orgKey, slice, tabId);
  pending.set(k, { orgKey, slice, tabId, data });
  hookPagehide();
  startInterval();
  const existing = timers.get(k);
  if (existing) clearTimeout(existing);
  timers.set(
    k,
    setTimeout(() => {
      timers.delete(k);
      const entry = pending.get(k);
      if (!entry) return;
      pending.delete(k);
      void writeNow(entry);
    }, AUTOSAVE_DEBOUNCE_MS)
  );
}

/** Push every queued slice to IDB immediately (pagehide, disconnect). */
export function flushAutosaves(): void {
  for (const [k, t] of timers) {
    clearTimeout(t);
    timers.delete(k);
  }
  const entries = [...pending.values()];
  pending.clear();
  for (const entry of entries) void writeNow(entry);
}

function startInterval(): void {
  if (intervalStarted || typeof window === "undefined") return;
  intervalStarted = true;
  window.setInterval(() => {
    if (pending.size === 0) return;
    const entries = [...pending.values()];
    pending.clear();
    for (const entry of entries) void writeNow(entry);
  }, AUTOSAVE_INTERVAL_MS);
}

function hookPagehide(): void {
  if (pagehideHooked || typeof window === "undefined") return;
  pagehideHooked = true;
  window.addEventListener("pagehide", flushAutosaves);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAutosaves();
  });
}
