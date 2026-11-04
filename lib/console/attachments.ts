import { z } from "zod";
import { STORES, withStore } from "@/lib/db";
import {
  CONSOLE_ATTACHMENT_MAX_BYTES,
  CONSOLE_ATTACHMENT_MIMES,
  type ConsoleAttachment,
} from "./model";

/**
 * Console attachments: screenshots pinned to a task. Bytes live in their own
 * `console-attachments` store (DB v22) keyed by id - the task record only
 * carries counts, so the queue stays light and export stays portable.
 */

export const consoleAttachmentSchema: z.ZodType<ConsoleAttachment> = z.object({
  id: z.string().min(1).max(160),
  taskId: z.string().min(1).max(160),
  name: z.string().min(1).max(200),
  mime: z.string().min(1).max(100),
  size: z.number().int().nonnegative(),
  dataUrl: z.string().min(1).max(8 * 1024 * 1024),
  at: z.number(),
});

export interface PickedFile {
  name: string;
  type: string;
  size: number;
}

/** Pure gate for the file picker - images only, 3 MB cap. No DOM needed. */
export function checkAttachmentFile(file: PickedFile): { ok: true } | { ok: false; error: string } {
  if (!(CONSOLE_ATTACHMENT_MIMES as readonly string[]).includes(file.type)) {
    return { ok: false, error: `${file.name || "File"} is not a screenshot (PNG, JPEG, WebP or GIF).` };
  }
  if (file.size > CONSOLE_ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: `${file.name || "File"} is ${(file.size / 1048576).toFixed(1)} MB - keep screenshots under 3 MB.` };
  }
  if (file.size <= 0) return { ok: false, error: `${file.name || "File"} is empty.` };
  return { ok: true };
}

/** Longest side after a downscale pass - keeps screenshot text readable. */
export const CONSOLE_ATTACHMENT_MAX_DIM = 1920;

/** Pure: does this file need a downscale pass before the size gate? */
export function needsDownscale(file: PickedFile): boolean {
  return file.size > CONSOLE_ATTACHMENT_MAX_BYTES;
}

/**
 * Browser-only: shrink oversized screenshots until they fit the size gate.
 * JPEG stays JPEG, everything else becomes WebP (crisp text, small bytes).
 * Passes walk dimensions then quality down, and return the smallest output -
 * even pathologically noisy captures land under the cap instead of bouncing.
 * GIFs pass through untouched - downscaling would kill animation.
 */
export async function downscaleImageFile(file: File): Promise<File> {
  if (file.type === "image/gif") return file;
  const bitmap = await createImageBitmap(file);
  try {
    const type = file.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    const ext = type === "image/jpeg" ? "jpg" : "webp";
    const base = file.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 180) || "screenshot";
    const attempts = [
      { dim: CONSOLE_ATTACHMENT_MAX_DIM, q: 0.92 },
      { dim: CONSOLE_ATTACHMENT_MAX_DIM, q: 0.8 },
      { dim: CONSOLE_ATTACHMENT_MAX_DIM, q: 0.65 },
      { dim: 1280, q: 0.8 },
      { dim: 1280, q: 0.65 },
    ];
    let best: File = file;
    for (const { dim, q } of attempts) {
      const scale = Math.min(1, dim / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) break;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
      if (!blob) break;
      const out = new File([blob], `${base}.${ext}`, { type });
      if (out.size < best.size) best = out;
      if (best.size <= CONSOLE_ATTACHMENT_MAX_BYTES) break;
    }
    return best;
  } finally {
    bitmap.close();
  }
}

/** Browser-only: read a picked file into a ConsoleAttachment. */
export function readAttachmentFile(taskId: string, file: File, now = Date.now()): Promise<ConsoleAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        reject(new Error("Could not read file."));
        return;
      }
      resolve(
        consoleAttachmentSchema.parse({
          id: `att_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
          taskId,
          name: file.name.slice(0, 200) || "screenshot",
          mime: file.type,
          size: file.size,
          dataUrl,
          at: now,
        }),
      );
    };
    reader.readAsDataURL(file);
  });
}

export async function listAttachments(taskId: string): Promise<ConsoleAttachment[]> {
  try {
    const all = await withStore<ConsoleAttachment[]>(STORES.consoleAttachments, "readonly", (s) => s.getAll());
    return all.filter((a) => a.taskId === taskId).sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
}

export async function listAllAttachments(): Promise<ConsoleAttachment[]> {
  try {
    return await withStore<ConsoleAttachment[]>(STORES.consoleAttachments, "readonly", (s) => s.getAll());
  } catch {
    return [];
  }
}

export async function countAttachments(taskIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (taskIds.length === 0) return out;
  try {
    const all = await withStore<ConsoleAttachment[]>(STORES.consoleAttachments, "readonly", (s) => s.getAll());
    for (const a of all) {
      if (taskIds.includes(a.taskId)) out[a.taskId] = (out[a.taskId] ?? 0) + 1;
    }
  } catch {
    /* safe empty */
  }
  return out;
}

export async function saveAttachment(att: ConsoleAttachment): Promise<boolean> {
  try {
    await withStore(STORES.consoleAttachments, "readwrite", (s) =>
      s.put(consoleAttachmentSchema.parse(att)),
    );
    return true;
  } catch {
    return false;
  }
}

export async function deleteAttachment(id: string): Promise<boolean> {
  try {
    await withStore(STORES.consoleAttachments, "readwrite", (s) => s.delete(id));
    return true;
  } catch {
    return false;
  }
}

export async function deleteTaskAttachments(taskId: string): Promise<void> {
  const all = await listAttachments(taskId);
  for (const a of all) await deleteAttachment(a.id);
}
