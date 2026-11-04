"use client";

import { useEffect, useRef, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { getCanvasBlob } from "@/lib/system-design/blobStore";

/** Shared object-URL cache: one URL per blob id for the session. */
const urlCache = new Map<string, string>();

function blobUrl(id: string): Promise<string | null> {
  const hit = urlCache.get(id);
  if (hit) return Promise.resolve(hit);
  return getCanvasBlob(id).then((rec) => {
    if (!rec) return null;
    const url = URL.createObjectURL(rec.bytes);
    urlCache.set(id, url);
    return url;
  });
}

export interface NoteNodeData {
  text: string;
  editing: boolean;
  onBeginEdit: () => void;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

const NOTE_STYLE =
  "w-52 rounded-md border border-[#C9A86A] bg-[#FFF6D9] px-2.5 py-2 shadow-[0_8px_24px_-12px_rgba(24,20,12,0.45)] text-[12px] leading-relaxed text-ivory-950";

/** Sticky note: double-click to edit inline, drag to move, Del removes. */
export function CanvasNoteView({ data, selected }: NodeProps) {
  const d = data as unknown as NoteNodeData;
  const [draft, setDraft] = useState(d.text);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (d.editing) {
      setDraft(d.text);
      const el = areaRef.current;
      if (el) {
        el.focus();
        // Cursor at the end: the opening keystroke is already text.
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }, [d.editing, d.text]);
  if (d.editing) {
    return (
      <div className={`${NOTE_STYLE} nodrag ${selected ? "ring-2 ring-bronze-500" : ""}`}>
        <textarea
          ref={areaRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => d.onCommit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              d.onCancel();
            }
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") d.onCommit(draft);
          }}
          rows={3}
          aria-label="Canvas note text"
          className="w-full resize-none bg-transparent outline-none"
        />
      </div>
    );
  }
  return (
    <div
      onDoubleClick={(e) => {
        e.stopPropagation();
        d.onBeginEdit();
      }}
      title="Double-click to edit"
      className={`${NOTE_STYLE} cursor-text whitespace-pre-wrap break-words ${selected ? "ring-2 ring-bronze-500" : ""}`}
    >
      {d.text}
    </div>
  );
}

export interface CanvasImageData {
  blobId: string;
  name: string;
  onResize: (width: number, height: number) => void;
}

/** Pasted screenshot: loads bytes from the blobs store, resizable. */
export function CanvasImageView({ data, selected }: NodeProps) {
  const d = data as unknown as CanvasImageData;
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    blobUrl(d.blobId).then((u) => {
      if (!live) return;
      if (u) setUrl(u);
      else setMissing(true);
    });
    return () => {
      live = false;
    };
  }, [d.blobId]);
  return (
    <div className={`rounded-md border border-[var(--color-line)] bg-white p-1 shadow-[0_8px_24px_-12px_rgba(24,20,12,0.45)] ${selected ? "ring-2 ring-bronze-500" : ""}`}>
      <NodeResizer
        minWidth={80}
        minHeight={60}
        isVisible={selected}
        onResizeEnd={(_, params) => d.onResize(Math.round(params.width), Math.round(params.height))}
      />
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={d.name} className="block h-full w-full rounded-sm object-fill" draggable={false} />
      ) : (
        <div className="flex h-24 w-48 flex-col items-center justify-center gap-1 rounded-sm bg-ivory-200 px-3 text-center">
          <p className="text-[11px] font-semibold text-ivory-700">{missing ? "Image unavailable" : "Loading image…"}</p>
          {missing && <p className="text-[10px] text-ivory-500">Bytes stay in the browser where it was pasted.</p>}
        </div>
      )}
    </div>
  );
}
