"use client";

import { useState } from "react";
import Button from "../ui/Button";
import type { Suggestion } from "@/lib/mapping/suggest";

/**
 * Auto-suggest review: every proposal is a checked box the architect can
 * veto. Nothing is written until Apply - the grid stays untouched.
 */
export function SuggestModal({
  suggestions,
  onApply,
  onClose,
}: {
  suggestions: Suggestion[];
  onApply: (selected: Suggestion[]) => void;
  onClose: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(suggestions.map((s) => s.sourcePath)));
  const exact = suggestions.filter((s) => s.confidence === "exact").length;

  const toggle = (path: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const chosen = suggestions.filter((s) => checked.has(s.sourcePath));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Auto-suggest review">
      <div className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-[#E8E2D8] bg-white shadow-xl">
        <div className="border-b border-[#F0EBE0] px-5 py-4">
          <p className="text-[15px] font-semibold text-[#27241F]">Auto-suggest · {suggestions.length} proposals</p>
          <p className="mt-0.5 text-[12px] text-[#777168]">
            {exact} exact name {exact === 1 ? "match" : "matches"} · {suggestions.length - exact} overlap{" "}
            {suggestions.length - exact === 1 ? "guess" : "guesses"} · untick anything you disagree with, then apply.
          </p>
        </div>
        <ul className="max-h-[50vh] space-y-1 overflow-y-auto px-3 py-3">
          {suggestions.map((s) => (
            <li key={s.sourcePath}>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2 hover:bg-[#FAF8F2]">
                <input
                  type="checkbox"
                  checked={checked.has(s.sourcePath)}
                  onChange={() => toggle(s.sourcePath)}
                  className="mt-1 accent-[#722F37]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[12px] text-[#27241F]">
                    {s.sourceKey} <span aria-hidden="true" className="text-[#A39B8E]">→</span> {s.objectName}.{s.fieldName}
                  </span>
                  <span className="block text-[11px] text-[#777168]">{s.reason}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                    s.confidence === "exact" ? "bg-[#E9F3EC] text-[#2F7D4F]" : "bg-[#FAF3E3] text-[#A98450]"
                  }`}
                >
                  {s.confidence}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-[#F0EBE0] px-5 py-3">
          <span className="text-[12px] text-[#777168]">{chosen.length} of {suggestions.length} selected</span>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => onApply(chosen)} disabled={chosen.length === 0}>
              Apply {chosen.length > 0 ? `${chosen.length} ` : ""}mapping{chosen.length === 1 ? "" : "s"}
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
