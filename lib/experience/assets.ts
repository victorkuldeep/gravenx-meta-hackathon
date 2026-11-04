/**
 * Experience Mapping - screen image assets.
 *
 * Originals stored as Blobs in the mapping-assets IDB store, keyed by
 * storageKey. Project JSON carries metadata only - never base64 image
 * data, never blob: URLs.
 */

import { STORES, withStore } from "../db";

export const ACCEPTED_MIME = ["image/png", "image/webp"] as const;
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;
export const THUMB_MAX_EDGE = 320;

export interface AssetRecord {
  /** = ScreenAsset.storageKey. */
  id: string;
  projectId: string;
  assetId: string;
  blob: Blob;
  thumbnail?: Blob;
}

export interface FileCheck {
  ok: boolean;
  error?: string;
  mime?: "image/png" | "image/webp";
}

/** Validate type + size. Decoding happens separately with a real error. */
export function checkImageFile(file: { type: string; size: number; name: string }): FileCheck {
  const ext = file.name.toLowerCase();
  const mimeOk = (ACCEPTED_MIME as readonly string[]).includes(file.type);
  const extOk = ext.endsWith(".png") || ext.endsWith(".webp");
  if (!mimeOk || !extOk) {
    return { ok: false, error: `Only PNG and WebP screenshots are supported (got ${file.type || "unknown type"}).` };
  }
  if (file.size === 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_ASSET_BYTES) {
    return { ok: false, error: `Screenshot exceeds the ${(MAX_ASSET_BYTES / 1024 / 1024).toFixed(0)} MB limit.` };
  }
  return { ok: true, mime: file.type as "image/png" | "image/webp" };
}

/** Decode dimensions without keeping the bitmap. Throws on corrupt data. */
export async function decodeDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  if (!dims.width || !dims.height) throw new Error("Image decoded to zero dimensions.");
  return dims;
}

/** Downscale to a thumbnail Blob (same mime). Browser-only. */
export async function makeThumbnail(blob: Blob, mime: string): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D is unavailable.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumb = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.85));
    if (!thumb) throw new Error("Thumbnail encoding failed.");
    return thumb;
  } finally {
    bitmap.close();
  }
}

/** FNV-1a content hash for change detection. Browser-only (FileReader). */
export async function hashBlob(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let hash = 0x811c9dc5;
  // Sample large files: head + tail slices keep hashing fast.
  const step = buf.length > 1_000_000 ? Math.floor(buf.length / 200_000) : 1;
  for (let i = 0; i < buf.length; i += step) {
    hash ^= buf[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${buf.length}`;
}

export async function saveAssetRecord(rec: AssetRecord): Promise<void> {
  await withStore(STORES.mappingAssets, "readwrite", (s) => s.put(rec));
}

export async function getAssetRecord(storageKey: string): Promise<AssetRecord | undefined> {
  return withStore(STORES.mappingAssets, "readonly", (s) => s.get(storageKey));
}

export async function deleteAssetRecord(storageKey: string): Promise<void> {
  await withStore(STORES.mappingAssets, "readwrite", (s) => s.delete(storageKey));
}

export function assetDisplayUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

export function revokeDisplayUrl(url: string): void {
  URL.revokeObjectURL(url);
}
