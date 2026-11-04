"use client";

import { useEffect, useState } from "react";
import Button from "../ui/Button";
import type { FlowDef, SystemProject } from "@/lib/system-design/model";
import { listSystemProjects, loadSystemProject } from "@/lib/system-design/store";
import { flowToStatements, projectToStatements } from "@/lib/sequence/systemBridge";

/**
 * System import dialog (EPIC 05): pick a project, then a flow for
 * lane-accurate statements or the whole topology. Operation bindings and
 * mocks stay behind - the preview states exactly what transfers.
 */
export function SystemImportDialog({ onClose, onImport }: { onClose: () => void; onImport: (statements: string) => void }) {
  const [projects, setProjects] = useState<{ id: string; name: string; updatedAt: number }[]>([]);
  const [projectId, setProjectId] = useState("");
  const [flowId, setFlowId] = useState("__all__");
  const [project, setProject] = useState<SystemProject | null>(null);

  useEffect(() => {
    void listSystemProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (!projectId) {
      setProject(null);
      return;
    }
    void loadSystemProject(projectId)
      .then((p) => {
        setProject(p);
        setFlowId("__all__");
      })
      .catch(() => setProject(null));
  }, [projectId]);
  const flow: FlowDef | null = project?.flows.find((f) => f.id === flowId) ?? null;
  const preview = project ? (flow ? flowToStatements(project, flow) : projectToStatements(project)) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Import from System Design"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
          From System Design
        </p>
        <h2 className="mt-1 text-lg font-bold text-[var(--color-ink)]">Import topology</h2>

        <div className="mt-3 space-y-2">
          <div>
            <label className="mb-1 block font-mono text-[10px] uppercase tracking-[1.5px] text-[#A39B8E]" htmlFor="seq-imp-proj">
              Project
            </label>
            <select
              id="seq-imp-proj"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setFlowId("__all__");
              }}
              className="w-full cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-xs text-[#27241F] focus:border-[#C9A86A] focus:outline-none"
            >
              <option value="">Select a project…</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {project && (
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-[1.5px] text-[#A39B8E]" htmlFor="seq-imp-flow">
                Flow (lanes) or whole project
              </label>
              <select
                id="seq-imp-flow"
                value={flowId}
                onChange={(e) => setFlowId(e.target.value)}
                className="w-full cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-xs text-[#27241F] focus:border-[#C9A86A] focus:outline-none"
              >
                <option value="__all__">Whole project - every connection</option>
                {project.flows.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} - replayable path
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {preview && (
          <pre className="mt-3 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[#E8E2D8] bg-white p-3 font-mono text-[11px] leading-relaxed text-[#27241F]">
            {preview.statements || "(nothing to import)"}
            {preview.warnings.length > 0 && `\n\n# ${preview.warnings.join("\n# ")}`}
          </pre>
        )}

        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            disabled={!preview || !preview.statements}
            onClick={() => {
              if (preview?.statements) onImport(preview.statements);
            }}
          >
            Append statements
          </Button>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
