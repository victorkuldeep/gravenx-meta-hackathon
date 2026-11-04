"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import { C4_VIEWS, c4Tree, hiddenNodeIds, levelOf, type C4Level, type C4TreeNode, type C4View } from "@/lib/c4/views";
import { suggestC4, type C4Suggestion } from "@/lib/c4/suggest";
import { buildPackMarkdown } from "@/lib/pack/bundle";
import { listSequences } from "@/lib/sequence/store";
import { listDecisions } from "@/lib/decisions/store";
import { listRequirements } from "@/lib/requirements/store";
import { listSystemRuns } from "@/lib/system-design/runStore";
import type { SystemProject } from "@/lib/system-design/model";

/**
 * C4 Views dialog: assign context/container/component levels (with parents)
 * and preview the hierarchy. The view tabs project the same canvas -
 * one model, many diagrams. Unleveled projects show everything everywhere.
 */
export function ViewsDialog({
  project,
  view,
  onViewChange,
  onMutate,
  onClose,
}: {
  project: SystemProject;
  view: C4View;
  onViewChange: (v: C4View) => void;
  onMutate: (fn: (p: SystemProject) => SystemProject) => void;
  onClose: () => void;
}) {
  const tree = useMemo(() => c4Tree(project), [project]);
  const visible = project.systems.length - hiddenNodeIds(project, view).size;
  const [suggestOpen, setSuggestOpen] = useState(false);
  const suggestions = useMemo(() => (suggestOpen ? suggestC4(project) : []), [suggestOpen, project]);
  const fillCount = suggestions.filter((g) => g.level && !g.alreadySet).length;

  /** Accept fills unset levels (and unset parents of new components) only - explicit choices never move. */
  const acceptSuggestions = (list: C4Suggestion[]) => {
    onMutate((p) => ({
      ...p,
      systems: p.systems.map((s) => {
        const g = list.find((x) => x.id === s.id);
        if (!g || !g.level || s.level !== undefined) return s;
        let next = { ...s, level: g.level };
        if (g.level === "component" && s.parentId === undefined && g.parentId) {
          next = { ...next, parentId: g.parentId };
        }
        return next;
      }),
    }));
    setSuggestOpen(false);
  };

  const setLevel = (id: string, level: C4Level | undefined) => {
    onMutate((p) => ({
      ...p,
      systems: p.systems.map((s) =>
        s.id === id ? { ...s, level, parentId: level === "context" ? undefined : s.parentId } : s,
      ),
    }));
  };

  const setParent = (id: string, parentId: string | undefined) => {
    onMutate((p) => ({
      ...p,
      systems: p.systems.map((s) => (s.id === id ? { ...s, parentId } : s)),
    }));
  };

  const renderTree = (nodes: C4TreeNode[], depth: number): React.ReactNode => (
    <ul className={depth === 0 ? "space-y-1" : "ml-4 mt-1 space-y-1 border-l border-[var(--color-line-soft)] pl-2"}>
      {nodes.map((n) => (
        <li key={n.id}>
          <span className="text-[12px] text-ivory-950">
            <span className="font-mono text-[9px] uppercase text-ivory-500">{n.level} · </span>
            {n.name}
          </span>
          {n.children.length > 0 && renderTree(n.children, depth + 1)}
        </li>
      ))}
    </ul>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="C4 architecture views"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
          C4 views
        </p>
        <h2 className="mt-1 text-lg font-bold text-[var(--color-ink)]">One model, many diagrams</h2>

        <div className="mt-3 flex gap-1.5" role="tablist" aria-label="Projection">
          {C4_VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              title={v.hint}
              onClick={() => onViewChange(v.id)}
              className={`cursor-pointer rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                view === v.id
                  ? "border-bronze-500 bg-bronze-100 text-ivory-950"
                  : "border-[var(--color-line)] bg-white text-ivory-600 hover:border-bronze-400"
              }`}
            >
              {v.label}
            </button>
          ))}
          <span className="ml-auto self-center font-mono text-[10px] text-ivory-500">
            {visible}/{project.systems.length} visible
          </span>
        </div>

        <div className="mt-3 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-3">
          <p className="font-mono text-[9px] uppercase tracking-[2px] text-[var(--color-muted)]">Hierarchy</p>
          <div className="mt-1">{renderTree(tree, 0)}</div>
        </div>

        <div className="mt-3">
          <div className="flex items-center gap-2">
            <p className="font-mono text-[9px] uppercase tracking-[2px] text-[var(--color-muted)]">Assign levels</p>
            <div className="ml-auto">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSuggestOpen((v) => !v)}
                aria-expanded={suggestOpen}
                title="Preview deterministic level + parent suggestions from topology and system type - fills unset only"
              >
                {suggestOpen ? "Hide suggestions" : "Suggest"}
              </Button>
            </div>
          </div>
          {suggestOpen && (
            <div className="mt-1.5 rounded-xl border border-bronze-500/40 bg-bronze-500/5 p-2.5">
              <ul className="space-y-1.5">
                {suggestions.map((g) => {
                  const parentName = g.parentId ? (project.systems.find((x) => x.id === g.parentId)?.name ?? g.parentId) : null;
                  return (
                    <li key={g.id} className="text-[11px] leading-snug">
                      <span className="font-bold text-ivory-950">{g.name}</span>
                      {" → "}
                      {g.level ? (
                        <span className="font-mono font-bold text-bronze-700">
                          {g.level}{parentName ? ` inside ${parentName}` : ""}
                        </span>
                      ) : (
                        <span className="font-mono text-ivory-500">no suggestion</span>
                      )}
                      <span className="text-ivory-600"> · {g.rationale}</span>
                      {g.alreadySet && g.level && <span className="font-mono text-[10px] text-[#2F6B45]"> · yours kept</span>}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 flex items-center gap-1.5">
                <Button size="sm" disabled={fillCount === 0} onClick={() => acceptSuggestions(suggestions)} title="Fill unset levels (and unset parents) from these suggestions">
                  Accept fills{fillCount > 0 ? ` (${fillCount})` : ""}
                </Button>
                <span className="font-mono text-[10px] text-ivory-500">explicit levels never move · per-node Unset undoes</span>
              </div>
            </div>
          )}
          <ul className="mt-1.5 space-y-1.5">
            {project.systems.map((s) => (
              <li key={s.id} className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] text-ivory-950">{s.name}</span>
                <select
                  value={s.level ?? ""}
                  onChange={(e) => setLevel(s.id, (e.target.value || undefined) as C4Level | undefined)}
                  aria-label={`Level for ${s.name}`}
                  className="cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-1.5 py-1 text-[11px] text-ivory-950 focus:border-bronze-500 focus:outline-none"
                >
                  <option value="">Unset</option>
                  <option value="context">Context</option>
                  <option value="container">Container</option>
                  <option value="component">Component</option>
                </select>
                {(s.level ?? levelOf(project, s.id)) !== "context" && (
                  <select
                    value={s.parentId ?? ""}
                    onChange={(e) => setParent(s.id, e.target.value || undefined)}
                    aria-label={`Parent for ${s.name}`}
                    title="Parent container (or context)"
                    className="max-w-[130px] cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-1.5 py-1 text-[11px] text-ivory-950 focus:border-bronze-500 focus:outline-none"
                  >
                    <option value="">No parent</option>
                    {project.systems
                      .filter((x) => x.id !== s.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4 flex items-center justify-end gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            title="Download the architecture pack: topology, policy, sequences, decisions, requirements, risks, validation"
            onClick={() =>
              void (async () => {
                const [sequences, decisions, requirements, runs] = await Promise.all([
                  listSequences().catch(() => []),
                  listDecisions().catch(() => []),
                  listRequirements().catch(() => []),
                  listSystemRuns(100).catch(() => []),
                ]);
                const blob = new Blob([buildPackMarkdown({ project, sequences, decisions, requirements, runs })], {
                  type: "text/markdown",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.architecture-pack.md`;
                a.click();
                URL.revokeObjectURL(url);
              })()
            }
          >
            Architecture pack
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
