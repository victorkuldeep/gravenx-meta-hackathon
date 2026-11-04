"use client";

import { useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { parseJsonInput, formatBytes, samplePair, COMPARE_KEY_PRESETS, detectArrayMatchKey } from "@/lib/json/studio";
import { compareDocuments, type FindingCategory } from "@/lib/json/compare";
import { LaserButton, LaserOverlay, useLaser } from "./LaserOverlay";
import { CATEGORY_META, CompareSummary, DiffTable, EngineeringTable } from "./CompareFindings";
import { CompareGraph } from "./CompareGraph";
import Button from "../ui/Button";

const VirtualizedDiffViewer = dynamic(
  () => import("virtual-react-json-diff").then((m) => m.VirtualDiffViewer),
  { ssr: false, loading: () => <p className="p-6 text-sm text-[#A39B8E]">Loading diff engine…</p> }
);

type ViewerRef = {
  nextChange: () => unknown;
  previousChange: () => unknown;
  expandAll: () => void;
  collapseAll: () => void;
};

/** A/B comparator: paste two payloads, walk every delta node by node. */
export function JsonCompare() {
  const [aText, setAText] = useState("");
  const [bText, setBText] = useState("");
  const [aErr, setAErr] = useState<string | null>(null);
  const [bErr, setBErr] = useState<string | null>(null);
  const [pair, setPair] = useState<{ a: object; b: object } | null>(null);
  const [blocks, setBlocks] = useState<number | null>(null);
  const [compareKey, setCompareKey] = useState<string>("");
  const [strategy, setStrategy] = useState<"strict" | "loose" | "type-aware">("strict");
  const [ignorePaths, setIgnorePaths] = useState("");
  const [current, setCurrent] = useState(0);
  const [laser, setLaser] = useState(false);
  const laserHostRef = useRef<HTMLDivElement>(null);
  useLaser(laser, setLaser);
  const [inputsOpen, setInputsOpen] = useState(true);
  const [resultView, setResultView] = useState<"side" | "summary" | "tree" | "graph" | "engineering">("side");
  const [engStyle, setEngStyle] = useState<"tabular" | "detailed">("detailed");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState<Set<FindingCategory> | null>(null);
  const viewerRef = useRef<ViewerRef | null>(null);

  const compare = () => {
    const ra = parseJsonInput(aText);
    const rb = parseJsonInput(bText);
    setAErr(ra.ok ? null : (ra as { ok: false; error: string }).error);
    setBErr(rb.ok ? null : (rb as { ok: false; error: string }).error);
    if (!ra.ok || !rb.ok) return;
    setPair({ a: ra.value as object, b: rb.value as object });
    setBlocks(null);
    setCurrent(0);
    setSelectedFindingId(null);
    setInputsOpen(false);
  };
  const loadSample = () => {
    const s = samplePair();
    setAText(s.a);
    setBText(s.b);
    setAErr(null);
    setBErr(null);
  };

  const sizes = useMemo(() => {
    if (!pair) return null;
    const sa = new Blob([JSON.stringify(pair.a)]).size;
    const sb = new Blob([JSON.stringify(pair.b)]).size;
    return `${formatBytes(sa)} vs ${formatBytes(sb)}`;
  }, [pair]);

  // Auto matches arrays by a natural id field when the dropdown is left
  // at its default - key mode then applies per array, and arrays without
  // the key fall through to lcs/index exactly as if no key were set.
  const effectiveCompareKey = useMemo(() => {
    if (compareKey === "") return pair ? detectArrayMatchKey(pair.a, pair.b) : "";
    if (compareKey === "index") return "";
    return compareKey;
  }, [compareKey, pair]);

  // Canonical findings: same options as the legacy viewer, so every new
  // view agrees with it by construction.
  const result = useMemo(() => {
    if (!pair) return null;
    return compareDocuments(pair.a, pair.b, {
      strategy,
      arrayMode: compareKey === "index" ? "index" : effectiveCompareKey !== "" ? "key" : "lcs",
      matchKey: effectiveCompareKey,
      ignorePaths: ignorePaths.split(",").map((s) => s.trim()).filter(Boolean),
    });
  }, [pair, strategy, compareKey, effectiveCompareKey, ignorePaths]);

  const toggleCat = (cat: FindingCategory) => {
    setCatFilter((prev) => {
      if (prev !== null && prev.has(cat)) {
        const next = new Set(prev);
        next.delete(cat);
        return next.size === 0 ? null : next;
      }
      const next = new Set(prev ?? []);
      next.add(cat);
      return next;
    });
  };

  const step = (dir: 1 | -1) => {
    const r = viewerRef.current;
    if (!r) return;
    const c = dir === 1 ? r.nextChange() : r.previousChange();
    if (c) setCurrent((n) => n + dir);
  };

  const inputCls =
    "w-full rounded-lg border border-[#E8E2D8] p-2 font-mono text-xs focus:border-[#A98450] focus:outline-none";

  return (
    <div className="space-y-4">
      {inputsOpen ? (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {(
            [
              { label: "Payload A", text: aText, set: setAText, err: aErr },
              { label: "Payload B", text: bText, set: setBText, err: bErr },
            ] as const
          ).map((side) => (
            <div key={side.label} className="rounded-xl border border-[#E8E2D8] bg-white p-3">
              <div className="mb-1.5 flex items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
                  {side.label}
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => setInputsOpen(false)}
                  aria-expanded={true}
                  title="Collapse both inputs - focus the diff"
                  className="rounded-md p-1 text-[#A39B8E] hover:bg-[#F5F1E8] hover:text-[#27241F] transition-colors cursor-pointer"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="m18 15-6-6-6 6" /></svg>
                </button>
              </div>
              <textarea
                value={side.text}
                onChange={(e) => side.set(e.target.value)}
                placeholder={`Paste ${side.label} JSON…`}
                rows={9}
                spellCheck={false}
                className={inputCls}
              />
              {side.err && (
                <p className="mt-1.5 rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 font-mono text-[11px] text-red-700" role="alert">
                  {side.err}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setInputsOpen(true)}
          aria-expanded={false}
          title="Expand payload inputs"
          className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-[#E8E2D8] bg-white px-3 py-2 text-left transition-colors hover:border-[#A98450]"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className="shrink-0 text-[#A39B8E]"><path d="m6 9 6 6 6-6" /></svg>
          <span className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
            Payloads A · B
          </span>
          {sizes && <span className="font-mono text-[11px] text-[#A39B8E]">{sizes}</span>}
          <span className="ml-auto text-[11px] text-[#A98450]">Expand to edit</span>
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E8E2D8] bg-white px-3 py-2.5">
        <Button size="sm" onClick={compare} disabled={aText.trim() === "" || bText.trim() === ""}>
          Compare A → B
        </Button>
        <Button variant="ghost" size="sm" onClick={loadSample}>
          Load sample
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setAText(bText);
            setBText(aText);
            setPair(null);
          }}
          title="Swap A and B"
        >
          ⇄ Swap
        </Button>
        <span className="mx-1 hidden h-5 w-px bg-[#E8E2D8] sm:inline-block" aria-hidden="true" />
        <label className="flex items-center gap-1.5 text-[11px] text-[#777168]">
          Match arrays by
          <select
            value={compareKey}
            onChange={(e) => setCompareKey(e.target.value)}
            className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-1.5 py-1 font-mono text-[11px]"
            title="Auto finds a natural id field per payload; pick one to force it, or index for pure positional matching"
          >
            <option value="">Auto{effectiveCompareKey ? ` (${effectiveCompareKey})` : ""}</option>
            <option value="index">index</option>
            {COMPARE_KEY_PRESETS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-[#777168]">
          Compare
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as typeof strategy)}
            className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-1.5 py-1 text-[11px]"
          >
            <option value="strict">strict</option>
            <option value="loose">loose</option>
            <option value="type-aware">type-aware</option>
          </select>
        </label>
        <input
          value={ignorePaths}
          onChange={(e) => setIgnorePaths(e.target.value)}
          placeholder="Ignore paths, comma-separated"
          spellCheck={false}
          aria-label="Ignore paths"
          className="min-w-[180px] flex-1 rounded-lg border border-[#E8E2D8] px-2 py-1 font-mono text-[11px] focus:border-[#A98450] focus:outline-none sm:max-w-[260px]"
        />
        {pair && (
          <>
            <span className="mx-1 hidden h-5 w-px bg-[#E8E2D8] sm:inline-block" aria-hidden="true" />
            {resultView === "side" && (
              <>
                <Button variant="ghost" size="sm" onClick={() => step(-1)}>← Prev</Button>
                <Button variant="ghost" size="sm" onClick={() => step(1)}>Next →</Button>
                <Button variant="ghost" size="sm" onClick={() => viewerRef.current?.expandAll()}>Expand all</Button>
                <Button variant="ghost" size="sm" onClick={() => viewerRef.current?.collapseAll()}>Collapse all</Button>
              </>
            )}
            <LaserButton active={laser} onToggle={() => setLaser((v) => !v)} />
          </>
        )}
      </div>

      {!pair ? (
        <div className="rounded-xl border border-[#E8E2D8] bg-[#FBF8F1] px-6 py-10">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 sm:flex-row sm:gap-8">
          <svg width="360" height="168" viewBox="0 0 360 168" fill="none" aria-hidden="true" className="h-auto w-full max-w-[360px] shrink-0 sm:max-w-[300px]">
            <ellipse cx="180" cy="84" rx="150" ry="66" stroke="#E3D9C6" strokeWidth="1.5" strokeDasharray="5 6" />
            <rect x="52" y="34" width="92" height="100" rx="12" fill="#FFFFFF" stroke="#9A7653" strokeWidth="1.5" />
            <rect x="216" y="34" width="92" height="100" rx="12" fill="#FFFFFF" stroke="#9A7653" strokeWidth="1.5" />
            <line x1="66" y1="58" x2="130" y2="58" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
            <line x1="66" y1="74" x2="130" y2="74" stroke="#C9A86A" strokeWidth="4" strokeLinecap="round" />
            <line x1="66" y1="90" x2="112" y2="90" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
            <line x1="66" y1="106" x2="122" y2="106" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
            <line x1="230" y1="58" x2="294" y2="58" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
            <line x1="230" y1="74" x2="294" y2="74" stroke="#7A5C3A" strokeWidth="4" strokeLinecap="round" />
            <line x1="230" y1="90" x2="276" y2="90" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
            <line x1="230" y1="106" x2="286" y2="106" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
            <circle cx="180" cy="84" r="20" fill="#211F1B" />
            <text x="180" y="91" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="18" fontWeight="700" fill="#F5F1E8">{"\u2260"}</text>
            <text x="98" y="28" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fontWeight="700" fill="#A39B8E">A</text>
            <text x="262" y="28" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="11" fontWeight="700" fill="#A39B8E">B</text>
          </svg>
          <div className="text-center sm:text-left">
            <p className="text-base font-bold text-[#27241F]">Nothing compared yet</p>
            <p className="mt-1 max-w-md text-[13px] text-[#777168]">
              Paste two payloads above - or load the sample composite batch - and walk every delta node by node.
            </p>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
              Side by side · Unified · Findings
            </p>
          </div>
          </div>
        </div>
      ) : (
        <>
          <p className="font-mono text-[11px] text-[#A39B8E]">
            {sizes}{blocks !== null && resultView === "side" ? ` · ${blocks} changed lines` : ""}{current > 0 && resultView === "side" ? ` · at change ${current}` : ""}
            {result && resultView !== "side" ? ` · ${result.findings.length} findings` : ""}
          </p>

          {/* Result views - one canonical findings model underneath */}
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Comparison result views">
            {(
              [
                ["side", "Side-by-side"],
                ["summary", "Summary"],
                ["tree", "Table Diff"],
                ["graph", "Graph Diff"],
                ["engineering", "Engineering"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                role="tab"
                aria-selected={resultView === v}
                onClick={() => setResultView(v)}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                  resultView === v
                    ? "border-[#211F1B] bg-[#211F1B] text-white"
                    : "border-[#E8E2D8] bg-white text-[#777168] hover:text-[#27241F]"
                }`}
              >
                {label}
              </button>
            ))}
            {catFilter !== null && (
              <button
                onClick={() => setCatFilter(null)}
                className="rounded-lg border border-[#D8C7A9] bg-[#F5F1E8] px-2.5 py-1.5 text-[11px] font-semibold text-[#A98450] hover:text-[#27241F] cursor-pointer"
                title="Clear category filter"
              >
                Filter: {[...catFilter].join(", ")} ✕
              </button>
            )}
          </div>

          {/* Laser covers every result view - side-by-side, summary, table, graph, engineering */}
          <div ref={laserHostRef} className="relative">
          {resultView === "side" && pair && (
          <div className="overflow-hidden rounded-xl border border-[#E8E2D8]">
            <VirtualizedDiffViewer
              ref={viewerRef as never}
              oldValue={pair.a}
              newValue={pair.b}
              height={600}
              leftTitle="Payload A"
              rightTitle="Payload B"
              theme="github-light"
              showLineCount
              differOptions={{
                ...(compareKey !== "" ? { compareKey } : {}),
                arrayDiffMethod: "lcs",
                detectCircular: false,
                showModifications: true,
              }}
              comparisonOptions={{
                compareStrategy: strategy,
                ignorePaths: ignorePaths.split(",").map((s) => s.trim()).filter(Boolean),
              }}
              getDiffData={(d: [unknown[], unknown[]]) => setBlocks(d[0].length + d[1].length)}
            />
          </div>
          )}

          {result && resultView === "summary" && (
            <CompareSummary
              result={result}
              onFilterCategory={(cat) => {
                setCatFilter(new Set([cat]));
                setResultView("engineering");
              }}
            />
          )}

          {result && resultView === "tree" && pair && (
            <DiffTable
              result={result}
              filter={catFilter}
              selectedId={selectedFindingId}
              onSelect={setSelectedFindingId}
            />
          )}

          {result && resultView === "graph" && pair && (
            <CompareGraph
              a={pair.a}
              b={pair.b}
              findings={result.findings}
              filter={catFilter}
              selectedId={selectedFindingId}
              onSelect={setSelectedFindingId}
            />
          )}

          {result && resultView === "engineering" && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5" role="tablist" aria-label="Engineering styles">
                {(
                  [
                    ["tabular", "Tabular"],
                    ["detailed", "Detailed"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={engStyle === v}
                    onClick={() => setEngStyle(v)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                      engStyle === v
                        ? "border-[#211F1B] bg-[#211F1B] text-white"
                        : "border-[#E8E2D8] bg-white text-[#777168] hover:text-[#27241F]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
                <span className="font-mono text-[11px] text-[#A39B8E]">
                  {engStyle === "tabular" ? "Node · Value in A · Value in B" : "search, sort and copy per finding"}
                </span>
              </div>
              {engStyle === "tabular" ? (
                <DiffTable
                  result={result}
                  filter={catFilter}
                  selectedId={selectedFindingId}
                  onSelect={setSelectedFindingId}
                />
              ) : (
                <EngineeringTable
                  result={result}
                  filter={catFilter}
                  selectedId={selectedFindingId}
                  onSelect={setSelectedFindingId}
                />
              )}
            </div>
          )}

          {result && resultView !== "side" && (
            <div className="flex flex-wrap gap-1.5" aria-label="Filter by change category">
              <span className="self-center font-mono text-[11px] text-[#A39B8E]">show:</span>
              {CATEGORY_META.map((c) => {
                const on = catFilter === null || catFilter.has(c.cat);
                return (
                  <button
                    key={c.cat}
                    onClick={() => toggleCat(c.cat)}
                    aria-pressed={on}
                    title={`Toggle ${c.label}`}
                    className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors cursor-pointer ${
                      on ? "border-[#E8E2D8] bg-white" : "border-[#E8E2D8] bg-[#F5F1E8] opacity-50"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} aria-hidden="true" />
                    <span className={on ? "text-[#27241F]" : "text-[#A39B8E]"}>{c.label}</span>
                  </button>
                );
              })}
              {catFilter !== null && (
                <button onClick={() => setCatFilter(null)} className="text-[11px] text-[#A98450] hover:underline cursor-pointer">
                  all
                </button>
              )}
            </div>
          )}
            <LaserOverlay active={laser} hostRef={laserHostRef} />
          </div>
        </>
      )}
    </div>
  );
}
