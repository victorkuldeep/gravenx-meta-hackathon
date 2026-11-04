"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import Input from "../ui/Input";
import type { ErdEdgeKind } from "@/lib/erd/graph";

export interface DiscoverCandidate {
  apiName: string;
  label: string;
  custom: boolean;
  group: "parent" | "child";
  /** Lookup field (child side) or relationship name driving the link. */
  via: string;
  kind: ErdEdgeKind;
  onCanvas: boolean;
  system: boolean;
}

interface DiscoverPickerProps {
  open: boolean;
  title: string;
  subtitle: string;
  candidates: DiscoverCandidate[];
  /** Zero-state message (empty families still open the picker). */
  emptyMessage?: string;
  /**
   * Standard-family list. When provided, the picker gains Custom/Standard
   * tabs (per-entity pull mode); otherwise it renders the single list as
   * before (generic discover modes).
   */
  standardCandidates?: DiscoverCandidate[];
  standardEmptyMessage?: string;
  onApply: (selected: string[]) => void;
  onClose: () => void;
  /** Hop the viewport to an on-canvas row (directory mode). */
  onFocusNode?: (apiName: string) => void;
}

export function DiscoverPicker({
  open,
  title,
  subtitle,
  candidates,
  emptyMessage,
  standardCandidates,
  standardEmptyMessage,
  onApply,
  onClose,
  onFocusNode,
}: DiscoverPickerProps) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [family, setFamily] = useState<"custom" | "standard">("custom");

  const tabbed = standardCandidates !== undefined;
  // Land on the family that has rows; Custom wins ties (old behavior).
  const landing: "custom" | "standard" =
    tabbed && candidates.length === 0 && standardCandidates.length > 0 ? "standard" : "custom";
  const active: DiscoverCandidate[] = !tabbed || family === "custom" ? candidates : standardCandidates;
  const combined: DiscoverCandidate[] = tabbed ? [...candidates, ...standardCandidates] : candidates;

  useEffect(() => {
    if (open) {
      // Nothing pre-checked: the architect ticks exactly what joins the
      // canvas. All/None stay one click away per tab.
      setChecked(new Set());
      setFamily(landing);
      setFilter("");
    }
  }, [open, candidates, standardCandidates, landing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const visible = useMemo(() => {
    const q = filter.toLowerCase().trim();
    if (!q) return active;
    return active.filter(
      (c) => c.apiName.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)
    );
  }, [active, filter]);

  if (!open) return null;

  const parents = visible.filter((c) => c.group === "parent");
  const children = visible.filter((c) => c.group === "child");
  // Selection spans tabs; Add pulls from both families at once.
  const addableAll = combined.filter((c) => !c.onCanvas).map((c) => c.apiName);
  const picked = [...checked].filter((n) => addableAll.includes(n));
  const activeAddable = active.filter((c) => !c.onCanvas).map((c) => c.apiName);
  const activeEmpty = family === "custom" ? emptyMessage : standardEmptyMessage;

  const toggle = (apiName: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(apiName)) next.delete(apiName);
      else next.add(apiName);
      return next;
    });
  };

  const row = (c: DiscoverCandidate) => (
    <label
      key={`${c.group}:${c.apiName}`}
      className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:bg-ivory-300 ${
        c.onCanvas ? "opacity-60" : checked.has(c.apiName) ? "bg-ivory-200" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={c.onCanvas || checked.has(c.apiName)}
        disabled={c.onCanvas}
        onChange={() => toggle(c.apiName)}
        className="h-4 w-4 shrink-0 rounded border-ivory-400 bg-white text-bronze-600 focus:ring-bronze-500 disabled:opacity-60"
        aria-label={c.onCanvas ? `${c.label} (already on canvas)` : `Add ${c.label}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-ivory-950">{c.label}</span>
        <span className="block truncate text-[11px] font-mono text-ivory-600">
          {c.apiName} · via <span className="text-bronze-600">{c.via}</span>
        </span>
      </span>
      <span
        className={`shrink-0 rounded border px-1 py-px font-mono text-[9px] font-bold ${
          c.kind === "md"
            ? "bg-ivory-950 text-ivory-100 border-ivory-950"
            : "bg-white text-ivory-600 border-[var(--color-line)]"
        }`}
        title={c.kind === "md" ? "Master-detail (solid line)" : "Lookup (dotted line)"}
      >
        {c.kind === "md" ? "M-D" : "Lookup"}
      </span>
      {c.custom && <Badge variant="info">Custom</Badge>}
      {c.onCanvas && onFocusNode && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onFocusNode(c.apiName);
          }}
          title={`Center canvas on ${c.apiName}`}
          aria-label={`Center canvas on ${c.apiName}`}
          className="shrink-0 cursor-pointer rounded p-0.5 text-[#722F37] hover:bg-[#F0EBE0]"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </button>
      )}
      {c.system && (
        <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-ivory-500" title="System object">
          sys
        </span>
      )}
      {c.onCanvas && (
        <span className="shrink-0 rounded border border-bronze-300 bg-bronze-100 px-1 py-px text-[9px] font-semibold text-bronze-700">
          On canvas
        </span>
      )}
    </label>
  );

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={{ paddingTop: "10vh" }}
    >
      <div
        className="modal-card max-w-lg flex flex-col"
        style={{ maxHeight: "78vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-5 pb-3 border-b border-[var(--color-line-soft)] shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
            Selective discovery
          </p>
          <h2 className="mt-1 text-lg font-bold text-ivory-950">{title}</h2>
          <p className="mt-0.5 text-xs text-ivory-600">{subtitle}</p>
          {tabbed && (
            <div className="mt-3 flex rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-0.5" role="tablist" aria-label="Relationship family">
              {(
                [
                  ["custom", `Custom (${candidates.length})`],
                  ["standard", `Standard (${(standardCandidates ?? []).length})`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={family === id}
                  onClick={() => {
                    setFamily(id);
                    setFilter("");
                  }}
                  className={`flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    family === id ? "bg-[var(--color-surface)] text-ivory-950 shadow-sm" : "text-ivory-500 hover:text-ivory-950"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <div className="flex-1">
              <Input
                placeholder="Filter candidates…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter candidates"
              />
            </div>
            <button
              type="button"
              onClick={() => setChecked((prev) => new Set([...prev, ...activeAddable]))}
              title={tabbed ? "Select all in this tab (keeps the other tab's picks)" : "Select all"}
              className="text-[11px] font-medium text-bronze-600 hover:text-bronze-700 underline cursor-pointer shrink-0"
            >
              All
            </button>
            <button
              type="button"
              onClick={() =>
                setChecked((prev) => {
                  const next = new Set(prev);
                  for (const c of active) next.delete(c.apiName);
                  return next;
                })
              }
              title={tabbed ? "Clear this tab (keeps the other tab's picks)" : "Clear all"}
              className="text-[11px] text-ivory-600 hover:text-ivory-950 underline cursor-pointer shrink-0"
            >
              None
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3 space-y-3">
          {active.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-8 text-center">
              <svg width="144" height="72" viewBox="0 0 144 72" fill="none" aria-hidden="true">
                <ellipse cx="72" cy="36" rx="58" ry="26" stroke="#C9A86A" strokeWidth="1.25" strokeDasharray="3 5" opacity="0.8" />
                <ellipse cx="72" cy="36" rx="36" ry="16" stroke="#D8D0C0" strokeWidth="1.25" strokeDasharray="3 5" />
                <circle cx="72" cy="36" r="6" fill="#722F37" />
                <circle cx="72" cy="36" r="2" fill="#F4EAD6" />
                <circle cx="130" cy="36" r="4" fill="#fff" stroke="#9A7653" strokeWidth="1.5" />
                <circle cx="130" cy="36" r="1" fill="#9A7653" />
                <circle cx="14" cy="36" r="4" fill="#fff" stroke="#9A7653" strokeWidth="1.5" />
                <circle cx="14" cy="36" r="1" fill="#9A7653" />
                <circle cx="97" cy="47" r="3" fill="#fff" stroke="#A39B8E" strokeWidth="1.5" />
                <circle cx="47" cy="25" r="3" fill="#fff" stroke="#A39B8E" strokeWidth="1.5" />
                <path d="M72 6v6M69 9h6" stroke="#C9A86A" strokeWidth="1.5" />
                <path d="M120 60v5M117.5 62.5h5" stroke="#C9A86A" strokeWidth="1.25" />
              </svg>
              <p className="mt-3 max-w-xs text-xs leading-relaxed text-ivory-700">
                {activeEmpty ?? "Nothing linked here yet."}
              </p>
            </div>
          ) : (
            <>
          {parents.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[1.6px] text-ivory-600">
                Parents ({parents.length})
              </p>
              <div className="rounded-lg border border-[var(--color-line)] divide-y divide-[var(--color-line-soft)] overflow-hidden">
                {parents.map(row)}
              </div>
            </div>
          )}
          {children.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[1.6px] text-ivory-600">
                Children ({children.length})
              </p>
              <div className="rounded-lg border border-[var(--color-line)] divide-y divide-[var(--color-line-soft)] overflow-hidden">
                {children.map(row)}
              </div>
            </div>
          )}
          {visible.length === 0 && (
            <p className="py-6 text-center text-xs text-ivory-600">No candidates match.</p>
          )}
            </>
          )}
        </div>

        <div className="px-6 py-3.5 border-t border-[var(--color-line-soft)] bg-[var(--color-canvas)] flex items-center gap-2 shrink-0">
          <p className="flex-1 text-[11px] text-ivory-600">
            {combined.length === 0
              ? "Nothing to add"
              : addableAll.length === 0
                ? "Everything is already on canvas - ⌖ hops the viewport"
                : `${picked.length} selected${tabbed ? " across both tabs" : ""} · solid = master-detail, dotted = lookup`}
          </p>
          <Button variant="ghost" onClick={onClose}>
            {combined.length === 0 ? "Close" : "Cancel"}
          </Button>
          {combined.length > 0 && (
            <Button onClick={() => onApply(picked)} disabled={picked.length === 0}>
              Add{picked.length > 0 ? ` ${picked.length}` : ""}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
