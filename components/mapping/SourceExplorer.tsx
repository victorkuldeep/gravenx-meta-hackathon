"use client";

import { useMemo, useState } from "react";
import type { MappingRow, SourcePath } from "@/lib/mapping/types";

const KIND_BADGE: Record<string, string> = {
  scalar: "text-[#777168]",
  object: "text-[#A98450]",
  array: "text-[#5F7048]",
  null: "text-[#A39B8E]",
};

function typeLabel(p: SourcePath): string {
  if (p.kind === "array") return "array";
  if (p.kind === "object") return "object";
  if (p.kind === "null") return "null";
  return p.jsonType;
}

/** Source JSON navigator: tree, search, mapped/unmapped filter. */
export function SourceExplorer({
  paths,
  mappings,
  selected,
  onSelect,
}: {
  paths: SourcePath[];
  mappings: MappingRow[];
  selected: string | null;
  onSelect: (pathId: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "mapped" | "unmapped">("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const mappedSet = useMemo(() => new Set(mappings.filter((m) => m.kind !== "excluded").map((m) => m.sourcePath)), [mappings]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return paths.filter((p) => {
      if (filter === "mapped" && !mappedSet.has(p.id)) return false;
      if (filter === "unmapped" && (mappedSet.has(p.id) || p.kind !== "scalar")) return false;
      if (q && !p.path.toLowerCase().includes(q) && !p.key.toLowerCase().includes(q)) {
        // Keep parents of matches visible.
        const hasMatch = paths.some(
          (c) => c.id.startsWith(p.id) && (c.path.toLowerCase().includes(q) || c.key.toLowerCase().includes(q))
        );
        if (!hasMatch) return false;
      }
      if (p.parent && collapsed.has(p.parent)) return false;
      return true;
    });
  }, [paths, query, filter, mappedSet, collapsed]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search source paths…"
          aria-label="Search source paths"
          spellCheck={false}
          className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 pr-7 text-[12px] focus:border-[#A98450] focus:outline-none"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear source search" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-[12px] text-[#A39B8E] hover:text-[#27241F] cursor-pointer">
            ✕
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {(["all", "mapped", "unmapped"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold cursor-pointer ${
              filter === f ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] bg-white text-[#777168] hover:text-[#27241F]"
            }`}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto font-mono text-[10px] text-[#A39B8E]">{visible.length}/{paths.length}</span>
      </div>
      <ul className="max-h-[480px] space-y-px overflow-y-auto">
        {visible.map((p) => {
          const isActive = selected === p.id;
          const isMapped = mappedSet.has(p.id);
          const hasChildren = paths.some((c) => c.parent === p.id);
          const isCollapsed = collapsed.has(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect(isActive ? null : p.id)}
                aria-pressed={isActive}
                title={p.path}
                className={`flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors ${
                  isActive ? "bg-[#FAF3E3] outline outline-1 outline-[#A98450]" : "hover:bg-[#FAF8F2]"
                }`}
                style={{ paddingLeft: `${4 + p.depth * 12}px` }}
              >
                {hasChildren ? (
                  <span
                    role="button"
                    tabIndex={-1}
                    aria-label={isCollapsed ? "Expand" : "Collapse"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(p.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        toggle(p.id);
                      }
                    }}
                    className="w-3 shrink-0 cursor-pointer text-center font-mono text-[10px] text-[#A39B8E]"
                  >
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                ) : (
                  <span className="w-3 shrink-0" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#27241F]">{p.key}</span>
                {(p.kind === "scalar" || p.kind === "null") && p.example !== undefined && (
                  <span className="max-w-[38%] shrink-0 truncate font-mono text-[10px] text-[#A39B8E]" title={`Sample value: ${String(p.example)}`}>
                    = {String(p.example)}
                  </span>
                )}
                <span className={`shrink-0 font-mono text-[10px] ${KIND_BADGE[p.kind]}`}>{typeLabel(p)}</span>
                {isMapped && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2F7D4F]" title="Mapped" aria-label="Mapped" />}
              </button>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="rounded-lg border border-dashed border-[#E8E2D8] p-3 text-center text-[12px] text-[#A39B8E]">
            No source paths match.
          </li>
        )}
      </ul>
    </div>
  );
}
