"use client";

import { useEffect, useState } from "react";
import { listRevisions, type ContractRevision } from "@/lib/contracts/revisions";
import { toYamlString } from "@/lib/contracts/export";
import CodeBlock from "../ui/CodeBlock";
import Button from "../ui/Button";
import type { ContractsTabsProps } from "./ContractsTabs";

/**
 * Versions tab: immutable revision log per profile - hash, summary,
 * snapshot age, YAML view, restore-into-drafts.
 */
export function ContractVersions(props: ContractsTabsProps) {
  const { drafts, activeId } = props;
  const { onRestoreRevision } = props;
  const [revisions, setRevisions] = useState<ContractRevision[]>([]);
  const [viewId, setViewId] = useState<string | null>(null);

  useEffect(() => {
    setViewId(null);
    if (!activeId) {
      setRevisions([]);
      return;
    }
    listRevisions(activeId)
      .then(setRevisions)
      .catch(() => setRevisions([]));
  }, [activeId]);

  const draft = activeId ? (drafts.get(activeId) ?? null) : null;
  const viewed = revisions.find((r) => r.id === viewId) ?? null;

  if (!draft) {
    return (
      <div className="rounded-xl border border-[#E8E2D8] bg-white p-10 text-center text-sm text-[#A39B8E]">
        Select a profile to see its versions.
      </div>
    );
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="rounded-xl border border-[#E8E2D8] bg-white overflow-hidden">
        <p className="border-b border-[#E8E2D8] px-3 py-2 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
          Revisions · {draft.name}
        </p>
        <div className="max-h-[480px] overflow-y-auto p-1.5">
          {revisions.length === 0 && (
            <p className="px-2 py-4 text-center text-[11px] text-[#A39B8E]">
              No revisions yet - Save the profile to record the first.
            </p>
          )}
          {revisions.map((r) => (
            <div
              key={r.id}
              className={`rounded-lg px-2.5 py-2 transition-colors ${viewId === r.id ? "bg-[#211F1B] text-white" : "hover:bg-[#F5F1E8]"}`}
            >
              <div className="flex items-center gap-2">
                <span className={`font-mono text-xs font-bold ${viewId === r.id ? "text-white" : "text-[#27241F]"}`}>
                  rev {r.revision}
                </span>
                <span className={`font-mono text-[10px] ${viewId === r.id ? "text-white/60" : "text-[#A39B8E]"}`}>
                  {new Date(r.generatedAt).toLocaleString()}
                </span>
              </div>
              <p className={`mt-0.5 text-[11px] ${viewId === r.id ? "text-white/80" : "text-[#777168]"}`}>{r.summary}</p>
              <p className={`font-mono text-[10px] ${viewId === r.id ? "text-white/50" : "text-[#A39B8E]"}`}>{r.hash}</p>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  onClick={() => setViewId(viewId === r.id ? null : r.id)}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium cursor-pointer ${viewId === r.id ? "bg-white/15 text-white" : "bg-[#F5F1E8] text-[#27241F] hover:bg-[#EAE4DA]"}`}
                >
                  {viewId === r.id ? "Hide" : "View"}
                </button>
                <button
                  onClick={() => onRestoreRevision(r.profile)}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium cursor-pointer ${viewId === r.id ? "bg-white/15 text-white" : "bg-[#F5F1E8] text-[#27241F] hover:bg-[#EAE4DA]"}`}
                  title="Load into drafts (dirty until saved)"
                >
                  Restore
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#E8E2D8] bg-white">
        {!viewed ? (
          <p className="p-10 text-center text-[13px] text-[#A39B8E]">
            Pick a revision to inspect its exact compiled document.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-[#E8E2D8] px-4 py-2.5">
              <span className="font-mono text-xs font-bold text-[#27241F]">rev {viewed.revision}</span>
              <span className="font-mono text-[11px] text-[#A39B8E]">{viewed.hash}</span>
              <span className="flex-1" />
              <Button size="sm" onClick={() => onRestoreRevision(viewed.profile)}>
                Restore into drafts
              </Button>
            </div>
            <div className="p-4">
              <CodeBlock code={toYamlString(viewed.document)} language="yaml" maxHeight="560px" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
