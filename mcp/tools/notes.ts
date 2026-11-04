import { z } from "zod";
import { claimFile, findRecords, listKind, writeJson } from "../workspace";
import type { McpTool, ToolResult } from "./types";

const KIND = "note";
export const NOTE_FORMAT = "gravenx-note";
export const NOTE_FORMAT_VERSION = 1;

export interface AgentNote {
  id: string;
  title: string;
  /** Markdown - pastes straight into the studio Notes tab. */
  body: string;
  status: "open" | "closed";
  createdAt: number;
  updatedAt: number;
}

interface NoteFile {
  format: string;
  formatVersion: number;
  exportedAt: string;
  note: AgentNote;
}

function asNote(data: unknown): AgentNote | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { note?: unknown };
  const n = (d.note && typeof d.note === "object" ? d.note : data) as Partial<AgentNote>;
  if (typeof n.id !== "string" || typeof n.title !== "string" || typeof n.body !== "string") return null;
  return n as AgentNote;
}

function resolveOne(dir: string, ref: string): { file: string; note: AgentNote } {
  const hits = findRecords(dir, KIND, ref, (data) => {
    const n = asNote(data);
    if (!n) return null;
    return { id: n.id, name: n.title };
  });
  if (hits.length === 0) throw new Error(`No note matches "${ref}" - create one first or check the filename.`);
  if (hits.length > 1) throw new Error(`Ambiguous ref "${ref}" - ${hits.length} matches. Use the exact filename.`);
  const note = asNote(hits[0].data);
  if (!note) throw new Error(`File ${hits[0].file} is not a note.`);
  return { file: hits[0].file, note };
}

function persist(file: string, note: AgentNote): void {
  const out: NoteFile = {
    format: NOTE_FORMAT,
    formatVersion: NOTE_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    note,
  };
  writeJson(file, out);
}

function newId(): string {
  return `note_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export async function createNote(
  dir: string,
  args: { title: string; body: string; overwrite?: boolean },
): Promise<ToolResult> {
  if (!args.body.trim()) return { ok: false, summary: "Empty note.", error: "Body is required." };
  const now = Date.now();
  const note: AgentNote = {
    id: newId(),
    title: args.title.trim().slice(0, 160) || "Untitled note",
    body: args.body,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  const file = claimFile(dir, KIND, note.title, args.overwrite);
  persist(file, note);
  return {
    ok: true,
    file,
    summary: `Note "${note.title}" saved - paste the body into Notes or keep appending.`,
    data: { id: note.id, title: note.title },
  };
}

export async function appendNote(dir: string, args: { ref: string; body: string }): Promise<ToolResult> {
  if (!args.body.trim()) return { ok: false, summary: "Empty append.", error: "Body is required." };
  const { file, note } = resolveOne(dir, args.ref);
  note.body = `${note.body.replace(/\s+$/, "")}\n\n---\n\n${args.body}`;
  note.updatedAt = Date.now();
  persist(file, note);
  return { ok: true, file, summary: `Appended to "${note.title}" (${note.body.length} chars).`, data: { id: note.id } };
}

export async function getNote(dir: string, args: { ref: string }): Promise<ToolResult> {
  const { file, note } = resolveOne(dir, args.ref);
  return { ok: true, file, summary: `"${note.title}" [${note.status}].`, data: { note } };
}

export async function listNotes(dir: string): Promise<ToolResult> {
  const items = listKind(dir, KIND).map(({ file, data }) => {
    const n = asNote(data);
    return { file, id: n?.id, title: n?.title ?? "(unreadable)", status: n?.status, chars: n?.body.length ?? 0, updatedAt: n?.updatedAt };
  });
  return { ok: true, summary: `${items.length} note(s).`, data: { notes: items } };
}

export const noteTools: McpTool[] = [
  {
    name: "note_create",
    description: "Create a Markdown design/meeting note file (decisions, workshops, reviews). Paste the body into the studio Notes tab.",
    shape: {
      title: z.string().min(1).max(160),
      body: z.string().min(1).max(20000).describe("Markdown content"),
      overwrite: z.boolean().optional(),
    },
    run: (dir, args) => createNote(dir, args as { title: string; body: string; overwrite?: boolean }),
  },
  {
    name: "note_append",
    description: "Append a timestamped Markdown section to an existing note (separator added automatically).",
    shape: {
      ref: z.string().min(1).describe("Filename or note title"),
      body: z.string().min(1).max(20000).describe("Markdown to append"),
    },
    run: (dir, args) => appendNote(dir, args as { ref: string; body: string }),
  },
  {
    name: "note_get",
    description: "Read a note with its full Markdown body.",
    shape: { ref: z.string().min(1).describe("Filename or note title") },
    run: (dir, args) => getNote(dir, args as { ref: string }),
  },
  {
    name: "note_list",
    description: "List stored notes with sizes and statuses.",
    shape: {},
    run: (dir) => listNotes(dir),
  },
];
