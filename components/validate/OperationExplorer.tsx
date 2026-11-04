"use client";

import { useMemo, useState } from "react";
import type { Operation } from "@/lib/validate/types";

const METHOD_STYLES: Record<string, string> = {
  GET: "bg-[#E9F3EC] text-[#2F7D4F] border-[#BFD9C6]",
  POST: "bg-[#F5EEDF] text-[#8A6A2F] border-[#DCC99A]",
  PUT: "bg-[#F3EADB] text-[#9A5B13] border-[#E0C491]",
  PATCH: "bg-[#EBF0E4] text-[#5F7048] border-[#C6D2B4]",
  DELETE: "bg-[#F9E8E6] text-[#B3261E] border-[#E5B8B2]",
};

function methodStyle(method: string): string {
  return METHOD_STYLES[method] ?? "bg-[#F5F1E8] text-[#777168] border-[#E8E2D8]";
}

/** Searchable, filterable operation catalog grouped by path. */
export function OperationExplorer({
  operations,
  selectedId,
  onSelect,
}: {
  operations: Operation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [methodFilter, setMethodFilter] = useState<string | null>(null);

  const methods = useMemo(() => [...new Set(operations.map((o) => o.method))].sort(), [operations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return operations.filter((o) => {
      if (methodFilter && o.method !== methodFilter) return false;
      if (!q) return true;
      return (
        o.path.toLowerCase().includes(q) ||
        o.operationId?.toLowerCase().includes(q) ||
        o.summary?.toLowerCase().includes(q)
      );
    });
  }, [operations, query, methodFilter]);

  const groups = useMemo(() => {
    const map = new Map<string, Operation[]>();
    for (const op of filtered) {
      const list = map.get(op.path) ?? [];
      list.push(op);
      map.set(op.path, list);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2">
        <div className="relative">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search path, operationId, summary…"
            aria-label="Search operations"
            spellCheck={false}
            className="w-full rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 pr-7 text-[12px] focus:border-[#A98450] focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search - show all operations"
              title="Clear search - show all operations"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 font-mono text-[12px] text-[#A39B8E] hover:text-[#27241F] cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="Filter by HTTP method">
          {methods.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethodFilter((f) => (f === m ? null : m))}
              aria-pressed={methodFilter === m}
              className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-semibold cursor-pointer transition-colors ${
                methodFilter === m ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] bg-white text-[#777168] hover:text-[#27241F]"
              }`}
            >
              {m}
            </button>
          ))}
          {methodFilter && (
            <button
              type="button"
              onClick={() => setMethodFilter(null)}
              className="rounded-md px-2 py-0.5 font-mono text-[11px] text-[#A98450] hover:underline cursor-pointer"
            >
              all
            </button>
          )}
        </div>
      </div>

      <p className="font-mono text-[11px] text-[#A39B8E]" aria-live="polite">
        {filtered.length} of {operations.length} operations
      </p>

      <div className="max-h-[520px] space-y-3 overflow-y-auto pr-0.5">
        {groups.length === 0 && (
          <p className="rounded-lg border border-dashed border-[#E8E2D8] bg-white p-4 text-center text-[12px] text-[#A39B8E]">
            No operations match.
          </p>
        )}
        {groups.map(([path, ops]) => (
          <div key={path} className="overflow-hidden rounded-xl border border-[#E8E2D8] bg-white">
            <p className="border-b border-[#F0EBE0] bg-[#FAF8F2] px-3 py-1.5 font-mono text-[11px] font-semibold text-[#27241F] break-all">
              {path}
            </p>
            <ul>
              {ops.map((op) => {
                const active = op.id === selectedId;
                const reqCount = op.request?.contentTypes.filter((c) => c.supported).length ?? 0;
                const resCount = op.responses.flatMap((r) => r.contentTypes).filter((c) => c.supported).length;
                return (
                  <li key={op.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(op.id)}
                      aria-pressed={active}
                      className={`flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-left transition-colors ${
                        active ? "bg-[#FAF3E3]" : "hover:bg-[#FAF8F2]"
                      }`}
                    >
                      <span className={`mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold ${methodStyle(op.method)}`}>
                        {op.method}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold text-[#27241F]">
                          {op.summary ?? op.operationId ?? op.id}
                        </span>
                        {op.operationId && op.summary && (
                          <span className="block truncate font-mono text-[10px] text-[#A39B8E]">{op.operationId}</span>
                        )}
                        <span className="mt-0.5 block font-mono text-[10px] text-[#A39B8E]">
                          {reqCount > 0 ? `request ✓` : `no request`} · {resCount > 0 ? `${resCount} response schema${resCount > 1 ? "s" : ""}` : `no response schema`}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
