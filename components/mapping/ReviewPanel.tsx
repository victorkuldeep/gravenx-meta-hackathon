"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import { reviewProject } from "@/lib/mapping/diagnostics";
import { downloadCsv, downloadWorkbook, handoffCounts, mappingsTsv } from "@/lib/mapping/workbook";
import type { Decision, Diagnostic, MappingProject } from "@/lib/mapping/types";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const SEV_STYLE: Record<string, string> = {
  error: "border-[#E5B8B2] bg-[#F9E8E6] text-[#B3261E]",
  warning: "border-[#E0C491] bg-[#F3EADB] text-[#9A5B13]",
  info: "border-[#E8E2D8] bg-[#FAF8F2] text-[#777168]",
};

/** Review dashboard + decision register + handoff exports. */
export function ReviewPanel({
  project,
  onMutate,
  onFocus,
}: {
  project: MappingProject;
  onMutate: (fn: (p: MappingProject) => MappingProject) => void;
  onFocus: (sourcePath: string | null) => void;
}) {
  const [category, setCategory] = useState("all");
  const [decOpen, setDecOpen] = useState(false);
  const [decTitle, setDecTitle] = useState("");
  const [decDesc, setDecDesc] = useState("");
  const [copied, setCopied] = useState(false);
  const [authorName, setAuthorName] = useState(project.authorName ?? "");

  const findings = useMemo(() => reviewProject(project), [project]);
  const counts = useMemo(() => handoffCounts(project, findings), [project, findings]);

  const categories = useMemo(() => ["all", ...new Set(findings.map((f) => f.category))].sort(), [findings]);
  const visible = category === "all" ? findings : findings.filter((f) => f.category === category);

  const readiness =
    counts.errors > 0
      ? "Mapping incomplete"
      : counts.openDecisions > 0 || counts.warnings > 0
        ? "Decisions outstanding"
        : counts.unmapped > 0
          ? "Mapping incomplete"
          : "Ready for architecture review";

  const addDecision = () => {
    if (!decTitle.trim()) return;
    const now = new Date().toISOString();
    const d: Decision = {
      id: uid("dec"),
      title: decTitle.trim(),
      description: decDesc.trim() || undefined,
      sourcePaths: [],
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    onMutate((p) => ({ ...p, decisions: [...p.decisions, d] }));
    setDecTitle("");
    setDecDesc("");
    setDecOpen(false);
  };

  const copyTsv = async () => {
    const { text, count } = mappingsTsv(project);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
    void count;
  };

  const inputCls = "w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none";

  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      {/* Review findings */}
      <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Review</p>
          <span className="rounded-md border border-[#211F1B] bg-[#211F1B] px-2 py-0.5 font-mono text-[10px] font-semibold text-white">
            {readiness}
          </span>
          <span className="ml-auto font-mono text-[10px] text-[#A39B8E]">
            {counts.mapped} mapped · {counts.unmapped} unmapped · {counts.errors} errors · {counts.warnings} warnings · {counts.openDecisions} open decisions
          </span>
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category" className="mb-2 cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1 text-[11px]">
          {categories.map((c) => (
            <option key={c} value={c}>
              {c} ({c === "all" ? findings.length : findings.filter((f) => f.category === c).length})
            </option>
          ))}
        </select>
        <ul className="max-h-[380px] space-y-1.5 overflow-y-auto">
          {visible.slice(0, 300).map((f: Diagnostic) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => f.sourcePath && onFocus(f.sourcePath)}
                title={f.sourcePath ? `Focus ${f.sourcePath}` : undefined}
                className={`w-full rounded-lg border px-2.5 py-1.5 text-left text-[11px] ${SEV_STYLE[f.severity]} ${f.sourcePath ? "cursor-pointer" : ""}`}
              >
                <span className="font-mono font-semibold">[{f.severity}] {f.category}</span>
                <span className="block">{f.message}</span>
                {f.action && <span className="block opacity-80">↳ {f.action}</span>}
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="text-[12px] text-[#2F7D4F]">Clean - no findings in this category.</li>}
        </ul>
      </div>

      <div className="space-y-3">
        {/* Decision register */}
        <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
              Decisions · {project.decisions.length}
            </p>
            <Button size="sm" variant="ghost" onClick={() => setDecOpen((v) => !v)}>
              {decOpen ? "Cancel" : "Log decision"}
            </Button>
          </div>
          {decOpen && (
            <div className="mb-2 space-y-2 rounded-lg border border-[#F0EBE0] bg-[#FAF8F2] p-2.5">
              <input value={decTitle} onChange={(e) => setDecTitle(e.target.value)} placeholder="Question (e.g. Does relatedParty.id resolve to Account external ID?)" aria-label="Decision question" className={inputCls} />
              <input value={decDesc} onChange={(e) => setDecDesc(e.target.value)} placeholder="Context (optional)" aria-label="Decision context" className={inputCls} />
              <span className="flex justify-end">
                <Button size="sm" disabled={!decTitle.trim()} onClick={addDecision}>
                  Add as open
                </Button>
              </span>
            </div>
          )}
          <ul className="max-h-[220px] space-y-1.5 overflow-y-auto">
            {project.decisions.map((d) => (
              <li key={d.id} className="rounded-lg border border-[#F0EBE0] px-2.5 py-1.5">
                <p className="text-[12px] font-semibold text-[#27241F]">{d.title}</p>
                {d.description && <p className="text-[11px] text-[#777168]">{d.description}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {(["open", "decided", "deferred"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() =>
                        onMutate((p) => ({ ...p, decisions: p.decisions.map((x) => (x.id === d.id ? { ...x, status: s, updatedAt: new Date().toISOString() } : x)) }))
                      }
                      aria-pressed={d.status === s}
                      className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold cursor-pointer ${d.status === s ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] text-[#777168]"}`}
                    >
                      {s}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => onMutate((p) => ({ ...p, decisions: p.decisions.filter((x) => x.id !== d.id) }))}
                    aria-label={`Remove decision ${d.title}`}
                    className="ml-auto rounded px-1 text-[11px] text-[#B3261E] hover:bg-[#F9E8E6] cursor-pointer"
                  >
                    remove
                  </button>
                </div>
                {d.status !== "open" && (
                  <input
                    defaultValue={d.decision ?? ""}
                    onBlur={(e) =>
                      onMutate((p) => ({ ...p, decisions: p.decisions.map((x) => (x.id === d.id ? { ...x, decision: e.target.value, updatedAt: new Date().toISOString() } : x)) }))
                    }
                    placeholder="Record the decision…"
                    aria-label="Decision outcome"
                    className={`${inputCls} mt-1.5`}
                  />
                )}
              </li>
            ))}
            {project.decisions.length === 0 && <li className="text-[12px] text-[#A39B8E]">No decisions logged.</li>}
          </ul>
        </div>

        {/* Handoff */}
        <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Handoff</p>
          <label className="mb-2 block text-[11px] text-[#777168]">
            Author display name (optional, used in change log)
            <input
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              onBlur={() => onMutate((p) => ({ ...p, authorName: authorName.trim() || undefined }))}
              placeholder="e.g. Kuldeep"
              className={`${inputCls} mt-1`}
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              onClick={() => {
                if (authorName.trim() !== (project.authorName ?? "")) onMutate((p) => ({ ...p, authorName: authorName.trim() || undefined }));
                void downloadWorkbook(project, findings);
              }}
            >
              Export Excel (.xlsx)
            </Button>
            <Button size="sm" variant="ghost" onClick={() => downloadCsv(project)}>
              Export CSV
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void copyTsv()}>
              {copied ? "Copied" : "Copy as Excel"}
            </Button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-[#A39B8E]">
            Workbook: summary, field mappings, record plans, relationships, decisions, schema snapshot, change log. Design-time artifact only.
          </p>
        </div>
      </div>
    </div>
  );
}
