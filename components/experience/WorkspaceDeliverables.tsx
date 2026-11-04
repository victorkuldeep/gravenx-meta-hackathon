"use client";

import { useState } from "react";
import Button from "../ui/Button";
import { getAssetRecord, saveAssetRecord } from "@/lib/experience/assets";
import {
  apiCatalogCsv,
  buildWordPack,
  downloadExperienceWorkbook,
  downloadText,
  screenApiMatrixCsv,
  screenApiMatrixTsv,
  type DocCross,
} from "@/lib/experience/deliverables";
import { downloadSignoff } from "@/lib/experience/signoff";
import {
  downloadBlob,
  exportWorkspaceZip,
  extractWorkspaceAssets,
  inspectWorkspace,
  remapWorkspaceImport,
  type WorkspaceInspect,
} from "@/lib/experience/package";
import { saveStudio } from "@/lib/studio/store";
import { saveProject } from "@/lib/mapping/store";
import { listExperiences, saveExperience } from "@/lib/wireframe/store";
import { spineMarkExported } from "@/lib/studio/spine";
import type { MappingProject } from "@/lib/mapping/types";
import type { StudioProject } from "@/lib/studio/types";

/** Workspace deliverables: portable ZIP + architecture documents. */
export function WorkspaceDeliverables({
  root,
  childMaps,
  cross,
  onImported,
}: {
  root: StudioProject;
  childMaps: MappingProject[];
  cross: DocCross;
  onImported: (root: StudioProject, mappings: MappingProject[]) => void;
}) {
  const [exportBusy, setExportBusy] = useState(false);
  const [docBusy, setDocBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [checked, setChecked] = useState<WorkspaceInspect | null>(null);
  const [checkedFile, setCheckedFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBlob = async (key: string): Promise<Blob | null> => {
    try {
      return (await getAssetRecord(key))?.blob ?? null;
    } catch {
      return null;
    }
  };

  const doExport = async () => {
    setExportBusy(true);
    try {
      const referenced = new Set((root.experience?.screens ?? []).flatMap((s) => (s.wireframeRef ? [s.wireframeRef.experienceId] : [])));
      const wireframes = referenced.size > 0 ? (await listExperiences().catch(() => [])).filter((e) => referenced.has(e.id)) : [];
      const { blob } = await exportWorkspaceZip(root, childMaps, loadBlob, wireframes);
      const safe = root.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
      downloadBlob(blob, `${safe}.gravenx.zip`);
      spineMarkExported();
    } finally {
      setExportBusy(false);
    }
  };

  const takeFile = async (file: File | undefined) => {
    if (!file) return;
    setInspecting(true);
    setError(null);
    setChecked(null);
    setCheckedFile(file);
    try {
      const result = await inspectWorkspace(file);
      setChecked(result);
      if (!result.ok) setError(result.errors.join(" "));
    } finally {
      setInspecting(false);
    }
  };

  const importConfirmed = async () => {
    if (!checked?.ok || !checked.root || !checked.manifest || !checkedFile) return;
    setImportBusy(true);
    try {
      const { root: freshRoot, mappings, wireframes } = remapWorkspaceImport(checked.root, checked.mappings ?? [], checked.wireframes ?? []);
      for (const w of wireframes) {
        await saveExperience(w).catch(() => undefined);
      }
      const assets = await extractWorkspaceAssets(checkedFile, checked.manifest);
      for (const a of assets) {
        await saveAssetRecord({ id: a.storageKey, projectId: freshRoot.id, assetId: a.storageKey, blob: a.blob, thumbnail: a.thumbnail ?? undefined }).catch(() => undefined);
      }
      for (const m of mappings) {
        await saveProject(m).catch(() => undefined);
      }
      await saveStudio(freshRoot);
      onImported(freshRoot, mappings);
      setChecked(null);
      setCheckedFile(null);
    } finally {
      setImportBusy(false);
    }
  };

  const safe = root.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";

  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="rounded-xl border border-[#E8E2D8] bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Portable workspace ZIP</p>
          <p className="mt-1 font-mono text-[11px] text-[#777168]">
            {childMaps.length} mappings · {root.experience?.screens.length ?? 0} screens · {root.apiCatalog?.operations.length ?? 0} operations · linked wireframes bundle automatically · imports as a NEW project, nothing overwritten.
          </p>
          <div className="mt-3">
            <Button size="sm" disabled={exportBusy} onClick={() => void doExport()}>
              {exportBusy ? "Packaging…" : "Download .zip"}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-[#E8E2D8] bg-white p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Architecture documents</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Button
              size="sm"
              disabled={docBusy}
              onClick={() =>
                void (async () => {
                  setDocBusy(true);
                  try {
                    const blob = await buildWordPack(root, loadBlob);
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${safe}-architecture-pack.docx`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } finally {
                    setDocBusy(false);
                  }
                })()
              }
            >
              {docBusy ? "Building…" : "Word pack (.docx)"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void downloadExperienceWorkbook(root, cross)}>
              Excel workbook (.xlsx)
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={docBusy || (root.experience?.screens.length ?? 0) === 0}
              onClick={() =>
                void (async () => {
                  if (!root.experience) return;
                  setDocBusy(true);
                  try {
                    await downloadSignoff(root.name, root.experience, `${safe}-screen-signoff.xlsx`);
                  } finally {
                    setDocBusy(false);
                  }
                })()
              }
              title="Screen inventory with blank approval columns for countersignature"
            >
              Sign-off (.xlsx)
            </Button>
            <Button size="sm" variant="ghost" onClick={() => downloadText(apiCatalogCsv(root), `${safe}-api-catalog.csv`, "text/csv")}>
              API CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={() => downloadText(screenApiMatrixCsv(root), `${safe}-screen-api-matrix.csv`, "text/csv")}>
              Matrix CSV
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(screenApiMatrixTsv(root).text);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1600);
                  } catch {
                    /* clipboard unavailable */
                  }
                })()
              }
            >
              {copied ? "Copied" : "Copy matrix"}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#E8E2D8] bg-white p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Import workspace ZIP</p>
        <label className="mt-2 block cursor-pointer rounded-xl border border-dashed border-[#D8CFC0] bg-[#FAF8F2] p-4 text-center text-[12px] text-[#777168] hover:border-[#A98450]">
          Choose a .zip package…
          <input
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              void takeFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {inspecting && <p className="mt-2 text-[12px] text-[#A39B8E]">Inspecting package…</p>}
        {error && (
          <p role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {error}
          </p>
        )}
        {checked?.ok && checked.manifest && (
          <div className="mt-2 rounded-xl border border-[#BFD9C6] bg-[#E9F3EC] p-3">
            <p className="text-[13px] font-semibold text-[#27241F]">{checked.manifest.workspace.name}</p>
            <p className="font-mono text-[11px] text-[#2F7D4F]">
              {checked.manifest.counts.mappings} mappings · {checked.manifest.counts.screens} screens · {checked.manifest.assets.length} images · {checked.manifest.counts.operations} operations · {checked.manifest.counts.wireframes ?? 0} wireframes
            </p>
            {checked.warnings.map((w) => (
              <p key={w} className="mt-0.5 text-[11px] text-[#8A6A2F]">
                ⚠ {w}
              </p>
            ))}
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setChecked(null); setCheckedFile(null); }}>
                Cancel
              </Button>
              <Button size="sm" disabled={importBusy} onClick={() => void importConfirmed()}>
                {importBusy ? "Importing…" : "Import as new project"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
