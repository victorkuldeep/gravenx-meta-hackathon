"use client";

import { useMemo, useState } from "react";
import { analyzeCoverage } from "@/lib/experience/coverage";
import type { StudioProject } from "@/lib/studio/types";

const SEV_STYLE: Record<string, string> = {
  blocking: "border-[#E5B8B2] bg-[#F9E8E6] text-[#B3261E]",
  warning: "border-[#E0C491] bg-[#F3EADB] text-[#9A5B13]",
  info: "border-[#E8E2D8] bg-[#FAF8F2] text-[#777168]",
};

/** Coverage counts + deterministic gap findings. Every row navigates. */
export function CoveragePanel({
  project,
  onOpenScreen,
  onOpenApis,
}: {
  project: StudioProject;
  onOpenScreen: (screenId: string) => void;
  onOpenApis: () => void;
}) {
  const { counts, findings } = useMemo(() => analyzeCoverage(project), [project]);
  const [severity, setSeverity] = useState<"all" | "blocking" | "warning" | "info">("all");

  const visible = severity === "all" ? findings : findings.filter((f) => f.severity === severity);

  const stats: [string, number][] = [
    ["screens", counts.screens],
    ["with images", counts.screensWithImages],
    ["components", counts.components],
    ["components bound", counts.componentsWithBindings],
    ["operations", counts.operations],
    ["with contracts", counts.operationsWithContracts],
    ["orphan ops", counts.orphanOperations],
    ["broken refs", counts.brokenReferences],
    ["open decisions", counts.openDecisions],
    ["open questions", counts.openQuestions],
  ];

  const go = (entityId: string, type: string) => {
    if (type.startsWith("screen-") || type.startsWith("component-") || type.startsWith("transition-") || type.startsWith("binding-")) {
      // Components/bindings live on screens - find the owning screen.
      const exp = project.experience;
      const comp = exp?.components.find((c) => c.id === entityId);
      const binding = exp?.bindings.find((b) => b.id === entityId);
      const screenId =
        exp?.screens.find((s) => s.id === entityId)?.id ??
        comp?.screenId ??
        binding?.screenId ??
        exp?.requirements.find((r) => r.id === entityId)?.screenId;
      if (screenId) onOpenScreen(screenId);
    } else if (type.startsWith("op-") || type.startsWith("operation-")) {
      onOpenApis();
    }
  };

  return (
    <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Coverage</p>
        <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} aria-label="Filter by severity" className="cursor-pointer rounded-md border border-[#E8E2D8] bg-white px-1.5 py-0.5 text-[11px]">
          <option value="all">all ({findings.length})</option>
          <option value="blocking">blocking ({findings.filter((f) => f.severity === "blocking").length})</option>
          <option value="warning">warning ({findings.filter((f) => f.severity === "warning").length})</option>
          <option value="info">info ({findings.filter((f) => f.severity === "info").length})</option>
        </select>
      </div>
      <dl className="mb-2 grid grid-cols-3 gap-1">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-[#F0EBE0] bg-[#FAF8F2] px-1 py-1 text-center">
            <dt className="font-mono text-[9px] uppercase tracking-wider text-[#A39B8E]">{label}</dt>
            <dd className="font-mono text-[14px] font-bold text-[#27241F]">{value}</dd>
          </div>
        ))}
      </dl>
      <ul className="max-h-[320px] space-y-1 overflow-y-auto">
        {visible.slice(0, 200).map((f) => (
          <li key={f.key}>
            <button
              type="button"
              onClick={() => go(f.entityId, f.type)}
              className={`w-full cursor-pointer rounded-lg border px-2.5 py-1.5 text-left text-[11px] ${SEV_STYLE[f.severity]}`}
            >
              <span className="font-mono font-semibold">[{f.severity}] {f.type}</span>
              <span className="block">{f.message}</span>
              <span className="block opacity-80">↳ {f.action}</span>
            </button>
          </li>
        ))}
        {visible.length === 0 && <li className="text-[12px] text-[#2F7D4F]">Clean - no findings at this severity.</li>}
      </ul>
    </div>
  );
}
