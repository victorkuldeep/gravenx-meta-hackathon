import { z } from "zod";
import { STORES, withStore } from "@/lib/db";
import type { CanvasLinkView } from "@/lib/console/sync";
import type { ConsoleStatus } from "@/lib/console/model";
import { consoleBodyToNote, noteToConsoleBody } from "@/lib/console/model";
import type { NoteBody } from "./notebody";

/**
 * Standalone Notes manager: general discussion notes with their own
 * lifecycle, editable in a full rich editor, exportable to Word, and
 * visible from Console as linkable note views (never copied there).
 */

export interface StdNote {
  id: string;
  title: string;
  /** Stored description triple - same shape as console bodies. */
  body?: string;
  bodyFormat?: NoteBody["format"];
  bodyHtml?: string;
  status: ConsoleStatus;
  createdAt: number;
  updatedAt: number;
}

const KIND = "note" as const;

export const stdNoteSchema: z.ZodType<StdNote> = z.object({
  id: z.string().min(1),
  title: z.string().max(160).default("Untitled note"),
  body: z.string().max(12000).optional(),
  bodyFormat: z.enum(["md", "rich"]).optional(),
  bodyHtml: z.string().max(30000).optional(),
  status: z.enum(["open", "in-progress", "blocked", "awaiting-feedback", "resolved"]).default("open"),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export function newStdNote(title: string, now = Date.now()): StdNote {
  const clean = title.trim().slice(0, 160) || "Untitled note";
  return { id: `note_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`, title: clean, status: "open", createdAt: now, updatedAt: now };
}

/** Stored triple → editor-ready body (same migration rule as console). */
export function stdNoteToBody(n: Pick<StdNote, "body" | "bodyFormat" | "bodyHtml">): NoteBody {
  return consoleBodyToNote({ body: n.body, bodyFormat: n.bodyFormat, bodyHtml: n.bodyHtml });
}

/** Editor draft → storable triple. */
export function bodyToStdNote(b: NoteBody): Pick<StdNote, "body" | "bodyFormat" | "bodyHtml"> {
  return noteToConsoleBody(b) as Pick<StdNote, "body" | "bodyFormat" | "bodyHtml">;
}

function clean(note: StdNote): StdNote {
  return stdNoteSchema.parse(note);
}

export async function listStdNotes(): Promise<StdNote[]> {
  try {
    const all = await withStore<StdNote[]>(STORES.notes, "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveStdNote(note: StdNote): Promise<boolean> {
  try {
    await withStore(STORES.notes, "readwrite", (s) => s.put(clean({ ...note, updatedAt: Date.now() })));
    return true;
  } catch {
    return false;
  }
}

export async function deleteStdNote(id: string): Promise<boolean> {
  try {
    await withStore(STORES.notes, "readwrite", (s) => s.delete(id));
    return true;
  } catch {
    return false;
  }
}

/** Every note as a Console-linkable view. Read-only there - notes live here. */
export function stdNotesToViews(notes: StdNote[]): CanvasLinkView[] {
  return notes.map((n) => ({
    surface: "notes" as const,
    recordId: n.id,
    recordName: n.title,
    title: n.title,
    kind: KIND,
    status: n.status,
    updatedAt: n.updatedAt,
    excerpt: (n.body ?? "").slice(0, 120),
  }));
}

export async function pullNotes(): Promise<CanvasLinkView[]> {
  return stdNotesToViews(await listStdNotes());
}
