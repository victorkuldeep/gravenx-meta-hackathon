"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { listRevisions, type ContractRevision } from "@/lib/contracts/revisions";
import { diffCompiledDocuments, severityCounts } from "@/lib/contracts/compatibility";
import type { ContractsTabsProps } from "./ContractsTabs";

const VirtualizedDiffViewer = dynamic(
  () => import("virtual-react-json-diff").then((m) => m.VirtualDiffViewer),
  { ssr: false, loading: () => <p className="p-6 text-sm text-[#A39B8E]">Loading diff engine…</p> }
);

interface Side {
  profileId: string;
  revId: string;
}

/**
 * Compare tab: profile-vs-profile (or revision-vs-revision) structural
 * diff with breaking/compatible classification + virtualized viewer.
 */
export function ContractCompare(props: ContractsTabsProps) {
  const { drafts } = props;
  const profiles = useMemo(() => [...drafts.values()].sort((a, b) => a.name.localeCompare(b.name)), [drafts]);

  const [aSide, setASide] = useState<Side>({ profileId: "", revId: "" });
  const [bSide, setBSide] = useState<Side>({ profileId: "", revId: "" });
  const [aRevs, setARevs] = useState<ContractRevision[]>([]);
  const [bRevs, setBRevs] = useState<ContractRevision[]>([]);

  // Default: first two profiles, latest revisions.
  useEffect(() => {
    if (profiles.length >= 2 && aSide.profileId === "") {
      setASide({ profileId: profiles[0].id, revId: "" });
      setBSide({ profileId: profiles[1].id, revId: "" });
    } else if (profiles.length === 1 && aSide.profileId === "") {
      setASide({ profileId: profiles[0].id, revId: "" });
      setBSide({ profileId: profiles[0].id, revId: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles.length]);

  useEffect(() => {
    if (!aSide.profileId) {
      setARevs([]);
      return;
    }
    listRevisions(aSide.profileId)
      .then((r) => {
        setARevs(r);
        setASide((s) => (s.revId === "" && r.length > 0 ? { ...s, revId: r[0].id } : s));
      })
      .catch(() => setARevs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aSide.profileId]);

  useEffect(() => {
    if (!bSide.profileId) {
      setBRevs([]);
      return;
    }
    listRevisions(bSide.profileId)
      .then((r) => {
        setBRevs(r);
        setBSide((s) => (s.revId === "" && r.length > 0 ? { ...s, revId: r[0].id } : s));
      })
      .catch(() => setBRevs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bSide.profileId]);

  const aDoc = aRevs.find((r) => r.id === aSide.revId)?.document ?? null;
  const bDoc = bRevs.find((r) => r.id === bSide.revId)?.document ?? null;

  const changes = useMemo(
    () => (aDoc && bDoc ? diffCompiledDocuments(aDoc, bDoc) : []),
    [aDoc, bDoc]
  );
  const counts = severityCounts(changes);

  const sidePicker = (side: Side, setSide: (s: Side) => void, revs: ContractRevision[], label: string) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[11px] font-bold text-[#27241F]">{label}</span>
      <select
        value={side.profileId}
        onChange={(e) => setSide({ profileId: e.target.value, revId: "" })}
        className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[13px] max-w-[220px]"
        aria-label={`${label} profile`}
      >
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <select
        value={side.revId}
        onChange={(e) => setSide({ ...side, revId: e.target.value })}
        className="cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 font-mono text-[12px]"
        aria-label={`${label} revision`}
      >
        {revs.map((r) => (
          <option key={r.id} value={r.id}>rev {r.revision} · {r.hash.slice(0, 12)}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E8E2D8] bg-white px-4 py-2.5">
        {sidePicker(aSide, setASide, aRevs, "A")}
        <span className="font-mono text-[11px] text-[#A39B8E]">vs</span>
        {sidePicker(bSide, setBSide, bRevs, "B")}
        <span className="flex-1" />
        <span className="font-mono text-[11px]">
          {counts.breaking > 0 && <span className="text-[#B84C42] font-bold">{counts.breaking} breaking</span>}
          {counts.breaking > 0 && (counts.compatible > 0 || counts.info > 0) && <span className="text-[#A39B8E]"> · </span>}
          {counts.compatible > 0 && <span className="text-[#32815B]">{counts.compatible} compatible</span>}
          {(counts.breaking > 0 || counts.compatible > 0) && counts.info > 0 && <span className="text-[#A39B8E]"> · </span>}
          {counts.info > 0 && <span className="text-[#A39B8E]">{counts.info} info</span>}
          {changes.length === 0 && <span className="text-[#A39B8E]">identical</span>}
        </span>
      </div>

      {changes.length > 0 && (
        <div className="grid gap-1.5 rounded-xl border border-[#E8E2D8] bg-white p-3 sm:grid-cols-2 lg:grid-cols-3">
          {changes.map((c, k) => (
            <div key={k} className="rounded-lg bg-[#F8F6F0] px-2 py-1.5">
              <p className={`text-[11px] font-bold ${c.severity === "breaking" ? "text-[#B84C42]" : c.severity === "compatible" ? "text-[#32815B]" : "text-[#A39B8E]"}`}>
                {c.severity} · {c.kind}
              </p>
              <p className="font-mono text-[10px] text-[#777168]">{c.path}</p>
              <p className="text-[11px] text-[#777168]">{c.detail}</p>
            </div>
          ))}
        </div>
      )}

      {aDoc && bDoc ? (
        <div className="overflow-hidden rounded-xl border border-[#E8E2D8]">
          <VirtualizedDiffViewer
            oldValue={aDoc}
            newValue={bDoc}
            height={560}
            leftTitle="A"
            rightTitle="B"
            theme="github-light"
            showLineCount
            differOptions={{ arrayDiffMethod: "lcs", detectCircular: false, showModifications: true }}
            comparisonOptions={{ compareStrategy: "strict" }}
          />
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-[#E8E2D8] bg-white p-8 text-center text-[13px] text-[#A39B8E]">
          Save each profile to record revisions, then compare any two.
        </p>
      )}
    </div>
  );
}
