"use client";

import { useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { buildPicklistCopyTable } from "@/lib/salesforce/picklistValues";
import type { ErdPickValue } from "@/lib/erd/graph";

export interface PicklistPopoverData {
  apiName: string;
  nodeLabel: string;
  fieldName: string;
  fieldType: string;
  values: ErdPickValue[];
  /** Custom picklist field - eligible for in-canvas Add values. */
  customField?: boolean;
  /** Viewport anchor (row rect) - panel flips to fit. */
  x: number;
  y: number;
}

export function PicklistPopover({
  pop,
  onClose,
  onAddValues,
}: {
  pop: PicklistPopoverData;
  onClose: () => void;
  /** Open the Add-values fast track (custom fields only). */
  onAddValues?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as globalThis.Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  const W = 300;
  const left = Math.min(Math.max(8, pop.x), Math.max(8, window.innerWidth - W - 8));
  const top = Math.min(Math.max(8, pop.y), Math.max(8, window.innerHeight - 360));
  const [tableCopied, setTableCopied] = useState(false);

  // Whole list as Label | API Name: HTML table (pastes as a real table in
  // Teams) with a TSV fallback. Inactive values ride along, flagged.
  const copyTable = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const { html, text } = buildPicklistCopyTable(
      pop.values.map((v) => ({ label: `${v.label}${v.active ? "" : " (inactive)"}`, value: v.value })),
    );
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
    } catch {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
    }
    setTableCopied(true);
    window.setTimeout(() => setTableCopied(false), 1500);
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`${pop.fieldName} picklist values`}
      className="fixed z-[80] w-[300px] overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_16px_48px_-12px_rgba(24,20,12,0.4)]"
      style={{ left, top }}
    >
      <div className="flex items-center gap-2 border-b border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold text-ivory-950">
            {pop.nodeLabel} · <span className="font-mono">{pop.fieldName}</span>
          </p>
          <p className="text-[10px] text-ivory-600">
            {pop.fieldType} · {pop.values.length} value{pop.values.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          onClick={copyTable}
          title={tableCopied ? "Table copied - paste into Teams" : `Copy all ${pop.values.length} values as a Label | API Name table`}
          aria-label={tableCopied ? "Table copied" : "Copy all values as a table"}
          className="nodrag shrink-0 cursor-pointer rounded-md border border-[var(--color-line)] p-1.5 text-ivory-600 transition-colors hover:border-bronze-500 hover:text-ivory-950"
        >
          {tableCopied ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path d="m4 12.5 5 5L20 6.5" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M3 10h18M9 10v10M15 10v10" />
            </svg>
          )}
        </button>
      </div>
      <ul className="max-h-64 overflow-y-auto py-1">
        {pop.values.map((v) => (
          <li
            key={v.value}
            className={`flex items-center gap-2 px-3 py-1.5 ${v.active ? "" : "opacity-45"}`}
            title={v.active ? v.value : `${v.value} (inactive)`}
          >
            {v.isDefault ? (
              <span className="text-[11px] text-bronze-600" aria-label="Default value" title="Default">★</span>
            ) : (
              <span className="w-[11px] shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-ivory-950">{v.label}</span>
              <span className="block truncate font-mono text-[10px] text-ivory-600" title={`API name: ${v.value}`}>
                {v.value}
              </span>
            </span>
            <CopyButton text={v.value} label="API name" />
            {!v.active && (
              <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-ivory-500">
                off
              </span>
            )}
          </li>
        ))}
        {pop.values.length === 0 && (
          <li className="px-3 py-4 text-center text-xs text-ivory-600">No values defined.</li>
        )}
      </ul>
      <div className="flex items-center gap-2 border-t border-[var(--color-line-soft)] px-3 py-1.5">
        <p className="flex-1 text-[10px] text-ivory-500">Esc or click elsewhere to close</p>
        {pop.customField && onAddValues && (
          <button
            type="button"
            onClick={onAddValues}
            className="cursor-pointer rounded-lg bg-[#27241F] px-2 py-1 text-[11px] font-semibold text-[#F5F1E8] hover:bg-[#3A352D]"
          >
            + Add values
          </button>
        )}
      </div>
    </div>
  );
}
