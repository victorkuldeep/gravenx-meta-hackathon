"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import { candidateSources, requiredTargets, unmappedSourceCount } from "@/lib/mapping/coverage";
import type { CoverageItem, SourceCandidate } from "@/lib/mapping/coverage";
import type { MappingProject } from "@/lib/mapping/types";

/**
 * Coverage queue: one required field at a time, best source first.
 * Picking a candidate maps it immediately and advances; skipping parks
 * the field for this pass. The queue drains to zero - that is the
 * definition of done for the finishing pass.
 */
export function CoverageModal({
  project,
  onApply,
  onClose,
}: {
  project: MappingProject;
  onApply: (item: CoverageItem, sourcePath: string) => void;
  onClose: () => void;
}) {
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [applied, setApplied] = useState(0);

  const queue = useMemo(() => requiredTargets(project), [project]);
  const current: CoverageItem | undefined = queue.find((q) => !skipped.has(`${q.objectName}.${q.field.name}`));
  const candidates: SourceCandidate[] = useMemo(
    () => (current ? candidateSources(project, current.field) : []),
    [project, current]
  );
  const leftover = useMemo(() => unmappedSourceCount(project), [project]);

  const pick = (sourcePath: string) => {
    if (!current) return;
    onApply(current, sourcePath);
    setApplied((n) => n + 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Coverage queue">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-[#E8E2D8] bg-white shadow-xl">
        <div className="border-b border-[#F0EBE0] px-5 py-4">
          <p className="text-[15px] font-semibold text-[#27241F]">
            Coverage · {current ? `${queue.length - skipped.size} remaining` : "complete"}
          </p>
          <p className="mt-0.5 text-[12px] text-[#777168]">
            Required target fields with no mapping. Pick the right source, or skip what you will handle later.
          </p>
        </div>

        {!current ? (
          <div className="px-5 py-8 text-center">
            <p className="text-[28px]" aria-hidden="true">✓</p>
            <p className="mt-1 text-[14px] font-semibold text-[#2F7D4F]">Zero required fields unmapped.</p>
            <p className="mt-1 text-[12px] text-[#777168]">
              {applied > 0 ? `Mapped ${applied} this pass. ` : ""}
              {leftover > 0 ? `${leftover} optional source ${leftover === 1 ? "field" : "fields"} still unmapped - map them from the tree if they matter.` : "Every source field is mapped too."}
              {skipped.size > 0 ? ` ${skipped.size} skipped.` : ""}
            </p>
            <div className="mt-4">
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 px-5 py-4">
            <div className="rounded-xl border border-[#E8E2D8] bg-[#FAF8F2] px-3 py-2.5">
              <p className="font-mono text-[13px] font-semibold text-[#27241F]">
                {current.objectName}.{current.field.name}
              </p>
              <p className="mt-0.5 text-[11px] text-[#777168]">
                {current.field.label} · {current.field.type}
                {current.field.length > 0 ? `(${current.field.length})` : ""}
                {current.field.picklistValues.length > 0 ? ` · ${current.field.picklistValues.filter((p) => p.active).length} picklist values` : ""}
              </p>
            </div>

            {candidates.length > 0 ? (
              <ul className="max-h-[40vh] space-y-1 overflow-y-auto">
                {candidates.map((c) => (
                  <li key={c.path.id}>
                    <button
                      type="button"
                      onClick={() => pick(c.path.id)}
                      title={c.path.path}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-[#F0EBE0] px-3 py-2 text-left hover:border-[#A98450] hover:bg-[#FAF8F2]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[12px] text-[#27241F]">{c.path.path}</span>
                        {c.path.example !== undefined && (
                          <span className="block truncate font-mono text-[10px] text-[#A39B8E]">= {String(c.path.example)}</span>
                        )}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${
                          c.confidence === "exact" ? "bg-[#E9F3EC] text-[#2F7D4F]" : "bg-[#FAF3E3] text-[#A98450]"
                        }`}
                      >
                        {c.confidence}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-[#E8E2D8] p-4 text-center text-[12px] text-[#A39B8E]">
                No name-similar unmapped source found. Map it by hand in the grid, hardcode a value, or skip.
              </p>
            )}

            <div className="flex items-center justify-between">
              <span className="text-[12px] text-[#777168]">{applied} mapped this pass</span>
              <span className="flex gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Pause
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setSkipped((prev) => new Set(prev).add(`${current.objectName}.${current.field.name}`))}
                >
                  Skip →
                </Button>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
