"use client";

import { useMemo, useState } from "react";
import { Check, Copy, FileSpreadsheet } from "lucide-react";
import type { CompareResult, Finding, FindingCategory } from "@/lib/json/compare";
import type { ChangeTone } from "@/lib/json/graph";
import { buildExcelWorkbook, downloadExcelWorkbook } from "@/lib/excel/workbook";
import { diffTableTsv } from "@/lib/json/studio";

export const CATEGORY_META: { cat: FindingCategory; label: string; dot: string; text: string }[] = [
  { cat: "added", label: "Added", dot: "bg-[#32815B]", text: "text-[#32815B]" },
  { cat: "removed", label: "Removed", dot: "bg-[#B84C42]", text: "text-[#B84C42]" },
  { cat: "modified", label: "Modified", dot: "bg-[#B98335]", text: "text-[#B98335]" },
  { cat: "type-changed", label: "Type changed", dot: "bg-[#7A5C9E]", text: "text-[#7A5C9E]" },
  { cat: "array-added", label: "Array added", dot: "bg-[#32815B]", text: "text-[#32815B]" },
  { cat: "array-removed", label: "Array removed", dot: "bg-[#B84C42]", text: "text-[#B84C42]" },
  { cat: "array-modified", label: "Array modified", dot: "bg-[#B98335]", text: "text-[#B98335]" },
  { cat: "unmatched", label: "Unmatched", dot: "bg-[#B98335]", text: "text-[#B98335]" },
  { cat: "duplicate-key", label: "Duplicate key", dot: "bg-[#B84C42]", text: "text-[#B84C42]" },
  { cat: "structural", label: "Structural", dot: "bg-[#A39B8E]", text: "text-[#777168]" },
];

const TONE_PRIORITY: Record<FindingCategory, number> = {
  removed: 0,
  "duplicate-key": 1,
  "type-changed": 2,
  modified: 3,
  "array-modified": 4,
  unmatched: 5,
  "array-added": 6,
  "array-removed": 6,
  added: 7,
  structural: 8,
};

const CATEGORY_TONE: Record<FindingCategory, ChangeTone> = {
  added: "added",
  removed: "removed",
  modified: "modified",
  "type-changed": "type",
  "array-added": "added",
  "array-removed": "removed",
  "array-modified": "modified",
  unmatched: "modified",
  "duplicate-key": "removed",
  structural: "neutral",
};

/** Node tones for one side of a dual graph (A uses pathA, B uses pathB). */
export function tonesForSide(findings: Finding[], side: "a" | "b"): Map<string, ChangeTone> {
  const sorted = [...findings].sort(
    (x, y) => TONE_PRIORITY[x.category] - TONE_PRIORITY[y.category]
  );
  const out = new Map<string, ChangeTone>();
  for (const f of sorted) {
    const p = side === "a" ? f.pathA : f.pathB;
    if (p === null || out.has(p)) continue;
    out.set(p, CATEGORY_TONE[f.category]);
  }
  return out;
}

