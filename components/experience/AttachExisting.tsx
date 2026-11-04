"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "../ui/Button";
import {
  artifactAttachState,
  artifactTarget,
  loadArtifactIndex,
  searchArtifacts,
  type ArtifactEntry,
  type ArtifactKind,
} from "@/lib/studio/artifacts";
import type { WireframeRef } from "@/lib/experience/types";

const KIND_LABEL: Record<ArtifactKind, string> = {
  "wireframe-screen": "Wireframe",
  "integration-mapping": "Mapping",
  "contract-profile": "Contract",
  "salesforce-object": "Object",
  "saved-query": "Query",
};

const KIND_TABS: ("all" | ArtifactKind)[] = [
  "all",
  "wireframe-screen",
  "integration-mapping",
  "salesforce-object",
  "saved-query",
  "contract-profile",
];

/**
 * One search across every separately-authored inventory. Attaches by
 * reference (never copies): wireframe screens and mappings onto a screen,
 * mappings under a project. Everything else is discovery with a deep link -
 * no fake attach. Used-in backlinks show consumption before you attach.
 */
export function AttachExisting({
  mode,
  onClose,
  onAttachWireframe,
  onAttachMapping,
  attachedMappingIds = [],
  attachedWireKey = null,
}: {
  mode: "screen" | "project";
  onClose: () => void;
  onAttachWireframe: (ref: WireframeRef) => void;
  onAttachMapping: (mappingId: string) => void;
  attachedMappingIds?: string[];
  attachedWireKey?: string | null;
}) {
  const [entries, setEntries] = useState<ArtifactEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | ArtifactKind>("all");

  useEffect(() => {
    let cancelled = false;
    void loadArtifactIndex()
      .then((all) => {
        if (!cancelled) setEntries(all);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(() => searchArtifacts(entries ?? [], query, kind), [entries, query, kind]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Attach existing artifact">
      <div className="mx-auto max-w-2xl rounded-2xl border border-[#E8E2D8] bg-white p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[14px] font-semibold text-[#27241F]">Attach existing</p>
            <p className="mt-0.5 text-[12px] text-[#777168]">
              {mode === "screen" ? "Link a separately-built wireframe or mapping to this screen - by reference." : "Pull a library mapping under this project - no duplication."}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-lg px-2 py-1 text-[#777168] hover:bg-[#FAF8F2]">
            ✕
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search wireframes, mappings, contracts…"
            aria-label="Search artifacts"
            spellCheck={false}
            autoFocus
            className="min-w-[220px] flex-1 rounded-lg border border-[#E8E2D8] px-2.5 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5" role="tablist" aria-label="Artifact kind">
          {KIND_TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={`cursor-pointer rounded-lg border px-2 py-1 font-mono text-[11px] ${
                kind === k ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] text-[#777168] hover:text-[#27241F]"
              }`}
            >
              {k === "all" ? "all" : KIND_LABEL[k]}
            </button>
          ))}
        </div>

        {entries === null ? (
          <p className="py-8 text-center text-[12px] text-[#777168]">Loading inventories…</p>
        ) : results.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-[#777168]">
            Nothing matches - author it in Wireframe, Mapping or Contracts first, then attach here. Tip: Mapping → Load training set gives you a mapping + screen to attach right away.
          </p>
        ) : (
          <ul className="mt-3 max-h-[50vh] space-y-1.5 overflow-y-auto">
            {results.map((e) => {
              const state = artifactAttachState(e, { kind: mode, attachedMappingIds, attachedWireKey });
              return (
                <li key={e.key} className="flex items-center gap-2 rounded-xl border border-[#F0EBE0] px-2.5 py-2">
                  <span className="shrink-0 rounded border border-[#DCC99A] bg-[#F5EEDF] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#8A6A2F]">
                    {KIND_LABEL[e.kind]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-semibold text-[#27241F]">{e.label}</span>
                    <span className="block truncate font-mono text-[10px] text-[#A39B8E]">
                      {e.detail}
                      {e.usedIn.length > 0 ? ` · used in ${e.usedIn.join(", ")}` : " · unused"}
                    </span>
                  </span>
                  {state === "open" && (
                    <a href={artifactTarget(e)} className="shrink-0 rounded-lg border border-[#E8E2D8] px-2 py-1 text-[11px] font-semibold text-[#A98450] hover:underline">
                      Open ↗
                    </a>
                  )}
                  {state === "attach" && (
                    <Button
                      size="sm"
                      onClick={() => {
                        if (e.kind === "wireframe-screen" && e.experienceId && e.screenId) {
                          const parts = e.label.split(" → ");
                          onAttachWireframe({ experienceId: e.experienceId, screenId: e.screenId, experienceName: parts[0], screenName: parts[1] });
                        } else if (e.kind === "integration-mapping" && e.mappingId) {
                          onAttachMapping(e.mappingId);
                        }
                        onClose();
                      }}
                    >
                      Attach
                    </Button>
                  )}
                  {state === "attached" && (
                    <span className="shrink-0 font-mono text-[10px] text-[#2F7D4F]">attached ✓</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
