"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SalesforceObject } from "@/lib/salesforce/types";
import { rankObjects } from "@/lib/search/rank";

interface ObjectSearchOverlayProps {
  objects: SalesforceObject[];
  onSelect: (obj: SalesforceObject) => void;
  onClose: () => void;
}

export function ObjectSearchOverlay({ objects, onSelect, onClose }: ObjectSearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => rankObjects(objects, query, 200),
    [objects, query]
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ESC closes even when focus has moved off the search input
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const go = useCallback(
    (obj: SalesforceObject) => {
      onSelect(obj);
      onClose();
    },
    [onSelect, onClose]
  );

  const handleKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (results[activeIdx]) go(results[activeIdx]);
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [results, activeIdx, go, onClose]
  );

  return (
    <div
      className="modal-overlay"
      style={{ paddingTop: "12vh" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Find objects"
    >
      <div
        className="modal-card max-w-xl flex flex-col overflow-hidden"
        style={{ maxHeight: "70vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-line)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="text-ivory-500 shrink-0" aria-hidden="true">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Jump to object - try Account, Opportunity, MyObject__c…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={handleKey}
            className="flex-1 bg-transparent text-sm text-ivory-950 placeholder-ivory-500 outline-none"
            aria-label="Search objects"
          />
          <kbd className="text-[10px] font-mono bg-[var(--color-canvas)] px-1.5 py-0.5 rounded border border-[var(--color-line)] text-ivory-600">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto p-2" role="listbox" aria-label="Objects">
          {results.length === 0 ? (
            <p className="p-8 text-center text-xs text-ivory-600">
              No objects match &ldquo;<strong>{query}</strong>&rdquo;
            </p>
          ) : (
            results.map((obj, i) => (
              <button
                key={obj.name}
                data-idx={i}
                role="option"
                aria-selected={i === activeIdx}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(obj)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                  i === activeIdx ? "bg-ivory-300" : "hover:bg-ivory-200"
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ivory-950">{obj.label}</span>
                  <span className="block truncate text-[11px] font-mono text-ivory-600">{obj.name}</span>
                </span>
                {obj.custom && (
                  <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded border bg-bronze-100 text-bronze-700 border-bronze-300">
                    Custom
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="px-4 py-2.5 bg-[var(--color-canvas)] border-t border-[var(--color-line)] flex items-center justify-between text-[11px] text-ivory-600">
          <span>↑↓ navigate · ↵ select · esc close</span>
          <span className="font-semibold text-bronze-600">{results.length} shown</span>
        </div>
      </div>
    </div>
  );
}
