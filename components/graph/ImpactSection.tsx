"use client";

import { useState } from "react";
import { loadGraphIndex } from "@/lib/graph/load";
import { summarizeForNode, summarizeImpact, whereUsedEither, type ImpactSummary } from "@/lib/graph/impact";
import { downloadImpactAnalysis } from "@/lib/graph/impactExcel";
import type { GraphSurface, WhereUsedRef } from "@/lib/graph/index";

/**
 * Expand-on-demand impact panel shared by every inspector. Loads the
 * architecture graph only when the architect asks, then lists everything
 * pointing at the target, grouped by surface - each hit citing its edge.
 */

export type ImpactQuery = WhereUsedRef | { surface: GraphSurface; text: string };

export function ImpactSection({ query, caption }: { query: ImpactQuery; caption: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ImpactSummary | null>(null);
  const [xlsBusy, setXlsBusy] = useState(false);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (summary) return;
    setLoading(true);
    try {
      const index = await loadGraphIndex();
      if ("text" in query) {
        const found = whereUsedEither(index, query.surface, query.text);
        setSummary(
          found.node
            ? summarizeForNode(index, found.node)
            : summarizeImpact(index, { surface: query.surface, name: query.text }),
        );
      } else {
        setSummary(summarizeImpact(index, query));
      }
    } catch {
      setSummary({ target: null, groups: [], total: 0, dangling: [] });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)]">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-expanded={open}
        title={`What breaks if ${caption} changes?`}
        className="flex w-full cursor-pointer items-center gap-1.5 px-2 py-1.5 text-left text-[11px] font-semibold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className={`transition-transform ${open ? "rotate-90" : ""}`}>
          <path d="m9 6 6 6-6 6" />
        </svg>
        Impact
        {summary && (
          <span className="font-mono font-normal text-[var(--color-muted)]">
            · {summary.total} ref{summary.total === 1 ? "" : "s"}
            {summary.dangling.length > 0 && ` · ${summary.dangling.length} dangling`}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-[var(--color-line-soft)] px-2 py-1.5">
          {loading && <p className="text-[11px] text-[var(--color-muted)]">Reading the architecture…</p>}
          {!loading && summary && (summary.groups.length > 0 || summary.dangling.length > 0) && (
            <div className="flex justify-end">
              <button
                type="button"
                disabled={xlsBusy}
                onClick={() => {
                  setXlsBusy(true);
                  const safe = caption.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "record";
                  void downloadImpactAnalysis(summary, `impact-${safe}.xlsx`).finally(() => setXlsBusy(false));
                }}
                title="Download this impact analysis as .xlsx"
                className="cursor-pointer rounded px-1 py-0.5 font-mono text-[10px] text-bronze-700 underline decoration-bronze-300 underline-offset-2 hover:text-bronze-800 disabled:opacity-50"
              >
                {xlsBusy ? "Building…" : "Excel (.xlsx)"}
              </button>
            </div>
          )}
          {!loading && summary && summary.groups.length === 0 && summary.dangling.length === 0 && (
            <p className="text-[11px] text-[var(--color-muted)]">No references yet across the studio.</p>
          )}
          {!loading && summary && summary.target === null && summary.dangling.length > 0 && (
            <p className="text-[11px] font-semibold text-[#8A6A2F]">
              This record is gone — {summary.dangling.length} reference{summary.dangling.length === 1 ? "" : "s"} still name{summary.dangling.length === 1 ? "s" : ""} it.
            </p>
          )}
          {!loading &&
            summary &&
            summary.groups.map((g) => (
              <div key={g.surface} className="mt-1.5 first:mt-0">
                <p className="font-mono text-[9px] uppercase tracking-[1.6px] text-[var(--color-muted)]">
                  {g.label} · {g.hits.length}
                </p>
                <ul className="mt-0.5 space-y-0.5">
                  {g.hits.map((h) => (
                    <li key={`${h.via.kind}-${h.node.key}`}>
                      <a
                        href={g.href}
                        title={`Open in ${g.label} tab`}
                        className="block truncate rounded px-1 py-0.5 text-[11px] text-[var(--color-ink-soft)] hover:bg-white hover:text-[var(--color-ink)] hover:underline"
                      >
                        {h.node.name}
                        <span className="ml-1 font-mono text-[9px] text-[var(--color-muted)]">
                          {h.via.kind}
                          {h.via.resolution !== "id" && ` · ${h.via.resolution}`}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          {!loading && summary && summary.dangling.length > 0 && summary.target !== null && (
            <p className="mt-1.5 text-[10px] leading-snug text-[#8A6A2F]">
              {summary.dangling.length} dangling reference{summary.dangling.length === 1 ? "" : "s"} also name{summary.dangling.length === 1 ? "s" : ""} this record:{" "}
              {summary.dangling.slice(0, 3).map((u) => u.name ?? u.raw).join(" · ")}
              {summary.dangling.length > 3 && " …"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
