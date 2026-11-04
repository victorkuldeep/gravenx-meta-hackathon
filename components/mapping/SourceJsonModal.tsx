"use client";

import { useEffect, useMemo, useState } from "react";
import { renderJsonLines } from "@/lib/mapping/jsonView";
import { diffSourceCatalog, extractPaths, parseSourceJson } from "@/lib/mapping/source";

/**
 * Wide source-JSON viewer: the full sample (or OpenAPI-derived) payload
 * behind a mapping graph's source node. Read-only Copy + Close, plus an
 * optional Edit & Replace tab: tweak the JSON mid-mapping, preview the
 * path diff (added / removed / orphaned mapping rows), then apply.
 * Applying rebuilds the path catalog; mappings are keyed by sourcePath
 * so rows pointing at removed paths are kept as-is, never deleted.
 */
export function SourceJsonModal({
  name,
  origin,
  text,
  pathIds,
  mappingPaths,
  onApplySource,
  onClose,
}: {
  name: string;
  origin: string | null;
  text: string;
  /** Current catalog ids - the diff baseline. Defaults to []. */
  pathIds?: string[];
  /** Distinct sourcePaths used by mapping rows - for orphan preview. */
  mappingPaths?: string[];
  /** When provided, the Edit & Replace tab appears. */
  onApplySource?: ((text: string) => void) | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState(text);
  const canEdit = typeof onApplySource === "function";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A fresh source (after apply + reopen) resets the editor.
  useEffect(() => {
    setDraft(text);
  }, [text]);

  const { lines, truncated, invalid } = useMemo(() => {
    try {
      const parsed = JSON.parse(text) as unknown;
      const r = renderJsonLines(parsed);
      return { lines: r.lines, truncated: r.truncated, invalid: false };
    } catch {
      return { lines: [], truncated: false, invalid: true };
    }
  }, [text]);

  const analysis = useMemo(() => {
    if (!canEdit) return null;
    const before = pathIds ?? [];
    const used = mappingPaths ?? [];
    const parsed = parseSourceJson(draft);
    if (!parsed.ok) return { ok: false as const, error: parsed.error ?? "Invalid JSON." };
    const nextIds = extractPaths(parsed.value).map((p) => p.id);
    const diff = diffSourceCatalog(before, nextIds);
    const removedSet = new Set(diff.removed);
    return {
      ok: true as const,
      pathCount: nextIds.length,
      added: diff.added,
      removed: diff.removed,
      orphanedMappings: used.filter((p) => removedSet.has(p)),
    };
  }, [canEdit, draft, pathIds, mappingPaths]);

  const changed = draft !== text;
  const canApply = canEdit && changed && analysis?.ok === true;
  const apply = () => {
    if (!canApply || !onApplySource) return;
    onApplySource(draft);
  };

  const tabCls = (active: boolean) =>
    `rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
      active ? "bg-[#211F1B] text-white" : "text-[#777168] hover:text-[#27241F] hover:bg-[#F5F1E8]"
    }`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Source JSON - ${name}`}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-3 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_32px_96px_-16px_rgba(24,20,12,0.5)]">
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-bronze-300 bg-bronze-100 font-mono text-[13px] font-bold text-bronze-700" aria-hidden="true">
            {"{}"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-bold text-ivory-950" title={name}>
              {name}
            </p>
            <p className="truncate font-mono text-[10px] text-ivory-500">
              {origin ? `derived from ${origin}` : "pasted sample JSON"} · {lines.length} lines{truncated ? " (truncated)" : ""}
            </p>
          </div>
          {canEdit && (
            <div className="flex shrink-0 items-center gap-1 rounded-lg border border-[var(--color-line)] bg-white p-0.5" role="tablist" aria-label="Source panels">
              <button type="button" role="tab" aria-selected={tab === "view"} onClick={() => setTab("view")} className={tabCls(tab === "view")}>
                View
              </button>
              <button type="button" role="tab" aria-selected={tab === "edit"} onClick={() => setTab("edit")} className={tabCls(tab === "edit")}>
                Edit &amp; Replace{changed ? " ·•" : ""}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              void (async () => {
                try {
                  await navigator.clipboard.writeText(tab === "edit" ? draft : text);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* clipboard unavailable */
                }
              })();
            }}
            title="Copy JSON"
            className="shrink-0 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-ivory-700 hover:border-bronze-400 hover:text-ivory-950 transition-colors cursor-pointer"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source viewer"
            title="Close (Esc)"
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-ivory-500 hover:text-ivory-950 hover:bg-ivory-200 transition-colors cursor-pointer"
          >
            ✕ Close
          </button>
        </div>
        {tab === "view" || !canEdit ? (
          <div className="min-h-0 flex-1 overflow-auto bg-white p-4">
            {invalid ? (
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-ivory-950">{text}</pre>
            ) : (
              <pre className="font-mono text-[11px] leading-relaxed" aria-label="Source JSON">
                {lines.map((l, i) => {
                  const m = /^(\s*)("[^"]*": )?([\s\S]*)$/.exec(l.text);
                  return (
                    <div key={i} className="whitespace-pre-wrap break-all">
                      {m ? (
                        <>
                          {m[1]}
                          {m[2] && <span className="text-[#722F37]">{m[2]}</span>}
                          <span className="text-[#4E342E]">{m[3]}</span>
                        </>
                      ) : (
                        l.text
                      )}
                    </div>
                  );
                })}
              </pre>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col bg-white">
            <div className="min-h-0 flex-1 overflow-auto p-4">
              <label className="block text-[12px] font-semibold text-[#27241F]">
                Revised source JSON
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  rows={14}
                  className="mt-1.5 min-h-[220px] w-full rounded-lg border border-[#E8E2D8] bg-[#FCFBF8] p-3 font-mono text-[11px] leading-relaxed text-[#27241F] focus:border-[#A98450] focus:outline-none"
                />
              </label>
              <div className="mt-2 font-mono text-[11px]" role="status">
                {!analysis || !analysis.ok ? (
                  <span className="text-[#B3261E]">{analysis?.error ?? "Validating…"}</span>
                ) : !changed ? (
                  <span className="text-[#777168]">No changes yet - edit the JSON to preview the impact.</span>
                ) : analysis.added.length === 0 && analysis.removed.length === 0 ? (
                  <span className="text-[#2F7D4F]">Valid · {analysis.pathCount} paths · formatting only, catalog unchanged.</span>
                ) : (
                  <span className="text-[#2F7D4F]">
                    Valid · {analysis.pathCount} paths · <span className="font-bold">+{analysis.added.length}</span> added ·{" "}
                    <span className="font-bold text-[#B3261E]">−{analysis.removed.length}</span> removed
                  </span>
                )}
              </div>
              {analysis?.ok === true && changed && (analysis.added.length > 0 || analysis.removed.length > 0) && (
                <div className="mt-2 grid max-h-44 gap-2 overflow-auto sm:grid-cols-2">
                  {analysis.added.length > 0 && (
                    <div className="rounded-lg border border-[#BFD9C6] bg-[#E9F3EC] p-2.5">
                      <p className="text-[11px] font-bold text-[#2F7D4F]">+ {analysis.added.length} new path{analysis.added.length === 1 ? "" : "s"}</p>
                      <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-[#2F7D4F]">
                        {analysis.added.slice(0, 12).map((p) => (
                          <li key={p} className="truncate" title={p}>{p}</li>
                        ))}
                        {analysis.added.length > 12 && <li>…and {analysis.added.length - 12} more</li>}
                      </ul>
                    </div>
                  )}
                  {analysis.removed.length > 0 && (
                    <div className="rounded-lg border border-[#E5B8B2] bg-[#F9E8E6] p-2.5">
                      <p className="text-[11px] font-bold text-[#B3261E]">− {analysis.removed.length} removed path{analysis.removed.length === 1 ? "" : "s"}</p>
                      <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-[#B3261E]">
                        {analysis.removed.slice(0, 12).map((p) => (
                          <li key={p} className="truncate" title={p}>{p}</li>
                        ))}
                        {analysis.removed.length > 12 && <li>…and {analysis.removed.length - 12} more</li>}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {analysis?.ok === true && changed && analysis.orphanedMappings.length > 0 && (
                <p className="mt-2 rounded-lg border border-[#DCC99A] bg-[#F5EEDF] p-2.5 text-[11px] text-[#8A6A2F]" role="alert">
                  {analysis.orphanedMappings.length} mapped row{analysis.orphanedMappings.length === 1 ? "" : "s"} reference{analysis.orphanedMappings.length === 1 ? "s" : ""} removed paths
                  ({analysis.orphanedMappings.slice(0, 4).join(", ")}
                  {analysis.orphanedMappings.length > 4 ? `, +${analysis.orphanedMappings.length - 4} more` : ""}). They stay saved as-is — remap or delete them after applying.
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-4 py-2.5">
              <button
                type="button"
                onClick={() => setDraft(text)}
                disabled={!changed}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-ivory-500 hover:text-ivory-950 transition-colors cursor-pointer disabled:opacity-40"
              >
                Revert
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={!canApply}
                title={!changed ? "Edit the JSON first" : analysis?.ok !== true ? "Fix invalid JSON first" : "Rebuild the path catalog from this JSON"}
                className="rounded-lg bg-[#211F1B] px-3 py-1.5 text-[11px] font-semibold text-white transition-colors cursor-pointer disabled:opacity-40 hover:bg-bronze-600"
              >
                Replace source
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
