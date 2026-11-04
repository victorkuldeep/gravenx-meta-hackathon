"use client";

import { useState } from "react";
import Button from "../ui/Button";

export interface ExportSheetOption {
  id: string;
  label: string;
  desc: string;
  onExport: () => void;
}

/**
 * Shared export/import sheet (B3). One consistent surface: pick a format
 * with explicit content disclosure, optional sensitive-data acknowledgement,
 * download - plus an optional import section with the same styling.
 */
export function ExportSheet({
  title,
  options,
  sensitiveNote,
  importLabel,
  importAccept,
  onImportFile,
  onClose,
}: {
  title: string;
  options: ExportSheetOption[];
  sensitiveNote?: string;
  importLabel?: string;
  importAccept?: string;
  onImportFile?: (file: File) => Promise<string | null>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(options[0]?.id ?? "");
  const [acknowledged, setAcknowledged] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const active = options.find((o) => o.id === picked);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="mx-auto max-w-md rounded-2xl border border-[#E8E2D8] bg-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-[14px] font-semibold text-[#27241F]">{title}</p>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-lg px-2 py-1 text-[#777168] hover:bg-[#FAF8F2]">
            ✕
          </button>
        </div>
        <div className="mt-3 space-y-2" role="radiogroup" aria-label="Export format">
          {options.map((o) => (
            <label key={o.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${picked === o.id ? "border-[#A98450] bg-[#FAF3E3]" : "border-[#F0EBE0]"}`}>
              <input type="radio" name="export-format" checked={picked === o.id} onChange={() => setPicked(o.id)} className="mt-1 accent-[#A98450]" />
              <span>
                <span className="block text-[12px] font-semibold text-[#27241F]">{o.label}</span>
                <span className="block text-[11px] text-[#777168]">{o.desc}</span>
              </span>
            </label>
          ))}
        </div>
        {sensitiveNote && (
          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-[#E0C491] bg-[#F3EADB] px-3 py-2 text-[11px] text-[#9A5B13]">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 accent-[#9A5B13]" />
            {sensitiveNote}
          </label>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              active?.onExport();
              onClose();
            }}
            disabled={!active || (!!sensitiveNote && !acknowledged)}
          >
            Download
          </Button>
        </div>
        {importLabel && onImportFile && (
          <div className="mt-3 border-t border-[#F0EBE0] pt-3">
            <label className="block cursor-pointer rounded-lg border border-dashed border-[#D8CFC0] px-3 py-2.5 text-center text-[12px] font-semibold text-[#777168] hover:border-[#A98450] hover:text-[#27241F]">
              {importLabel}
              <input
                type="file"
                accept={importAccept ?? "application/json,.json"}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  void onImportFile(file).then((msg) => {
                    setImportMsg(msg);
                    if (!msg) onClose();
                  });
                }}
              />
            </label>
            {importMsg && <p className="mt-1.5 text-[11px] font-semibold text-[#B3261E]">{importMsg}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
