import type { Collection, CollectionItem } from "./types";
import { STORES, withStore } from "@/lib/db";

const ITEMS_STORE = STORES.items;
const COLLECTIONS_STORE = STORES.collections;

// ── Items ────────────────────────────────────────────────────────────────

export async function listCollectionItems(): Promise<CollectionItem[]> {
  const items = await withStore<CollectionItem[]>(ITEMS_STORE, "readonly", (store) =>
    store.getAll()
  );
  return (items ?? []).sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveCollectionItem(item: CollectionItem): Promise<void> {
  await withStore(ITEMS_STORE, "readwrite", (store) => store.put(item));
}

export async function deleteCollectionItem(id: string): Promise<void> {
  await withStore(ITEMS_STORE, "readwrite", (store) => store.delete(id));
}

export async function clearCollectionItems(): Promise<void> {
  await withStore(ITEMS_STORE, "readwrite", (store) => store.clear());
}

// ── Collections ──────────────────────────────────────────────────────────

export async function listCollections(): Promise<Collection[]> {
  const cols = await withStore<Collection[]>(COLLECTIONS_STORE, "readonly", (store) =>
    store.getAll()
  );
  return (cols ?? []).sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveCollection(collection: Collection): Promise<void> {
  await withStore(COLLECTIONS_STORE, "readwrite", (store) => store.put(collection));
}

export async function deleteCollection(id: string): Promise<void> {
  await withStore(COLLECTIONS_STORE, "readwrite", (store) => store.delete(id));
}
