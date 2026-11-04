"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import { mappingsToKvPrefill, parseKeyValueGrid, resolveQuickPairs, type KeyValuePair, type QuickMatch } from "@/lib/mapping/grid";
import type { MappingProject } from "@/lib/mapping/types";
import type { PasteRow } from "@/lib/mapping/grid";

interface KvRow {
  id: string;
  key: string;
  value: string;
}

let seq = 0;
const nid = () => `kv-${Date.now().toString(36)}-${seq++}`;

/** Agent-ready contract text - the architect pastes this into any agent chat. */
export const KV_AGENT_CONTRACT = [
  "Emit the field mapping as K:V lines, one per line.",
  "Key = source JSON path (full $.path preferred, unique leaf ok).",
  "Value = Object.Field, or a bare field resolved through the record plan.",
  "Separators: = or -> or tab. Or one JSON object: {\"$.path\": \"Object.Field\"}.",
  "Constant: a \"double-quoted\" value ships verbatim, e.g. $.type = \"ProductOrder\".",
  "No prose, no bullets - only K:V lines or the JSON object.",
].join("\n");

const BADGE: Record<QuickMatch["status"], string> = {
  ok: "border-[#BFD9C6] bg-[#E9F3EC] text-[#2F7D4F]",
  blind: "border-[#DCC99A] bg-[#F5EEDF] text-[#8A6A2F]",
  ambiguous: "border-[#E5B8B2] bg-[#F9E8E6] text-[#B3261E]",
  "unknown-source": "border-[#E5B8B2] bg-[#F9E8E6] text-[#B3261E]",
  "unknown-target": "border-[#E5B8B2] bg-[#F9E8E6] text-[#B3261E]",
  "no-plan": "border-[#E5B8B2] bg-[#F9E8E6] text-[#B3261E]",
};

const BADGE_DOT: Record<QuickMatch["status"], string> = {
  ok: "✓",
  blind: "◐",
  ambiguous: "!",
  "unknown-source": "?",
  "unknown-target": "?",
  "no-plan": "!",
};

/**
 * Fast-forward mapper: Postman-style K:V rows plus a bulk dump box.
 * Sources resolve by exact $.path then unique leaf; bare-field targets
 * resolve through the record plan. Only clean rows import - the rest say
 * why, inline, before anything commits.
 */
