export interface RestHistoryEntry {
  id: string;
  name: string;
  method: string;
  scope: "org" | "custom";
  url: string;
  status: number | null;
  timeMs: number | null;
  createdAt: number;
  /** Full request snapshot for one-click recall. */
  snapshot: {
    method: string;
    path: string;
    customUrl: string;
    authType: string;
    headers: { key: string; value: string }[];
    body: string;
  };
}

import { STORES, withStore } from "@/lib/db";

const STORE = STORES.restHistory;
const MAX_ENTRIES = 50;

export async function listRestHistory(): Promise<RestHistoryEntry[]> {
  const all = await withStore<RestHistoryEntry[]>(STORE, "readonly", (store) => store.getAll());
  return (all ?? []).sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveRestHistory(entry: RestHistoryEntry): Promise<void> {
  await withStore(STORE, "readwrite", (store) => store.put(entry));
  const all = await listRestHistory();
  const extra = all.slice(MAX_ENTRIES);
  if (extra.length > 0) {
    await withStore(STORE, "readwrite", (store) => {
      for (const x of extra) store.delete(x.id);
      return store.get(entry.id);
    });
  }
}

export async function deleteRestHistory(id: string): Promise<void> {
  await withStore(STORE, "readwrite", (store) => store.delete(id));
}

export async function clearRestHistory(): Promise<void> {
  await withStore(STORE, "readwrite", (store) => store.clear());
}
