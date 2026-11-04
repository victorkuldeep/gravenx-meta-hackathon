/**
 * Reload-safety for the Draw canvas: the current scene is saved locally
 * on every change and restored on load. No snapshots,
 * no UI - just no lost work.
 *
 * Backed by the shared IndexedDB (`draw-scenes` store) so image-heavy
 * boards are not subject to the ~5MB localStorage quota. The parse/slim
 * helpers are pure and unit-tested; the thin IDB wrappers follow the same
 * `withStore` pattern as the ERD snapshots.
 */
import { STORES, withStore } from "@/lib/db";

const STORE = STORES.drawScenes;
/** Single slot - the canvas holds one current drawing. */
const CURRENT_ID = "current";

export interface StoredScene {
  elements: Record<string, unknown>[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown> | null;
}

interface DrawSceneRecord {
  id: string;
  sceneJson: string;
  updatedAt: number;
}

/** Parse untrusted stored JSON - corrupt data resolves to null (blank canvas). */
export function parseStoredScene(raw: string | null | undefined): StoredScene | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const scene = parsed as Record<string, unknown>;
  if (!Array.isArray(scene.elements)) return null;
  const data: StoredScene = { elements: scene.elements as Record<string, unknown>[] };
  if (scene.appState !== undefined) {
    if (typeof scene.appState !== "object" || scene.appState === null) return null;
    data.appState = scene.appState as Record<string, unknown>;
  }
  if (scene.files !== undefined && scene.files !== null) {
    if (typeof scene.files !== "object") return null;
    data.files = scene.files as Record<string, unknown>;
  }
  return data;
}

/** Slim retry payload: drawings survive even when embedded images cannot. */
export function slimSceneJson(sceneJson: string): string {
  const parsed = JSON.parse(sceneJson) as Record<string, unknown>;
  delete parsed.files;
  return JSON.stringify(parsed);
}

export async function readStoredScene(): Promise<StoredScene | null> {
  try {
    const record =
      (await withStore<DrawSceneRecord | undefined>(STORE, "readonly", (store) =>
        store.get(CURRENT_ID),
      )) ?? undefined;
    if (!record) return null;
    return parseStoredScene(record.sceneJson);
  } catch {
    return null;
  }
}

/** Never throws: retries without embedded files, then gives up silently. */
export async function writeStoredScene(sceneJson: string): Promise<void> {
  const record = (json: string): DrawSceneRecord => ({
    id: CURRENT_ID,
    sceneJson: json,
    updatedAt: Date.now(),
  });
  try {
    await withStore(STORE, "readwrite", (store) => store.put(record(sceneJson)));
    return;
  } catch {
    /* fall through to the slim retry */
  }
  try {
    await withStore(STORE, "readwrite", (store) => store.put(record(slimSceneJson(sceneJson))));
  } catch {
    /* storage unavailable - drawing stays live for this session */
  }
}

export async function clearStoredScene(): Promise<void> {
  try {
    await withStore(STORE, "readwrite", (store) => store.delete(CURRENT_ID));
  } catch {
    /* already gone or unavailable */
  }
}
