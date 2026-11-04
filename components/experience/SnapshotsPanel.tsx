"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import { logChange } from "@/lib/experience/migrate";
import { compareSnapshots, integrationImpact, operationImpact, takeSnapshot } from "@/lib/experience/snapshots";
import type { StudioProject } from "@/lib/studio/types";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const inputCls =
  "rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none";

/** Named snapshots, A/B compare, and change-impact tracing. */
export function SnapshotsPanel({
  project,
  artifactChoices,
  onMutate,
  onOpenScreen,
  onOpenApis,
}: {
  project: StudioProject;
  /** Mapping rows + plans across child mappings (labels included). */
  artifactChoices: { id: string; label: string }[];
  onMutate: (fn: (p: StudioProject) => StudioProject) => void;
  onOpenScreen: (screenId: string) => void;
  onOpenApis: () => void;
}) {
  const snaps = useMemo(() => project.experienceSnapshots ?? [], [project.experienceSnapshots]);
  const [label, setLabel] = useState("");
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [impactOp, setImpactOp] = useState("");
  const [impactArtifact, setImpactArtifact] = useState("");

  const create = () => {
    const now = new Date().toISOString();
    const snap = takeSnapshot(project, uid("snap"), label.trim() || `Snapshot ${snaps.length + 1}`, now);
    onMutate((p) => {
      const next = { ...p, experienceSnapshots: [...(p.experienceSnapshots ?? []), snap] };
      logChange(next, "snapshot", snap.id, "created", `Architecture snapshot "${snap.label}" captured.`, now);
      return next;
    });
    setLabel("");
  };

  const changes = useMemo(() => {
    const a = snaps.find((s) => s.id === compareA);
    const b = snaps.find((s) => s.id === compareB);
    return a && b ? compareSnapshots(a, b) : [];
  }, [snaps, compareA, compareB]);

  const opImpact = impactOp ? operationImpact(project, impactOp) : [];
  const artifactImpact = impactArtifact
    ? integrationImpact(project, impactArtifact, artifactChoices.find((c) => c.id === impactArtifact)?.label)
    : [];

  const goNode = (kind: string, id: string) => {
    if (kind === "screen") onOpenScreen(id);
    else if (kind === "operation" || kind === "dependency") onOpenApis();
    else {
      const exp = project.experience;
      const screenId =
        exp?.components.find((c) => c.id === id)?.screenId ??
        exp?.bindings.find((b) => b.id === id)?.screenId ??
        exp?.requirements.find((r) => r.id === id)?.screenId;
      if (screenId) onOpenScreen(screenId);
      else onOpenApis();
    }
  };

  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
          Snapshots · {snaps.length}
        </p>
        <div className="mb-2 flex gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Workshop Draft, API Review 1)" aria-label="Snapshot label" className={`${inputCls} flex-1`} />
          <Button size="sm" onClick={create}>
            Capture
          </Button>
        </div>
        <ul className="mb-3 space-y-1">
          {snaps.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-lg border border-[#F0EBE0] px-2 py-1.5 text-[12px]">
              <span className="flex-1">
                <span className="font-semibold text-[#27241F]">{s.label}</span>{" "}
                <span className="font-mono text-[10px] text-[#A39B8E]">
                  {s.createdAt.slice(0, 16).replace("T", " ")} · {s.experience.screens.length} screens · {s.apiCatalog?.operations.length ?? 0} ops
                </span>
              </span>
              <button
                type="button"
                onClick={() =>
                  onMutate((p) => ({ ...p, experienceSnapshots: (p.experienceSnapshots ?? []).filter((x) => x.id !== s.id) }))
                }
                aria-label={`Delete snapshot ${s.label}`}
                className="rounded px-1 text-[11px] text-[#B3261E] hover:bg-[#F9E8E6] cursor-pointer"
              >
                delete
              </button>
            </li>
          ))}
          {snaps.length === 0 && <li className="text-[12px] text-[#A39B8E]">No snapshots - capture Workshop Draft before the review.</li>}
        </ul>
        {snaps.length >= 2 && (
          <div className="border-t border-[#F0EBE0] pt-2">
            <p className="mb-1.5 text-[11px] font-semibold text-[#27241F]">Compare</p>
            <div className="mb-2 flex gap-2">
              <select value={compareA} onChange={(e) => setCompareA(e.target.value)} aria-label="Baseline snapshot" className={`${inputCls} flex-1 cursor-pointer`}>
                <option value="">baseline…</option>
                {snaps.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <select value={compareB} onChange={(e) => setCompareB(e.target.value)} aria-label="Revised snapshot" className={`${inputCls} flex-1 cursor-pointer`}>
                <option value="">revised…</option>
                {snaps.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
            {compareA && compareB && (
              <ul className="max-h-[220px] space-y-1 overflow-y-auto">
                {changes.map((c) => (
                  <li key={c.key} className="rounded-lg border border-[#F0EBE0] bg-[#FAF8F2] px-2 py-1 text-[11px] text-[#55504A]">
                    <span className="font-mono font-semibold text-[#27241F]">{c.area}</span> · {c.summary}
                  </li>
                ))}
                {changes.length === 0 && <li className="text-[12px] text-[#2F7D4F]">Identical - no changes between snapshots.</li>}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Change impact</p>
        <label className="mb-2 block text-[11px] text-[#777168]">
          API operation change affects…
          <select value={impactOp} onChange={(e) => { setImpactOp(e.target.value); setImpactArtifact(""); }} aria-label="Operation for impact" className={`${inputCls} mt-1 cursor-pointer font-mono`}>
            <option value="">choose operation…</option>
            {(project.apiCatalog?.operations ?? []).map((o) => (
              <option key={o.id} value={o.id}>{o.method} {o.path} · {o.name}</option>
            ))}
          </select>
        </label>
        <label className="mb-2 block text-[11px] text-[#777168]">
          Integration artifact change affects…
          <select value={impactArtifact} onChange={(e) => { setImpactArtifact(e.target.value); setImpactOp(""); }} aria-label="Artifact for impact" className={`${inputCls} mt-1 cursor-pointer font-mono`}>
            <option value="">choose mapping or plan…</option>
            {artifactChoices.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        {(opImpact.length > 0 || artifactImpact.length > 0) && (
          <ul className="max-h-[260px] space-y-1 overflow-y-auto">
            {(opImpact.length > 0 ? opImpact : artifactImpact).map((n) => (
              <li key={`${n.kind}:${n.id}`}>
                <button
                  type="button"
                  onClick={() => goNode(n.kind, n.id)}
                  className="w-full cursor-pointer rounded-lg border border-[#F0EBE0] px-2 py-1 text-left text-[11px] hover:bg-[#FAF8F2]"
                >
                  <span className="font-mono font-semibold text-[#27241F]">{n.kind}</span> · {n.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