export function formatValue(v: unknown, max = 80): string {
  if (v === undefined) return "— missing —";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function displayPath(f: Finding): string {
  return f.pathA ?? f.pathB ?? "$";
}

// ── Summary ─────────────────────────────────────────────────────────────────

export function CompareSummary({
  result,
  onFilterCategory,
}: {
  result: CompareResult;
  onFilterCategory: (cat: FindingCategory) => void;
}) {
  const total = result.findings.length;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {CATEGORY_META.filter((c) =>
          ["added", "removed", "modified", "type-changed", "structural"].includes(c.cat)
        ).map((c) => {
          const n =
            c.cat === "modified"
              ? result.counts.modified + result.counts["array-modified"]
              : c.cat === "added"
                ? result.counts.added + result.counts["array-added"]
                : c.cat === "removed"
                  ? result.counts.removed + result.counts["array-removed"]
                  : result.counts[c.cat];
          return (
            <button
              key={c.cat}
              onClick={() => onFilterCategory(c.cat)}
              title={`Show ${c.label} findings`}
              className="rounded-xl border border-[#E8E2D8] bg-white px-3 py-2.5 text-left transition-colors hover:border-[#A98450] cursor-pointer"
            >
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#777168]">
                <span className={`h-2 w-2 rounded-full ${c.dot}`} aria-hidden="true" />
                {c.label}
              </span>
              <span className="mt-0.5 block font-mono text-xl font-extrabold text-[#27241F]">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-2.5 font-mono text-[11px] text-[#777168]">
        strategy {result.config.strategy} · arrays {result.config.arrayMode}
        {result.config.matchKey !== "" ? ` by ${result.config.matchKey}` : ""} ·
        ignored {result.config.ignorePaths.length === 0 ? "none" : result.config.ignorePaths.join(", ")} ·
        {" "}{total} finding{total === 1 ? "" : "s"}
      </div>
      {result.warnings.length > 0 && (
        <div className="space-y-1">
          {result.warnings.map((w, k) => (
            <p key={k} className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Diff table: the ultra-clean Node | Value in A | Value in B grid ─────────

/**
 * Only value-bearing findings belong in the table. Wrapper rows
 * (array-modified - details follow) and valueless rows (structural moves,
 * duplicate keys) stay out so the grid reads one change per line.
 */
const TABLE_CATEGORIES: FindingCategory[] = [
  "added",
  "removed",
  "modified",
  "type-changed",
  "array-added",
  "array-removed",
  "unmatched",
];

/** Full-fidelity cell text for export (never truncated). */
function tableCellFull(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (typeof v === "string") return v;
  return JSON.stringify(v) ?? "null";
}

async function downloadDiffTableXlsx(rows: Finding[]): Promise<void> {
  const wb = await buildExcelWorkbook([
    {
      name: "Diff",
      header: ["Node", "Value in A", "Value in B"],
      rows: rows.map((f) => [displayPath(f), tableCellFull(f.oldValue), tableCellFull(f.newValue)]),
      widths: [64, 48, 48],
    },
  ]);
  await downloadExcelWorkbook(wb, "json-compare-diff.xlsx");
}

/** Cell text: primitives raw, absent side as null, containers compact. */
function tableCell(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (typeof v === "string") return v;
  const s = JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

export function DiffTable({
  result,
  filter,
  selectedId,
  onSelect,
}: {
  result: CompareResult;
  filter: Set<FindingCategory> | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const rows = useMemo(() => {
    const list =
      filter === null ? [...result.findings] : result.findings.filter((f) => filter.has(f.category));
    return list
      .filter((f) => TABLE_CATEGORIES.includes(f.category))
      .sort((a, b) => (displayPath(a) < displayPath(b) ? -1 : 1));
  }, [result, filter]);

  const [copied, setCopied] = useState<string | null>(null);

  const copyExcel = async () => {
    try {
      await navigator.clipboard.writeText(diffTableTsv(rows));
      setCopied("excel");
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[#E8E2D8] bg-white">
      <div className="flex items-center gap-1 border-b border-[#E8E2D8] px-2.5 py-1.5">
        <span className="font-mono text-[11px] text-[#A39B8E]">
          {rows.length === 0 ? "no changes" : `${rows.length} change${rows.length === 1 ? "" : "s"}`}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void copyExcel()}
          title="Copy as Excel - tab-separated, pastes straight into a spreadsheet"
          aria-label="Copy table as Excel"
          className="rounded-md border border-[#E8E2D8] p-1.5 text-[#777168] transition-colors hover:border-[#A98450] hover:text-[#27241F] cursor-pointer"
        >
          {copied === "excel" ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => void downloadDiffTableXlsx(rows)}
          title="Download as Excel (.xlsx)"
          aria-label="Download table as Excel"
          className="rounded-md border border-[#E8E2D8] p-1.5 text-[#777168] transition-colors hover:border-[#A98450] hover:text-[#27241F] cursor-pointer"
        >
          <FileSpreadsheet size={13} aria-hidden="true" />
        </button>
      </div>
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-[#E8E2D8] bg-[#F8F6F0] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#A39B8E]">
        <span>Node</span>
        <span>Value in A</span>
        <span>Value in B</span>
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {rows.length === 0 && (
          <p className="px-4 py-8 text-center text-[13px] text-[#A39B8E]">
            {result.findings.length === 0 ? "No differences - documents match." : "No findings match."}
          </p>
        )}
        {rows.map((f) => {
          const meta = CATEGORY_META.find((c) => c.cat === f.category);
          const isSel = f.id === selectedId;
          return (
            <button
              key={f.id}
              onClick={() => onSelect(isSel ? null : f.id)}
              title={f.explanation}
              className={`grid w-full cursor-pointer grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] items-start gap-2 border-b border-[#E8E2D8] px-3 py-1.5 text-left transition-colors last:border-b-0 ${
                isSel ? "bg-[#211F1B] text-white" : "hover:bg-[#F5F1E8]"
              }`}
            >
              <span className={`flex min-w-0 items-center gap-1.5 font-mono text-[11px] ${isSel ? "text-white" : "text-[#27241F]"}`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${meta?.dot ?? ""}`} aria-hidden="true" />
                <span className="truncate" title={displayPath(f)}>{displayPath(f)}</span>
              </span>
              <span className={`min-w-0 truncate font-mono text-[11px] ${isSel ? "text-white/80" : "text-[#777168]"}`} title={tableCell(f.oldValue)}>
                {tableCell(f.oldValue)}
              </span>
              <span className={`min-w-0 truncate font-mono text-[11px] ${isSel ? "text-white/80" : "text-[#27241F]"}`} title={tableCell(f.newValue)}>
                {tableCell(f.newValue)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Engineering table ───────────────────────────────────────────────────────

export function EngineeringTable({
  result,
  filter,
  selectedId,
  onSelect,
}: {
  result: CompareResult;
  filter: Set<FindingCategory> | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"path" | "category" | "depth">("path");

  const depthOf = (f: Finding): number => (displayPath(f).match(/[.\[]/g) ?? []).length;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list =
      filter === null ? [...result.findings] : result.findings.filter((f) => filter.has(f.category));
    if (q !== "") {
      list = list.filter(
        (f) =>
          displayPath(f).toLowerCase().includes(q) ||
          f.explanation.toLowerCase().includes(q) ||
          (f.matchKey ?? "").toLowerCase().includes(q) ||
          JSON.stringify(f.newValue ?? f.oldValue ?? "").toLowerCase().includes(q)
      );
    }
    list.sort((a, b) => {
      if (sort === "category") return a.category < b.category ? -1 : 1;
      if (sort === "depth") return depthOf(a) - depthOf(b) || (displayPath(a) < displayPath(b) ? -1 : 1);
      return displayPath(a) < displayPath(b) ? -1 : 1;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, filter, search, sort]);

  const selected = result.findings.find((f) => f.id === selectedId) ?? null;

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[#E8E2D8] bg-white px-3 py-2">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className="shrink-0 text-[#A39B8E]">
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search paths, values, explanations…"
          aria-label="Search findings"
          spellCheck={false}
          className="min-w-[160px] flex-1 rounded-md border border-[#E8E2D8] px-2 py-1 font-mono text-[12px] focus:border-[#A98450] focus:outline-none"
        />
        <button
          onClick={() => setSort(sort === "path" ? "category" : sort === "category" ? "depth" : "path")}
          title="Toggle sort"
          className="rounded-md border border-[#E8E2D8] px-2 py-1 font-mono text-[11px] text-[#777168] hover:text-[#27241F] cursor-pointer"
        >
          sort: {sort}
        </button>
        <span className="font-mono text-[11px] text-[#A39B8E]">{rows.length}/{result.findings.length}</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#E8E2D8] bg-white">
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[120px_minmax(0,1.5fr)_52px_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-[#E8E2D8] bg-[#F8F6F0] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-[#A39B8E]">
              <span>Change</span>
              <span>Node</span>
              <span>Depth</span>
              <span>Value in A</span>
              <span>Value in B</span>
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {rows.length === 0 && (
                <p className="px-4 py-8 text-center text-[13px] text-[#A39B8E]">
                  {result.findings.length === 0 ? "No differences - documents match." : "No findings match."}
                </p>
              )}
              {rows.map((f) => {
                const meta = CATEGORY_META.find((c) => c.cat === f.category);
                const isSel = f.id === selectedId;
                const diverged = f.pathA !== null && f.pathB !== null && f.pathA !== f.pathB;
                return (
                  <button
                    key={f.id}
                    onClick={() => onSelect(isSel ? null : f.id)}
                    className={`grid w-full cursor-pointer grid-cols-[120px_minmax(0,1.5fr)_52px_minmax(0,1fr)_minmax(0,1fr)] items-start gap-2 border-b border-[#E8E2D8] px-3 py-2 text-left transition-colors last:border-b-0 ${
                      isSel ? "bg-[#211F1B] text-white" : "hover:bg-[#F5F1E8]"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${meta?.dot ?? ""}`} aria-hidden="true" />
                      <span className={isSel ? "text-white" : meta?.text ?? ""}>{meta?.label}</span>
                    </span>
                    <span className="min-w-0">
                      <span className={`block truncate font-mono text-[11px] ${isSel ? "text-white" : "text-[#27241F]"}`} title={displayPath(f)}>
                        {displayPath(f)}
                      </span>
                      {diverged && (
                        <span className={`block truncate font-mono text-[10px] ${isSel ? "text-white/60" : "text-[#A39B8E]"}`} title={f.pathB ?? ""}>
                          in B: {f.pathB}
                        </span>
                      )}
                    </span>
                    <span className={`font-mono text-[11px] ${isSel ? "text-white/70" : "text-[#A39B8E]"}`}>{depthOf(f)}</span>
                    <span className={`min-w-0 truncate font-mono text-[11px] ${isSel ? "text-white/70" : "text-[#777168]"}`} title={formatValue(f.oldValue, 200)}>
                      {f.oldValue !== undefined ? formatValue(f.oldValue, 44) : "null"}
                    </span>
                    <span className={`min-w-0 truncate font-mono text-[11px] ${isSel ? "text-white/80" : "text-[#27241F]"}`} title={formatValue(f.newValue, 200)}>
                      {f.newValue !== undefined ? formatValue(f.newValue, 44) : "null"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {selected && (
        <div className="rounded-xl border border-[#D8C7A9] bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px] font-bold text-[#27241F]">{displayPath(selected)}</span>
            <span className="flex-1" />
            <button onClick={() => void copyText(displayPath(selected))} className="rounded-md border border-[#E8E2D8] px-2 py-1 text-[11px] hover:border-[#A98450] cursor-pointer">Copy path</button>
            {selected.oldValue !== undefined && (
              <button onClick={() => void copyText(JSON.stringify(selected.oldValue, null, 2) ?? "")} className="rounded-md border border-[#E8E2D8] px-2 py-1 text-[11px] hover:border-[#A98450] cursor-pointer">Copy A</button>
            )}
            {selected.newValue !== undefined && (
              <button onClick={() => void copyText(JSON.stringify(selected.newValue, null, 2) ?? "")} className="rounded-md border border-[#E8E2D8] px-2 py-1 text-[11px] hover:border-[#A98450] cursor-pointer">Copy B</button>
            )}
          </div>
          <p className="mt-1.5 text-[13px] text-[#27241F]">{selected.explanation}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-[#A39B8E]">
            <span>depth {depthOf(selected)}</span>
            <span>type {selected.oldType ?? "missing"} -&gt; {selected.newType ?? "missing"}</span>
            {selected.matchKey && <span>match {selected.matchKey} · {selected.matchStatus}</span>}
          </div>
          {selected.pathA !== null && selected.pathB !== null && selected.pathA !== selected.pathB && (
            <div className="mt-2 grid gap-2 font-mono text-[11px] sm:grid-cols-2">
              <p className="truncate rounded-lg bg-[#F8F6F0] px-2 py-1 text-[#777168]" title={selected.pathA}>A: {selected.pathA}</p>
              <p className="truncate rounded-lg bg-[#F8F6F0] px-2 py-1 text-[#27241F]" title={selected.pathB}>B: {selected.pathB}</p>
            </div>
          )}
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-[#F8F6F0] p-2">
              <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#A39B8E]">
                A {selected.oldType ? `· ${selected.oldType}` : "· missing"}
              </p>
              <pre className="mt-1 max-h-40 overflow-auto font-mono text-[11px] text-[#27241F]">
                {selected.oldValue === undefined ? "— missing —" : JSON.stringify(selected.oldValue, null, 2)}
              </pre>
            </div>
            <div className="rounded-lg bg-[#F8F6F0] p-2">
              <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#A39B8E]">
                B {selected.newType ? `· ${selected.newType}` : "· missing"}
              </p>
              <pre className="mt-1 max-h-40 overflow-auto font-mono text-[11px] text-[#27241F]">
                {selected.newValue === undefined ? "— missing —" : JSON.stringify(selected.newValue, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
