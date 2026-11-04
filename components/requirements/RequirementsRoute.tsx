"use client";

import { useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import { ConfirmDialog } from "../wireframe/ConfirmDialog";
import { consoleLinkHref } from "@/lib/console/model";
import { RecordWhereUsed } from "@/components/graph/WhereUsedStrip";
import { findDeepRecord, syncDeepParam, useDeepParam } from "@/lib/deep/deep";
import { DeepLinkButton } from "../ui/DeepLinkButton";
import {
  canTransition,
  linkRequirement,
  newRequirement,
  nextRequirementNumber,
  transitionRequirement,
  unlinkRequirement,
  type Requirement,
  type RequirementLinkSurface,
  type RequirementStatus,
} from "@/lib/requirements/model";
import {
  deleteRequirement,
  exportRequirements,
  importRequirements,
  listRequirements,
  saveRequirement,
} from "@/lib/requirements/store";
import { coverageOf, coverageSummary, type RequirementCoverage } from "@/lib/requirements/coverage";
import { downloadTraceabilityMatrix } from "@/lib/requirements/traceMatrix";
import { loadGraphIndex } from "@/lib/graph/load";
import { listSystemProjects } from "@/lib/system-design/store";
import { listExperiences } from "@/lib/wireframe/store";
import { listSequences } from "@/lib/sequence/store";
import { listDecisions } from "@/lib/decisions/store";

const STATUS_STYLE: Record<RequirementStatus, string> = {
  open: "border-[#E3D9C6] bg-[#F5F1E8] text-[#8A6A2F]",
  covered: "border-[#C9A86A] bg-[#FBF6EC] text-[#7A5C3A]",
  verified: "border-[#BFD9C6] bg-[#EFF6F0] text-[#2F6B45]",
};

const STATUS_LABEL: Record<RequirementStatus, string> = {
  open: "Open",
  covered: "Covered",
  verified: "Verified",
};

const NEXT_ACTIONS: Record<RequirementStatus, { to: RequirementStatus; label: string }[]> = {
  open: [{ to: "covered", label: "Mark covered" }],
  covered: [
    { to: "open", label: "Reopen" },
    { to: "verified", label: "Verify" },
  ],
  verified: [{ to: "open", label: "Reopen" }],
};

interface Candidate {
  surface: RequirementLinkSurface;
  recordId: string;
  label: string;
}

const fieldCls =
  "w-full rounded-xl border border-[#E8E2D8] bg-white px-3 py-2 text-[13px] text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none";

export function RequirementsRoute() {
  const [items, setItems] = useState<Requirement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [coverage, setCoverage] = useState<{ covered: number; total: number; uncovered: RequirementCoverage[] } | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [matrixBusy, setMatrixBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void listRequirements().then((all) => {
      if (live) {
        setItems(all);
        setLoaded(true);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // Deep link: ?id= lands on the exact record (id or REQ number).
  const deepId = useDeepParam("id");
  const deepDone = useRef(false);
  useEffect(() => {
    if (deepDone.current || !loaded || deepId === null) return;
    const hit = findDeepRecord(items, deepId);
    if (hit) {
      setActiveId(hit.id);
      deepDone.current = true;
    }
  }, [loaded, deepId, items]);

  // Keep the URL on the open requirement so it survives reloads and pastes.
  useEffect(() => {
    if (!loaded) return;
    syncDeepParam("id", activeId);
  }, [loaded, activeId]);

  const persist = async (next: Requirement) => {
    setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));
    await saveRequirement(next);
    setCoverage(null);
  };

  const create = async () => {
    const name = title.trim();
    if (!name) return;
    const r = newRequirement(name, nextRequirementNumber(items));
    setTitle("");
    setItems((prev) => [r, ...prev]);
    await saveRequirement(r);
    setActiveId(r.id);
  };

  const remove = async (id: string) => {
    setPendingDelete(null);
    if (activeId === id) setActiveId(null);
    setItems((prev) => prev.filter((i) => i.id !== id));
    await deleteRequirement(id);
    setCoverage(null);
  };

  const clone = async (r: Requirement) => {
    const copy: Requirement = {
      ...newRequirement(`${r.title} (copy)`, nextRequirementNumber(items)),
      body: r.body,
      links: r.links.map((l) => ({ ...l })),
      history: [{ at: Date.now(), what: `Cloned from ${r.number}.` }],
    };
    setItems((prev) => [copy, ...prev]);
    await saveRequirement(copy);
    setActiveId(copy.id);
    setCoverage(null);
  };

  const exportOne = (r: Requirement) => {
    const blob = new Blob([exportRequirements([r])], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${r.number.toLowerCase()}.gravenx-requirements.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importFile = async (file: File) => {
    setImportError(null);
    let text = "";
    try {
      text = await file.text();
    } catch {
      setImportError("Could not read that file.");
      return;
    }
    const res = importRequirements(text, items);
    if (res.error || res.requirements.length === 0) {
      setImportError(res.error ?? "Import failed.");
      return;
    }
    for (const d of res.requirements) await saveRequirement(d);
    setItems((prev) => [...res.requirements, ...prev].sort((a, b) => b.updatedAt - a.updatedAt));
    setCoverage(null);
  };

  const checkCoverage = async () => {
    setCoverageLoading(true);
    try {
      const index = await loadGraphIndex();
      setCoverage(coverageSummary(index, items));
    } catch {
      setCoverage({ covered: 0, total: items.length, uncovered: [] });
    } finally {
      setCoverageLoading(false);
    }
  };

  const exportMatrix = async () => {
    if (items.length === 0) return;
    setMatrixBusy(true);
    try {
      const index = await loadGraphIndex();
      const coverage = new Map(items.map((r) => [r.id, coverageOf(index, r)]));
      await downloadTraceabilityMatrix(items, coverage, "requirements-traceability.xlsx");
    } catch {
      // Download failures surface as a stuck button otherwise; reset quietly.
    } finally {
      setMatrixBusy(false);
    }
  };

  useEffect(() => {
    if (!activeId) return;
    let live = true;
    void (async () => {
      const [systems, exps, seqs, decs] = await Promise.all([
        listSystemProjects().catch(() => []),
        listExperiences().catch(() => []),
        listSequences().catch(() => []),
        listDecisions().catch(() => []),
      ]);
      if (!live) return;
      setCandidates([
        ...systems.map((p) => ({ surface: "system" as const, recordId: p.id, label: p.name })),
        ...exps.map((e) => ({ surface: "wireframe" as const, recordId: e.id, label: e.name })),
        ...seqs.map((s) => ({ surface: "sequence" as const, recordId: s.id, label: s.name })),
        ...decs.map((d) => ({ surface: "decision" as const, recordId: d.id, label: `${d.number} ${d.title}` })),
        { surface: "draw" as const, recordId: "current", label: "Draw board (current)" },
      ]);
    })();
    return () => {
      live = false;
    };
  }, [activeId]);

  const active = items.find((i) => i.id === activeId) ?? null;

  return (
    <div className="space-y-2.5">
      <div>
        {!active ? (
          <>
            <h2 className="text-center text-[15px] font-semibold text-[#27241F]">Requirements</h2>
            <p className="mx-auto mt-1 max-w-xl text-center text-xs text-[#777168]">
              Intent with receipts: each requirement links the systems, experiences, sequences,
              decisions and schema that satisfy it. Coverage is derived from the architecture -
              never hand-marked.
            </p>
            <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
              Log · Link · Cover · Verify
            </p>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setActiveId(null)} title="Back to the library">
              ← Library
            </Button>
            <span className="font-mono text-[11px] font-bold text-[#8A6A2F]">{active.number}</span>
            <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[#27241F]">{active.title}</h2>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[active.status]}`}>
              {STATUS_LABEL[active.status]}
            </span>
            <a
              href="/console"
              title="Open Console - track this requirement as tasks"
              className="inline-flex items-center rounded-lg border border-[#E3D9C6] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#3A352D] transition-colors hover:border-[#C9A86A] hover:text-[#27241F]"
            >
              Console
            </a>
          </div>
        )}
      </div>

      {!active && (
        <>
          <div className="flex gap-1.5">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void create();
              }}
              placeholder="New requirement - e.g. Customer receives order confirmation"
              aria-label="New requirement title"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-xl border border-[#E8E2D8] bg-white px-3 py-2 text-[13px] text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none"
            />
            <Button onClick={() => void create()}>New requirement</Button>
            <Button variant="secondary" onClick={() => fileRef.current?.click()} title="Import a requirements package JSON from a fellow dev">
              Import
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="Import requirements file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importFile(f);
              }}
            />
          </div>
          {importError && <p className="text-[11px] text-red-700">{importError}</p>}

          <div className="flex items-center gap-2 rounded-xl border border-[#E8E2D8] bg-white px-3 py-2">
            {coverage ? (
              <p className="text-[12px] text-[#3A352D]">
                <span className="font-bold text-[#2F6B45]">{coverage.covered}/{coverage.total} covered</span>
                {coverage.uncovered.length > 0 && (
                  <span className="ml-2 text-[#8A6A2F]">
                    without design: {coverage.uncovered.map((u) => u.number).join(" · ")}
                  </span>
                )}
              </p>
            ) : (
              <p className="text-[12px] text-[#777168]">
                Coverage is computed from the live architecture, not from statuses.
              </p>
            )}
            <Button size="sm" variant="secondary" onClick={() => void checkCoverage()} disabled={coverageLoading} title="Build the architecture graph and compute live coverage" className="ml-auto">
              {coverageLoading ? "Reading…" : coverage ? "Recheck" : "Check coverage"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void exportMatrix()} disabled={matrixBusy || items.length === 0} title="Download the traceability matrix as .xlsx">
              {matrixBusy ? "Building…" : "Matrix (.xlsx)"}
            </Button>
          </div>

          {loaded && items.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {items.map((r) => (
                <li key={r.id} className="group flex items-center gap-2 rounded-xl border border-[#E8E2D8] bg-white px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setActiveId(r.id)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    title={`Open ${r.number} ${r.title}`}
                  >
                    <span className="block truncate text-[13px] font-semibold text-[#27241F]">
                      <span className="mr-1.5 font-mono text-[11px] font-bold text-[#8A6A2F]">{r.number}</span>
                      {r.title}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-[#A39B8E]">
                      {r.links.length} link{r.links.length === 1 ? "" : "s"} ·{" "}
                      {new Date(r.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(r.id)}
                    title={`Delete ${r.number}`}
                    aria-label={`Delete ${r.number}`}
                    className="shrink-0 rounded p-1 text-[#C9BFAE] opacity-0 transition-colors cursor-pointer hover:bg-red-500/10 hover:text-red-700 group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {loaded && items.length === 0 && (
            <p className="rounded-xl border border-dashed border-[#E3D9C6] px-4 py-6 text-center text-xs text-[#777168]">
              No requirements yet - name one above and start tracing.
            </p>
          )}
        </>
      )}

      {active && (
        <RequirementEditor
          requirement={active}
          candidates={candidates}
          onPatch={(next) => void persist(next)}
          onTransition={(to) => void persist(transitionRequirement(active, to))}
          onClone={() => void clone(active)}
          onExport={() => exportOne(active)}
          onDelete={() => setPendingDelete(active.id)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this requirement?"
          message={`"${items.find((i) => i.id === pendingDelete)?.number ?? "Requirement"}" and all of its links will be removed. This cannot be undone.`}
          confirmLabel="Delete requirement"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void remove(pendingDelete)}
        />
      )}
    </div>
  );
}

function RequirementEditor({
  requirement: r,
  candidates,
  onPatch,
  onTransition,
  onClone,
  onExport,
  onDelete,
}: {
  requirement: Requirement;
  candidates: Candidate[];
  onPatch: (next: Requirement) => void;
  onTransition: (to: RequirementStatus) => void;
  onClone: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(r.body);
  const [linkRef, setLinkRef] = useState("");
  useEffect(() => setDraft(r.body), [r.id, r.body]);
  const stamp = (next: Requirement): Requirement => ({ ...next, updatedAt: Date.now() });
  const unlinked = candidates.filter(
    (c) => !r.links.some((l) => l.surface === c.surface && l.recordId === c.recordId),
  );

  return (
    <div className="grid gap-2.5 lg:grid-cols-[1fr_300px]">
      <div className="space-y-2.5">
        <label className="block">
          <span className="mb-1 block font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Intent</span>
          <textarea
            value={draft}
            rows={8}
            spellCheck={false}
            placeholder="What must hold true? Acceptance criteria, constraints, non-goals…"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== r.body) onPatch(stamp({ ...r, body: draft.slice(0, 8000) }));
            }}
            className={`${fieldCls} resize-y`}
          />
        </label>
      </div>

      <div className="space-y-2.5">
        <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
          <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Status</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {NEXT_ACTIONS[r.status]
              .filter((a) => canTransition(r.status, a.to))
              .map((a) => (
                <Button key={a.to} size="sm" variant="secondary" onClick={() => onTransition(a.to)}>
                  {a.label}
                </Button>
              ))}
          </div>
          <p className="mt-1.5 text-[11px] text-[#A39B8E]">
            Status is yours to declare; coverage is derived from live links.
          </p>
        </div>

        <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
          <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Satisfied by · links</p>
          <ul className="mt-1.5 space-y-1">
            {r.links.map((l) => (
              <li key={`${l.surface}-${l.recordId}`} className="flex items-center gap-1.5 rounded-lg border border-[#E8E2D8] px-2 py-1.5">
                <a
                  href={consoleLinkHref(l)}
                  title={`Open in ${l.surface} tab`}
                  className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#3A352D] hover:text-[#8A6A2F] hover:underline"
                >
                  {l.label}
                </a>
                <span className="shrink-0 font-mono text-[9px] uppercase text-[#A39B8E]">{l.surface}</span>
                <button
                  type="button"
                  onClick={() => onPatch(unlinkRequirement(r, l.surface, l.recordId))}
                  aria-label={`Unlink ${l.label}`}
                  className="shrink-0 cursor-pointer rounded p-1 text-[#C9BFAE] hover:bg-red-500/10 hover:text-red-700"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
          {unlinked.length > 0 ? (
            <div className="mt-1.5 flex gap-1.5">
              <select
                value={linkRef}
                onChange={(e) => setLinkRef(e.target.value)}
                aria-label="Record to link"
                className="min-w-0 flex-1 cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] text-[#27241F] focus:border-[#C9A86A] focus:outline-none"
              >
                <option value="">Link a record…</option>
                {unlinked.map((c) => (
                  <option key={`${c.surface}-${c.recordId}`} value={`${c.surface}::${c.recordId}`}>
                    [{c.surface}] {c.label}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                disabled={!linkRef}
                onClick={() => {
                  const [surface, recordId] = linkRef.split("::");
                  const c = unlinked.find((x) => x.surface === surface && x.recordId === recordId);
                  if (c) onPatch(linkRequirement(r, { surface: c.surface, recordId: c.recordId, label: c.label }));
                  setLinkRef("");
                }}
              >
                Link
              </Button>
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] text-[#A39B8E]">
              Schema records link via AI or import — the picker covers System, Wireframe, Sequence, Decisions and Draw.
            </p>
          )}
        </div>

        <RecordWhereUsed surface="requirement" recordId={r.id} />

        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={onClone} title="Duplicate this requirement and open the copy">
            Clone
          </Button>
          <Button size="sm" variant="secondary" onClick={onExport} title="Download this requirement as a portable package">
            Export
          </Button>
          <DeepLinkButton path="/requirements" param="id" value={r.id} />
          <Button size="sm" variant="secondary" onClick={onDelete} title="Delete this requirement">
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
