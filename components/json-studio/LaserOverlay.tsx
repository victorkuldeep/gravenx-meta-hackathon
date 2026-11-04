"use client";

import { useEffect } from "react";
import { LaserLayer } from "../laser/LaserLayer";

/**
 * Laser pointer overlay (ERD language): L toggles, Esc exits, strokes
 * hold ~1s then melt away. Thin wrapper over the shared LaserLayer -
 * wheel scroll forwards to the inner scroll container so walkthroughs
 * keep scrolling. Never activates while typing.
 */
export function LaserOverlay({
  active,
  hostRef,
}: {
  active: boolean;
  /** Ref of the element containing the scrollable surface. */
  hostRef: React.RefObject<HTMLElement | null>;
}) {
  if (!active) return null;
  return <LaserLayer active={active} scrollHostRef={hostRef} />;
}

/** L toggles (never while typing or with modifiers), Esc exits. */
export function useLaser(active: boolean, setActive: (v: boolean | ((p: boolean) => boolean)) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActive(false);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() !== "l") return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      e.preventDefault();
      setActive((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setActive]);
  return active;
}

export function LaserButton({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      title={active ? "Exit laser pointer (Esc)" : "Laser walkthrough - press L to present, Esc to exit"}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
        active
          ? "bg-[#ef4444] border-[#dc2626] text-white shadow-[0_0_12px_rgba(239,68,68,0.5)]"
          : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-700 hover:border-red-400 hover:text-red-600"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-white" : "bg-[#ef4444]"}`} aria-hidden="true" />
      {active ? "Laser • Esc" : "Laser"}
    </button>
  );
}
