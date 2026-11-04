"use client";

import { useRef, useState } from "react";
import Button from "../ui/Button";
import { docxImportEmpty, type DocxImport } from "@/lib/notes/docxImport";

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Word import trigger: picks a .docx, converts it client-side (mammoth
 * lazy-loads in the import chunk), and hands the caller an editable
 * NoteBody. The caller decides: new note, or appended to a draft.
 */
export function WordImportButton({
  onImport,
  onError,
  label = "Import Word",
}: {
  onImport: (imp: DocxImport) => void;
  onError?: (message: string) => void;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = async (file: File) => {
    if (!/\.docx$/i.test(file.name)) {
      onError?.("Only .docx imports - resave a legacy .doc as .docx first.");
      return;
    }
    if (file.size > MAX_BYTES) {
      onError?.("That file is over 15 MB - trim images and retry.");
      return;
    }
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const { docxBufferToNoteBody } = await import("@/lib/notes/docxImport");
      const imp = await docxBufferToNoteBody(buf, file.name);
      if (docxImportEmpty(imp)) {
        onError?.("No readable text found in that document.");
        return;
      }
      onImport(imp);
    } catch {
      onError?.("Could not read that Word file - it may be corrupt or password-protected.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".docx"
        aria-label="Import a Word document"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void run(file);
        }}
      />
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        title="Import an existing .docx as editable notes"
      >
        {busy ? "Importing…" : label}
      </Button>
    </>
  );
}
