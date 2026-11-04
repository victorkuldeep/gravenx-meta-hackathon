"use client";

import { useState } from "react";
import Button from "../ui/Button";
import {
  compareProjects,
  mergeNonConflicting,
  serializeProject,
  validateImport,
  type ExportKind,
} from "@/lib/mapping/exchange";
import { loadProject, saveProject } from "@/lib/mapping/store";
import type { MappingProject } from "@/lib/mapping/types";

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Export dialog: kind selection with explicit content disclosure. */
export function ExportDialog({ project, onClose }: { project: MappingProject; onClose: () => void }) {
  const [kind, setKind] = useState<ExportKind>("full");
  const [acknowledged, setAcknowledged] = useState(false);
  const hasSamples = (project.source?.paths.some((p) => p.example !== undefined) ?? false) || !!project.source?.originalText;

  const descriptions: Record<ExportKind, string> = {
    full: "Everything: source sample, metadata snapshot, plans, mappings, decisions, versions.",
    handoff: "Review bundle: same as full. Confirm sample payloads are safe to share first.",
    "mapping-only": "Mappings + identifiers only. Sample values and source text removed; paths and types kept.",
  };

  const doExport = () => {
    const text = serializeProject(project, kind, new Date().toISOString());
    const safe = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mapping";
    download(`${safe}.${kind}.json`, text);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-label="Export project">
      <div className="w-full max-w-md rounded-2xl border border-[#E8E2D8] bg-white p-5">
        <p className="text-[14px] font-semibold text-[#27241F]">Export Project Configuration</p>
        <div className="mt-3 space-y-2" role="radiogroup" aria-label="Export kind">
          {(Object.keys(descriptions) as ExportKind[]).map((k) => (
            <label key={k} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${kind === k ? "border-[#A98450] bg-[#FAF3E3]" : "border-[#F0EBE0]"}`}>
              <input type="radio" name="export-kind" checked={kind === k} onChange={() => setKind(k)} className="mt-1 accent-[#A98450]" />
              <span>
                <span className="block text-[12px] font-semibold text-[#27241F]">{k}</span>
                <span className="block text-[11px] text-[#777168]">{descriptions[k]}</span>
              </span>
            </label>
          ))}
        </div>
        {hasSamples && kind !== "mapping-only" && (
          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-[#E0C491] bg-[#F3EADB] px-3 py-2 text-[11px] text-[#9A5B13]">
            <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} className="mt-0.5 accent-[#9A5B13]" />
            This export includes sample payload values, which may be sensitive. I have approval to share them.
          </label>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={doExport} disabled={hasSamples && kind !== "mapping-only" && !acknowledged}>
            Download .json
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Import dialog: file → validation → preview → new / version / merge / replace. */
export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (p: MappingProject) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<ReturnType<typeof validateImport> | null>(null);
  const [existing, setExisting] = useState<MappingProject | null>(null);
  const [busy, setBusy] = useState(false);

  const check = async () => {
    const v = validateImport(text);
    setChecked(v);
    setError(v.ok ? null : v.errors.join(" "));
    if (v.ok && v.project) {
      const local = await loadProject(v.project.id).catch(() => undefined);
      setExisting(local ?? null);
    } else {
      setExisting(null);
    }
  };

  const store = async (p: MappingProject) => {
    setBusy(true);
    try {
      await saveProject(p);
      onImported(p);
    } finally {
      setBusy(false);
    }
  };

  const importAsCopy = async () => {
    if (!checked?.project) return;
    const copy = JSON.parse(JSON.stringify(checked.project)) as MappingProject;
    copy.id = uid("map");
    copy.name = `${copy.name} (imported)`;
    copy.updatedAt = new Date().toISOString();
    await store(copy);
  };

  const snapshotThen = async (incoming: MappingProject) => {
    if (!existing) return incoming;
    const now = new Date().toISOString();
    return {
      ...incoming,
      versions: [
        ...incoming.versions,
        ...existing.versions,
        {
          id: uid("ver"),
          label: `pre-import snapshot ${now}`,
          createdAt: now,
          summary: "Local state before importing the revised file.",
          mappings: existing.mappings,
          decisions: existing.decisions,
          recordPlans: existing.recordPlans,
          relationships: existing.relationships,
          fingerprint: existing.sfSnapshot?.fingerprint ?? "",
        },
      ],
    };
  };

  const replace = async () => {
    if (!checked?.project) return;
    await store(await snapshotThen(checked.project));
  };

  const merge = async () => {
    if (!checked?.project || !existing) return;
    const { merged } = mergeNonConflicting(existing, checked.project);
    await store(await snapshotThen(merged));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-label="Import project">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#E8E2D8] bg-white p-5">
        <p className="text-[14px] font-semibold text-[#27241F]">Import Project Configuration</p>
        {!checked?.ok && (
          <>
            <label className="mt-3 block text-[12px] font-semibold text-[#27241F]">
              Paste project JSON or load a file
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                spellCheck={false}
                placeholder='{"format": "gravenx-mapping-project", …}'
                className="mt-1 w-full rounded-lg border border-[#E8E2D8] bg-[#FCFBF8] p-2.5 font-mono text-[11px] focus:border-[#A98450] focus:outline-none"
              />
            </label>
            <div className="mt-2 flex items-center gap-2">
              <label className="cursor-pointer rounded-lg border border-[#E8E2D8] px-2.5 py-1.5 text-[12px] font-semibold text-[#777168] hover:text-[#27241F]">
                Choose file…
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const r = new FileReader();
                    r.onload = () => setText(String(r.result ?? ""));
                    r.readAsText(f);
                  }}
                />
              </label>
              <span className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button disabled={!text.trim()} onClick={() => void check()}>
                  Validate
                </Button>
              </span>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {error}
          </p>
        )}
        {checked?.ok && checked.preview && checked.project && (
          <div className="mt-3 space-y-3">
            <div className="rounded-xl border border-[#BFD9C6] bg-[#E9F3EC] px-3 py-2.5">
              <p className="text-[13px] font-semibold text-[#27241F]">{checked.preview.name}</p>
              <p className="font-mono text-[11px] text-[#2F7D4F]">
                {checked.preview.mappings} mappings · {checked.preview.plans} plans · {checked.preview.decisions} decisions · {checked.preview.objects} snapshot objects
                {checked.preview.fingerprint ? ` · ${checked.preview.fingerprint}` : ""}
              </p>
              {checked.preview.warnings.map((w) => (
                <p key={w} className="mt-0.5 text-[11px] text-[#8A6A2F]">
                  ⚠ {w}
                </p>
              ))}
            </div>
            {existing ? (
              <div className="rounded-xl border border-[#E0C491] bg-[#FFFEFB] p-3">
                <p className="text-[12px] font-semibold text-[#27241F]">
                  A local project with the same ID exists (“{existing.name}”). Compare, don’t overwrite blindly.
                </p>
                <ul className="mt-2 max-h-[220px] space-y-1 overflow-y-auto">
                  {compareProjects(existing, checked.project).map((c) => (
                    <li key={c.key} className={`rounded-lg border px-2 py-1.5 text-[11px] ${c.conflict ? "border-[#E5B8B2] bg-[#F9E8E6]" : "border-[#F0EBE0] bg-[#FAF8F2]"}`}>
                      <span className="font-semibold text-[#27241F]">
                        {c.conflict ? "⚠ conflict" : "+ mergeable"} · {c.label}
                      </span>
                      <span className="block font-mono text-[10px] text-[#777168]">local: {c.local}</span>
                      <span className="block font-mono text-[10px] text-[#777168]">incoming: {c.incoming}</span>
                    </li>
                  ))}
                  {compareProjects(existing, checked.project).length === 0 && (
                    <li className="text-[11px] text-[#2F7D4F]">Identical - nothing to merge.</li>
                  )}
                </ul>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="sm" disabled={busy} onClick={() => void merge()}>
                    Merge non-conflicting
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void importAsCopy()}>
                    Open as separate copy
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void replace()}>
                    Replace local (keeps version snapshot)
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button disabled={busy} onClick={() => void store(checked.project!)}>
                  Import as new project
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
