"use client";

import { useEffect, useState } from "react";
import { listExperiences } from "@/lib/wireframe/store";
import type { Experience } from "@/lib/wireframe/model";
import { summarizeWireScreen } from "@/lib/experience/wireframeRef";
import type { Screen } from "@/lib/experience/types";

/**
 * Canonical screen-link readout (B1). One box, read-only summaries:
 * the live wireframe (or its stale history label) and the payload mapping.
 * All attach/change flows live in the unified Attach dialog - this chip
 * only detaches and opens the dialog.
 */
export function ScreenLinks({
  screen,
  payloadLabel,
  onOpenMapping,
  onDetachWireframe,
  onDetachPayload,
  onAttachClick,
}: {
  screen: Screen;
  payloadLabel?: string;
  onOpenMapping: () => void;
  onDetachWireframe: () => void;
  onDetachPayload: () => void;
  onAttachClick: () => void;
}) {
  const [experiences, setExperiences] = useState<Experience[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listExperiences()
      .then((all) => {
        if (!cancelled) setExperiences(all);
      })
      .catch(() => {
        if (!cancelled) setExperiences([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ref = screen.wireframeRef;
  const live = ref && (experiences ?? []).find((e) => e.id === ref.experienceId);
  const summary = ref ? summarizeWireScreen(live ?? null, ref.screenId) : null;

  return (
    <div className="rounded-xl border border-[#E8E2D8] bg-white p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Linked design</p>
        <button
          type="button"
          onClick={onAttachClick}
          className="cursor-pointer rounded-lg border border-[#E8E2D8] px-2 py-1 text-[11px] font-semibold text-[#A98450] hover:border-[#A98450]"
        >
          Attach / change…
        </button>
      </div>
      <ul className="mt-1.5 space-y-1.5">
        <li className="flex items-center gap-2 rounded-lg border border-[#F0EBE0] px-2 py-1.5">
          <span className="shrink-0 rounded border border-[#DCC99A] bg-[#F5EEDF] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#8A6A2F]">
            Wireframe
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-[#27241F]">
            {summary ? (
              <>
                {summary.experienceName} → {summary.screenName}
                <span className="ml-1 font-mono text-[10px] text-[#A39B8E]">
                  {summary.components} comps · {summary.salesforceBindings.length} SF · {summary.proposedFields.length} proposed
                </span>
              </>
            ) : ref ? (
              <span className="text-[#8A6A2F]">⚠ {ref.screenName ?? ref.screenId} (wireframe deleted - kept for history)</span>
            ) : (
              <span className="text-[#A39B8E]">none - attach a wireframe instead of a static PNG</span>
            )}
          </span>
          {ref && (
            <button type="button" onClick={onDetachWireframe} aria-label="Detach wireframe" className="shrink-0 cursor-pointer rounded px-1 text-[#B3261E] hover:bg-[#F9E8E6]">
              ✕
            </button>
          )}
        </li>
        <li className="flex items-center gap-2 rounded-lg border border-[#F0EBE0] px-2 py-1.5">
          <span className="shrink-0 rounded border border-[#DCC99A] bg-[#F5EEDF] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#8A6A2F]">
            Mapping
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-[#27241F]">
            {screen.payloadMappingId ? (payloadLabel ?? screen.payloadMappingId) : <span className="text-[#A39B8E]">none - attach the payload this screen submits</span>}
          </span>
          {screen.payloadMappingId && (
            <>
              <button
                type="button"
                onClick={onOpenMapping}
                title="Open the linked integration mapping"
                className="shrink-0 cursor-pointer rounded-lg border border-[#E8E2D8] px-2 py-1 font-mono text-[11px] text-[#A98450] hover:underline"
              >
                open ↗
              </button>
              <button type="button" onClick={onDetachPayload} aria-label="Detach payload mapping" className="shrink-0 cursor-pointer rounded px-1 text-[#B3261E] hover:bg-[#F9E8E6]">
                ✕
              </button>
            </>
          )}
        </li>
      </ul>
    </div>
  );
}
