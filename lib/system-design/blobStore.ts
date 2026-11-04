"use client";

import { withStore, STORES } from "@/lib/db";
import { CANVAS_IMAGE_MAX_BYTES, CANVAS_IMAGE_MIMES, newId } from "./model";

/** One pasted canvas image. Bytes are Blob-cloneable, so IndexedDB holds
 * them directly; the project record keeps metadata + blobId only. */
export interface CanvasBlob {
  id: string;
  mime: string;
  bytes: Blob;
  width: number;
  height: number;
  createdAt: number;
}

/** Clipboard/paste gate: only supported image types under the size cap. */
export function isPastesableImage(file: { type?: string; size?: number } | null | undefined): boolean {
  if (!file || typeof file.type !== "string" || typeof file.size !== "number") return false;
  return (CANVAS_IMAGE_MIMES as readonly string[]).includes(file.type) && file.size > 0 && file.size <= CANVAS_IMAGE_MAX_BYTES;
}

/** Natural image dimensions for fit-to-canvas sizing (browser only). */
export function probeImageSize(bytes: Blob): Promise<{ width: number; height: number }> {
  return createImageBitmap(bytes).then((bmp) => {
    const out = { width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  });
}

export function newBlobId(): string {
  return newId("blob");
}

export async function putCanvasBlob(rec: CanvasBlob): Promise<void> {
  try {
    await withStore(STORES.systemBlobs, "readwrite", (store) => store.put({ ...rec }));
  } catch {
    throw new Error("Could not save pasted image (IndexedDB unavailable or quota exceeded).");
  }
}

export async function getCanvasBlob(id: string): Promise<CanvasBlob | null> {
  try {
    const rec = await withStore<CanvasBlob | undefined>(STORES.systemBlobs, "readonly", (store) => store.get(id));
    return rec ?? null;
  } catch {
    return null;
  }
}

export async function deleteCanvasBlob(id: string): Promise<void> {
  try {
    await withStore(STORES.systemBlobs, "readwrite", (store) => store.delete(id));
  } catch {
    // Blob cleanup is best-effort - the node reference is already gone.
  }
}
