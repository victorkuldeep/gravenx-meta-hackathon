"use client";

import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Button from "./Button";

/** Default zero-state art: dashed outline flowing into a solid card. */
export function InventoryZeroArt() {
  return (
    <svg
      width="132"
      height="76"
      viewBox="0 0 132 76"
      fill="none"
      aria-hidden="true"
      className="mx-auto h-auto w-[132px]"
    >
      <rect x="6" y="12" width="48" height="52" rx="9" fill="#FFFFFF" stroke="#D8CFC0" strokeWidth="1.5" strokeDasharray="4 4" />
      <line x1="16" y1="28" x2="44" y2="28" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
      <line x1="16" y1="40" x2="44" y2="40" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
      <line x1="16" y1="52" x2="34" y2="52" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
      <rect x="78" y="12" width="48" height="52" rx="9" fill="#FAF8F2" stroke="#C9A86A" strokeWidth="1.5" />
      <line x1="88" y1="28" x2="116" y2="28" stroke="#C9A86A" strokeWidth="4" strokeLinecap="round" />
      <line x1="88" y1="40" x2="108" y2="40" stroke="#C9A86A" strokeWidth="4" strokeLinecap="round" />
      <line x1="54" y1="38" x2="78" y2="38" stroke="#A98450" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M72 33 L78 38 L72 43" stroke="#A98450" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Shared full-height inventory column: header + New, search, scrollable
 * rows, and a teaching zero-state with numbered punch lines. Rows come
 * from the caller; the shell stays identical on every surface.
 */
export function InventoryAside({
  title,
  count,
  query,
  onQuery,
  searchLabel,
  onNew,
  newTitle,
  zeroTitle,
  zeroLines,
  footer,
  children,
  fill = false,
  collapsed = false,
  onToggleCollapse,
}: {
  title: string;
  count: number;
  query: string;
  onQuery: (q: string) => void;
  searchLabel: string;
  onNew: () => void;
  newTitle: string;
  zeroTitle: string;
  zeroLines: string[];
  footer?: ReactNode;
  children: ReactNode;
  /** Fill the parent row with no viewport cap - parent must own the height. */
  fill?: boolean;
  /** Controlled collapse - caller owns the state so the grid column can shrink too. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  if (collapsed) {
    return (
      <aside
        className="flex h-full flex-col items-center gap-2 rounded-xl border border-[#E8E2D8] bg-white py-3"
        aria-label={`${title} inventory, collapsed`}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          title={`Expand ${title}`}
          aria-label={`Expand ${title}`}
          className="cursor-pointer rounded-lg border border-[#E8E2D8] p-1.5 text-[#777168] hover:border-[#C9A86A] hover:text-[#27241F]"
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <span className="font-mono text-[10px] text-[#A39B8E]" title={`${count} items`}>
          {count}
        </span>
      </aside>
    );
  }

  return (
    <aside
      className={`flex h-full flex-col rounded-xl border border-[#E8E2D8] bg-white p-3 ${fill ? "min-h-0" : "max-h-[calc(100vh-140px)] min-h-[420px]"}`}
      aria-label={`${title} inventory`}
    >
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <p className="truncate text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
          {title} · {count}
        </p>
        <span className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onNew} title={newTitle}>
            + New
          </Button>
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={`Collapse ${title} - more room for the canvas`}
              aria-label={`Collapse ${title}`}
              className="cursor-pointer rounded-lg p-1 text-[#A39B8E] hover:bg-[#F4EFE6] hover:text-[#27241F]"
            >
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
          )}
        </span>
      </div>
      {count > 0 && (
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={searchLabel}
          aria-label={searchLabel}
          spellCheck={false}
          className="mb-2 w-full shrink-0 rounded-lg border border-[#E8E2D8] px-2.5 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none"
        />
      )}
      {count === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto py-3 text-center">
          <InventoryZeroArt />
          <p className="mt-2 text-[13px] font-semibold text-[#27241F]">{zeroTitle}</p>
          <ol className="mx-auto mt-2 max-w-[240px] space-y-1.5 text-left text-[11px] leading-relaxed text-[#777168]">
            {zeroLines.map((line, i) => (
              <li key={i}>
                <span className="font-mono font-bold text-[#A98450]">{i + 1} </span>
                {line}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      )}
      {footer && <div className="mt-auto shrink-0 pt-2">{footer}</div>}
    </aside>
  );
}
