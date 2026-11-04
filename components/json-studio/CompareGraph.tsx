"use client";

import { useMemo } from "react";
import { buildDocument, type JsonDocument } from "@/lib/json/document";
import type { Finding, FindingCategory } from "@/lib/json/compare";
import type { ChangeTone } from "@/lib/json/graph";
import { JsonGraph } from "./JsonGraph";
import { tonesForSide } from "./CompareFindings";

function includeSet(doc: JsonDocument, ids: Iterable<string>): Set<string> {
  const keep = new Set<string>();
  for (const id of ids) {
    let cur: string | null = id;
    const guard = new Set<string>();
    while (cur !== null && !guard.has(cur) && doc.nodes.has(cur)) {
      guard.add(cur);
      keep.add(cur);
      cur = doc.nodes.get(cur)?.parent ?? null;
    }
  }
  return keep;
}

const LEGEND_DOT: Record<ChangeTone, string> = {
  neutral: "bg-[#A39B8E]",
  added: "bg-[#32815B]",
  removed: "bg-[#B84C42]",
  modified: "bg-[#B98335]",
  type: "bg-[#7A5C9E]",
};

/** Changed-node counts per tone so each canvas reads as a diff at a glance. */
function ToneLegend({ tones, total }: { tones: Map<string, ChangeTone>; total: number }) {
  const counts = new Map<ChangeTone, number>();
  for (const t of tones.values()) counts.set(t, (counts.get(t) ?? 0) + 1);
  const parts = (["added", "removed", "modified", "type"] as ChangeTone[])
    .map((tone) => ({ tone, n: counts.get(tone) ?? 0 }))
    .filter((p) => p.n > 0);
  const changed = parts.reduce((s, p) => s + p.n, 0);
  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 align-middle font-sans text-[10px] font-medium normal-case tracking-normal text-[#777168]">
      <span>
        {changed}/{total} changed
      </span>
      {parts.map((p) => (
        <span key={p.tone} className="inline-flex items-center gap-1">
          <span className={`h-1.5 w-1.5 rounded-full ${LEGEND_DOT[p.tone]}`} aria-hidden="true" />
          {p.tone} {p.n}
        </span>
      ))}
    </span>
  );
}

/**
 * Graph Diff: A and B canvases side by side with change tones, synced
 * selection, and category filtering (presentation only - findings rule).
 */
export function CompareGraph({
  a,
  b,
  findings,
  filter,
  selectedId,
  onSelect,
}: {
  a: object;
  b: object;
  findings: Finding[];
  filter: Set<FindingCategory> | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const docA = useMemo(() => buildDocument(a), [a]);
  const docB = useMemo(() => buildDocument(b), [b]);

  const tonesA = useMemo(() => tonesForSide(findings, "a"), [findings]);
  const tonesB = useMemo(() => tonesForSide(findings, "b"), [findings]);

  const includeA = useMemo(() => {
    if (filter === null) return null;
    const ids = findings.filter((f) => f.pathA !== null && filter.has(f.category)).map((f) => f.pathA as string);
    return includeSet(docA, ids);
  }, [findings, filter, docA]);

  const includeB = useMemo(() => {
    if (filter === null) return null;
    const ids = findings.filter((f) => f.pathB !== null && filter.has(f.category)).map((f) => f.pathB as string);
    return includeSet(docB, ids);
  }, [findings, filter, docB]);

  // Selection is finding-scoped; map to each side's node id.
  const finding = findings.find((f) => f.id === selectedId) ?? null;
  const selA = finding?.pathA ?? null;
  const selB = finding?.pathB ?? null;

  // Paired values for the selection: both inspectors render the inline change.
  const compareValues =
    finding && finding.oldValue !== undefined && finding.newValue !== undefined
      ? { oldValue: finding.oldValue, newValue: finding.newValue }
      : null;

  const selectFrom = (side: "a" | "b") => (nodeId: string | null) => {
    if (nodeId === null) {
      onSelect(null);
      return;
    }
    const hit = findings.find((f) => (side === "a" ? f.pathA : f.pathB) === nodeId);
    onSelect(hit ? hit.id : null);
  };

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <div>
        <p className="mb-1.5 font-mono text-[11px] font-bold text-[#777168]">
          A · source
          <ToneLegend tones={tonesA} total={docA.size} />
        </p>
        <JsonGraph
          doc={docA}
          tones={tonesA}
          includeOnly={includeA}
          compareValues={compareValues}
          selectedId={selA}
          onSelect={selectFrom("a")}
        />
      </div>
      <div>
        <p className="mb-1.5 font-mono text-[11px] font-bold text-[#777168]">
          B · target
          <ToneLegend tones={tonesB} total={docB.size} />
        </p>
        <JsonGraph
          doc={docB}
          tones={tonesB}
          includeOnly={includeB}
          compareValues={compareValues}
          selectedId={selB}
          onSelect={selectFrom("b")}
        />
      </div>
    </div>
  );
}
