import { noteBodyFromHtml, noteBodyEmpty, type NoteBody } from "./notebody";

export interface DocxImport {
  body: NoteBody;
  /** Suggested note title derived from the file name. */
  title: string;
  /** Mammoth conversion caveats (unsupported elements, capped). */
  warnings: string[];
}

/**
 * Word import: an existing .docx becomes an editable note. Mammoth turns
 * the document into HTML, then the note pipeline takes over - the same
 * sanitizer as pasted content, the same dual body as typed notes, so the
 * import lands in the Rich editor with Markdown, preview, search and Word
 * export all working. Lazy-loaded by callers: mammoth ships in the import
 * chunk, never in the main bundle.
 */
export async function docxBufferToNoteBody(data: ArrayBuffer | Uint8Array, fileName: string): Promise<DocxImport> {
  const mammoth = await import("mammoth");
  // Browser bundles remap to mammoth's browser unzip (arrayBuffer); the Node
  // entry only reads Buffers - pick by what we hold, not where we run.
  const input =
    typeof Buffer !== "undefined" && Buffer.isBuffer(data)
      ? { buffer: data as Uint8Array }
      : { arrayBuffer: data as ArrayBuffer };
  const result = await mammoth.convertToHtml(input);
  const body = noteBodyFromHtml(result.value);
  const base = fileName.replace(/\.docx$/i, "").trim().slice(0, 160);
  return {
    body,
    title: base || "Imported note",
    warnings: result.messages.slice(0, 8).map((m) => m.message),
  };
}

/** True when the document held no readable text at all. */
export function docxImportEmpty(imp: DocxImport): boolean {
  return noteBodyEmpty(imp.body);
}