export function QuickMapModal({
  project,
  planId,
  planLabel,
  onImport,
  onClose,
}: {
  project: MappingProject;
  planId: string | null;
  planLabel: string | null;
  onImport: (rows: PasteRow[]) => void;
  onClose: () => void;
}) {
  // Already-mapped rows prefill as K:V (constants quoted) so the format
  // reads by example; untouched rows reimport to themselves.
  const [kvRows, setKvRows] = useState<KvRow[]>(() => [
    ...mappingsToKvPrefill(project.mappings).map((p) => ({ id: nid(), key: p.key, value: p.value })),
    { id: nid(), key: "", value: "" },
  ]);
  const [bulk, setBulk] = useState("");
  const [bulkSkipped, setBulkSkipped] = useState(0);
  const [contractCopied, setContractCopied] = useState(false);

  const filled = useMemo<KvRow[]>(() => kvRows.filter((r) => r.key.trim() && r.value.trim()), [kvRows]);
  const resolved = useMemo(() => {
    const pairs: KeyValuePair[] = filled.map((r, i) => ({ key: r.key.trim(), value: r.value.trim(), line: i }));
    return resolveQuickPairs(project, pairs, planId);
  }, [project, filled, planId]);

  const matchByLine = useMemo(() => new Map(resolved.matches.map((m) => [m.line, m])), [resolved]);
  const ready = resolved.rows.length;
  const attention = filled.length - ready;

  const patchRow = (id: string, patch: Partial<KvRow>) =>
    setKvRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const dumpBulk = () => {
    const { pairs, skipped } = parseKeyValueGrid(bulk);
    setBulkSkipped(skipped.length);
    if (pairs.length === 0) return;
    setKvRows((prev) => {
      const kept = prev.filter((r) => r.key.trim() || r.value.trim());
      return [...kept, ...pairs.map((p) => ({ id: nid(), key: p.key, value: p.value })), { id: nid(), key: "", value: "" }];
    });
    setBulk("");
  };

  const copyContract = async () => {
    try {
      await navigator.clipboard.writeText(KV_AGENT_CONTRACT);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = KV_AGENT_CONTRACT;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setContractCopied(true);
    setTimeout(() => setContractCopied(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="modal-card max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4">
          <p className="eyebrow">Quick map</p>
          <h2 className="mt-1 text-lg font-bold text-ivory-950">Fast-forward mapper</h2>
          <p className="mt-0.5 text-xs text-ivory-600">
            Dump K:V pairs and boom - sources match by $.path then unique leaf, bare fields resolve through{" "}
            {planLabel ? (
              <span className="font-semibold text-ivory-950">{planLabel}</span>
            ) : (
              <span className="font-semibold text-[#B3261E]">no record plan picked</span>
            )}
            . Same source updates in place. Already-mapped rows prefill below - &quot;quoted&quot; values are constants.
          </p>

          <div className="mt-3 rounded-xl border border-[#E8E2D8] bg-[var(--color-canvas)] p-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">Bulk dump - agent output pastes here</p>
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder={"$.order.id = Order.Id\n$.type = \"ProductOrder\" (constant)\n{\"$.total\": \"Order.Amount__c\"}"}
              aria-label="Bulk K:V dump"
              className="mt-1.5 w-full rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-2 font-mono text-[12px] focus:border-[#A98450] focus:outline-none"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={!bulk.trim()} onClick={dumpBulk}>
                Parse into rows
              </Button>
              {bulkSkipped > 0 && <span className="text-[11px] text-[#B3261E]">{bulkSkipped} line{bulkSkipped === 1 ? "" : "s"} had no K:V separator</span>}
              <button type="button" onClick={() => void copyContract()} className="ml-auto cursor-pointer text-[11px] font-semibold text-[#A98450] hover:underline">
                {contractCopied ? "Contract copied ✓" : "Copy K:V contract for AI agents"}
              </button>
            </div>
          </div>

          <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
            {kvRows.map((r) => {
              const filledIdx = filled.indexOf(r);
              const m = filledIdx >= 0 ? matchByLine.get(filledIdx) : undefined;
              return (
                <li key={r.id}>
                  <div className="flex items-center gap-1.5">
                    <input
                      value={r.key}
                      onChange={(e) => patchRow(r.id, { key: e.target.value })}
                      placeholder="source $.path or leaf"
                      spellCheck={false}
                      aria-label={`Key ${r.id}`}
                      className="min-w-0 flex-1 rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 font-mono text-[12px] focus:border-[#A98450] focus:outline-none"
                    />
                    <span className="font-mono text-[12px] text-[#A39B8E]">:</span>
                    <input
                      value={r.value}
                      onChange={(e) => patchRow(r.id, { value: e.target.value })}
                      placeholder="Object.Field or bare field"
                      spellCheck={false}
                      aria-label={`Value ${r.id}`}
                      className="min-w-0 flex-1 rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 font-mono text-[12px] focus:border-[#A98450] focus:outline-none"
                    />
                    {m ? (
                      <span title={m.note} className={`inline-flex w-6 shrink-0 items-center justify-center rounded-md border px-1 py-1 font-mono text-[11px] font-bold ${BADGE[m.status]}`}>
                        {BADGE_DOT[m.status]}
                      </span>
                    ) : (
                      <span className="inline-flex w-6 shrink-0 items-center justify-center rounded-md border border-[#E8E2D8] px-1 py-1 font-mono text-[11px] text-[#C9BFAE]">·</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setKvRows((prev) => (prev.length > 1 ? prev.filter((x) => x.id !== r.id) : [{ ...r, key: "", value: "" }]))}
                      aria-label="Remove row"
                      className="shrink-0 cursor-pointer rounded p-1 text-[#C9BFAE] hover:bg-red-500/10 hover:text-red-700"
                    >
                      ×
                    </button>
                  </div>
                  {m && m.status !== "ok" && (
                    <p className="mt-0.5 pl-0.5 text-[11px] text-[#B3261E]">{m.note}</p>
                  )}
                  {m && m.status === "blind" && (
                    <p className="mt-0.5 pl-0.5 text-[11px] text-[#8A6A2F]">{m.note}</p>
                  )}
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={() => setKvRows((prev) => [...prev, { id: nid(), key: "", value: "" }])} className="mt-1.5 cursor-pointer text-[12px] font-semibold text-[#A98450] hover:underline">
            + Add row
          </button>
          <p className="mt-2 text-[11px] text-ivory-600">
            {ready} row{ready === 1 ? "" : "s"} ready{attention > 0 && ` · ${attention} need${attention === 1 ? "s" : ""} attention`}
          </p>
        </div>
        <div className="px-6 py-3.5 border-t border-[var(--color-line-soft)] bg-[var(--color-canvas)] flex items-center gap-2">
          <p className="flex-1 text-[11px] text-ivory-600">✓ direct · ◐ blind (no snapshot) · ?/! explain inline - only clean rows import.</p>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={ready === 0}
            onClick={() => {
              onImport(resolved.rows);
              onClose();
            }}
          >
            Import {ready} row{ready === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </div>
  );
}
