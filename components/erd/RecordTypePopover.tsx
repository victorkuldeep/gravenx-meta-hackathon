"use client";

import { useEffect, useRef, useState } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import type { SalesforceRecordTypeInfo } from "@/lib/salesforce/types";

export interface RecordTypePopoverData {
  apiName: string;
  nodeLabel: string;
  recordTypes: SalesforceRecordTypeInfo[];
  /** Viewport anchor (badge rect) - panel flips to fit. */
  x: number;
  y: number;
}

/**
 * Record types on an ERD table, popover-style like picklist values: every
 * row shows the label, the developer name and the 18-char id, each with a
 * copy button - the two identifiers integrations actually need.
 */
export function RecordTypePopover({
  pop,
  onClose,
  onExportMatrix,
}: {
  pop: RecordTypePopoverData;
  onClose: () => void;
  /** Picklist x record-type matrix download (parent fetches availability). */
  onExportMatrix?: (apiName: string) => Promise<void>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [matrixBusy, setMatrixBusy] = useState(false);

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

  const W = 340;
  const left = Math.min(Math.max(8, pop.x), Math.max(8, window.innerWidth - W - 8));
  const top = Math.min(Math.max(8, pop.y), Math.max(8, window.innerHeight - 360));

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={`${pop.apiName} record types`}
      className="fixed z-[80] w-[340px] overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_16px_48px_-12px_rgba(24,20,12,0.4)]"
      style={{ left, top }}
    >
      <div className="border-b border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-3 py-2">
        <p className="truncate text-[11px] font-semibold text-ivory-950">
          {pop.nodeLabel} · <span className="font-mono">{pop.apiName}</span>
        </p>
        <p className="text-[10px] text-ivory-600">
          {pop.recordTypes.length} record type{pop.recordTypes.length === 1 ? "" : "s"}
        </p>
      </div>
      <ul className="max-h-72 overflow-y-auto py-1">
        {pop.recordTypes.map((rt) => (
          <li
            key={rt.recordTypeId}
            className={`border-b border-[var(--color-line-soft)] px-3 py-2 last:border-0 ${rt.active ? "" : "opacity-55"}`}
          >
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ivory-950" title={rt.name}>
                {rt.name}
              </span>
              {rt.defaultRecordTypeMapping && (
                <span className="shrink-0 rounded border border-bronze-300 bg-bronze-100 px-1 py-px text-[9px] font-bold text-bronze-700" title="Default for new records">
                  DEFAULT
                </span>
              )}
              {rt.master && (
                <span className="shrink-0 rounded border border-[var(--color-line)] px-1 py-px text-[9px] font-bold text-ivory-600" title="Master sees every active value automatically">
                  MASTER
                </span>
              )}
              {!rt.active && (
                <span className="shrink-0 rounded border border-[var(--color-line)] px-1 py-px text-[9px] font-bold text-ivory-500">
                  INACTIVE
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ivory-700" title={`Developer name: ${rt.developerName}`}>
                {rt.developerName}
              </span>
              <CopyButton text={rt.developerName} label="developer name" />
            </div>
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ivory-500" title={`Record type id: ${rt.recordTypeId}`}>
                {rt.recordTypeId}
              </span>
              <CopyButton text={rt.recordTypeId} label="record type id" />
            </div>
          </li>
        ))}
        {pop.recordTypes.length === 0 && (
          <li className="px-3 py-4 text-center text-xs text-ivory-600">No record types on this object.</li>
        )}
      </ul>
      <div className="flex items-center gap-2 border-t border-[var(--color-line-soft)] px-3 py-1.5">
        <p className="flex-1 text-[10px] text-ivory-500">Esc or click elsewhere to close</p>
        {onExportMatrix && pop.recordTypes.length > 0 && (
          <button
            type="button"
            disabled={matrixBusy}
            onClick={() => {
              setMatrixBusy(true);
              void onExportMatrix(pop.apiName).finally(() => setMatrixBusy(false));
            }}
            title="Download every picklist value by record type as .xlsx"
            className="shrink-0 cursor-pointer rounded-md border border-bronze-300 bg-bronze-100 px-2 py-1 text-[10px] font-bold text-bronze-700 transition-colors hover:bg-bronze-200 disabled:opacity-50"
          >
            {matrixBusy ? "Building…" : "Matrix (.xlsx)"}
          </button>
        )}
      </div>
    </div>
  );
}
