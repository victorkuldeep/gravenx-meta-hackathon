"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface PicklistDropdownProps {
  values: string[];
  /** Single value, or ";"-joined values in multiple mode. */
  value: string;
  multiple?: boolean;
  placeholder?: string;
  ariaLabel: string;
  /** API value → display label. Rows show "Label (api)" when they differ. */
  labels?: Record<string, string>;
  onChange: (value: string) => void;
}

/**
 * Premium picklist dropdown (reusable): button trigger, searchable popover
 * list, check-marked selection. Single closes on pick; multiple toggles
 * with an explicit Done. Used everywhere a picklist value is edited.
 */
export default function PicklistDropdown({
  values,
  value,
  multiple = false,
  placeholder = "-- Select --",
  ariaLabel,
  labels,
  onChange,
}: PicklistDropdownProps) {
  const text = (v: string) => {
    const l = labels?.[v];
    return l && l !== v ? `${l} (${v})` : v;
  };
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Portal geometry (viewport-fixed): measured on open so the popover escapes
  // overflow-hidden ancestors; flips upward when the viewport bottom is near.
  const [pop, setPop] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);

  const measure = () => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return null;
    const spaceBelow = window.innerHeight - r.bottom;
    if (spaceBelow < 264 && r.top > 264) {
      return { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 };
    }
    return { left: r.left, width: r.width, top: r.bottom + 4 };
  };

  const selected = useMemo(
    () => new Set(value.split(";").map((s) => s.trim()).filter(Boolean)),
    [value]
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return values;
    return values.filter((v) => v.toLowerCase().includes(q) || (labels?.[v] ?? "").toLowerCase().includes(q));
  }, [values, query, labels]);

  useEffect(() => {
    if (!open) return;
    setPop(measure());
    const inside = (t: EventTarget | null) =>
      (rootRef.current && rootRef.current.contains(t as globalThis.Node)) ||
      ((t as HTMLElement | null)?.closest?.("[data-picklist-pop]") ?? false);
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Any scroll/resize moves the viewport-fixed popover - close instead of
    // chasing coordinates, except scrolls inside the popover list itself.
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest && el.closest("[data-picklist-pop]")) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open ]);

  const label = multiple
    ? selected.size === 0
      ? placeholder
      : [...selected].map(text).join("; ")
    : value === ""
      ? placeholder
      : text(value);

  const pick = (v: string) => {
    if (!multiple) {
      onChange(v);
      setOpen(false);
      return;
    }
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange([...next].join(";"));
  };

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setQuery("");
          setOpen((v) => !v);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={label}
        className={`flex w-full cursor-pointer items-center gap-2 rounded-lg border bg-white px-2.5 py-1.5 text-left font-mono text-[13px] transition-colors ${
          open ? "border-[#A98450]" : "border-[#E8E2D8] hover:border-[#A98450]"
        } ${value === "" && !multiple ? "text-[#A39B8E]" : "text-[#27241F]"}`}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          aria-hidden="true"
          className={`shrink-0 text-[#A39B8E] transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open &&
        pop &&
        createPortal(
          <div
            data-picklist-pop
            className="overflow-hidden rounded-lg border border-[#E8E2D8] bg-white shadow-[0_16px_40px_-16px_rgba(24,20,12,0.4)]"
            style={{
              position: "fixed",
              zIndex: 90,
              left: pop.left,
              width: Math.max(pop.width, 180),
              ...(pop.top !== undefined ? { top: pop.top } : { bottom: pop.bottom }),
            }}
          >
          {values.length > 8 && (
            <div className="border-b border-[#E8E2D8] p-1.5">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${values.length} values…`}
                aria-label="Search values"
                className="w-full rounded-md border border-[#E8E2D8] px-2 py-1 text-[13px] focus:border-[#A98450] focus:outline-none"
              />
            </div>
          )}
          <div className="max-h-56 overflow-y-auto p-1" role="listbox" aria-label={ariaLabel}>
            {!multiple && (
              <button
                type="button"
                role="option"
                aria-selected={value === ""}
                onClick={() => pick("")}
                className="block w-full cursor-pointer rounded-md px-2 py-1.5 text-left font-mono text-[13px] text-[#A39B8E] hover:bg-[#F5F1E8]"
              >
                {placeholder}
              </button>
            )}
            {shown.map((v) => {
              const on = selected.has(v);
              return (
                <button
                  key={v}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => pick(v)}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-[13px] transition-colors ${
                    on ? "bg-[#211F1B] text-white" : "text-[#27241F] hover:bg-[#F5F1E8]"
                  }`}
                >
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border text-[10px] leading-none ${
                      on ? "border-white bg-white text-[#211F1B]" : "border-[#A39B8E] text-transparent"
                    }`}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={text(v)}>{text(v)}</span>
                </button>
              );
            })}
            {shown.length === 0 && (
              <p className="px-2 py-3 text-center text-[13px] text-[#A39B8E]">No values match.</p>
            )}
          </div>
          {multiple && (
            <div className="flex items-center justify-between border-t border-[#E8E2D8] p-1.5">
              <span className="px-1 text-[11px] text-[#A39B8E]">{selected.size} picked</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="cursor-pointer rounded-md bg-[#211F1B] px-3 py-1 text-[11px] font-semibold text-white hover:opacity-90"
              >
                Done
              </button>
            </div>
          )}
          </div>,
          document.body
        )}
    </div>
  );
}
