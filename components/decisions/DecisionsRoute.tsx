"use client";

import { useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import { ConfirmDialog } from "../wireframe/ConfirmDialog";
import {
  canTransition,
  linkDecision,
  newDecision,
  nextDecisionNumber,
  transitionDecision,
  unlinkDecision,
  type Decision,
  type DecisionLinkSurface,
  type DecisionStatus,
} from "@/lib/decisions/model";
import {
  deleteDecision,
  exportDecisions,
  importDecisions,
  listDecisions,
  saveDecision,
} from "@/lib/decisions/store";
import { downloadGovernancePack } from "@/lib/decisions/adrLog";
import { RichTextEditor } from "../notes/RichTextEditor";
import { consoleLinkHref } from "@/lib/console/model";
import { RecordWhereUsed } from "@/components/graph/WhereUsedStrip";
import { findDeepRecord, syncDeepParam, useDeepParam } from "@/lib/deep/deep";
import { DeepLinkButton } from "../ui/DeepLinkButton";
import { listSystemProjects } from "@/lib/system-design/store";
import { listExperiences } from "@/lib/wireframe/store";
import { listSequences } from "@/lib/sequence/store";

const STATUS_STYLE: Record<DecisionStatus, string> = {
  proposed: "border-[#E3D9C6] bg-[#F5F1E8] text-[#8A6A2F]",
  "in-review": "border-[#C9A86A] bg-[#FBF6EC] text-[#7A5C3A]",
  accepted: "border-[#BFD9C6] bg-[#EFF6F0] text-[#2F6B45]",
  deprecated: "border-[#E3D9C6] bg-white text-[#A39B8E]",
  superseded: "border-[#E3D9C6] bg-white text-[#A39B8E]",
};

const STATUS_LABEL: Record<DecisionStatus, string> = {
  proposed: "Proposed",
  "in-review": "In review",
  accepted: "Accepted",
  deprecated: "Deprecated",
  superseded: "Superseded",
};

const NEXT_ACTIONS: Record<DecisionStatus, { to: DecisionStatus; label: string }[]> = {
  proposed: [{ to: "in-review", label: "Submit for review" }],
  "in-review": [
    { to: "proposed", label: "Request changes" },
    { to: "accepted", label: "Accept" },
  ],
  accepted: [
    { to: "deprecated", label: "Deprecate" },
    { to: "superseded", label: "Supersede" },
  ],
  deprecated: [{ to: "proposed", label: "Re-propose" }],
  superseded: [],
};

function nextActions(status: DecisionStatus): { to: DecisionStatus; label: string }[] {
  return NEXT_ACTIONS[status].filter((a) => canTransition(status, a.to));
}

interface Candidate {
  surface: DecisionLinkSurface;
  recordId: string;
  label: string;
}

export function DecisionsRoute() {
  const [items, setItems] = useState<Decision[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [packBusy, setPackBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void listDecisions().then((all) => {
      if (live) {
        setItems(all);
        setLoaded(true);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // Deep link: ?id= lands on the exact record (id or ADR number).
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

  // Keep the URL on the open decision so it survives reloads and pastes.
  useEffect(() => {
    if (!loaded) return;
    syncDeepParam("id", activeId);
  }, [loaded, activeId]);

  /** Every write funnels through here so a failed save is visible, never silent. */
  const recordSave = async (d: Decision): Promise<boolean> => {
    setSaveState("saving");
    const ok = await saveDecision(d);
    setSaveState(ok ? "saved" : "failed");
    return ok;
  };

  const persist = async (next: Decision) => {
    setItems((prev) => prev.map((i) => (i.id === next.id ? next : i)));
    await recordSave(next);
  };

  const create = async () => {
    const name = title.trim();
    if (!name) return;
    const d = newDecision(name, nextDecisionNumber(items));
    setTitle("");
    setItems((prev) => [d, ...prev]);
    await recordSave(d);
    setActiveId(d.id);
  };

  const remove = async (id: string) => {
    setPendingDelete(null);
    if (activeId === id) setActiveId(null);
    setItems((prev) => prev.filter((i) => i.id !== id));
    await deleteDecision(id);
  };

  const clone = async (d: Decision) => {
    const copy: Decision = {
      ...newDecision(`${d.title} (copy)`, nextDecisionNumber(items)),
      context: d.context,
      decision: d.decision,
      alternatives: d.alternatives.map((a) => ({ ...a })),
      consequences: d.consequences,
      links: d.links.map((l) => ({ ...l })),
      history: [{ at: Date.now(), what: `Cloned from ${d.number}.` }],
    };
    setItems((prev) => [copy, ...prev]);
    await recordSave(copy);
    setActiveId(copy.id);
  };

  const exportOne = (d: Decision) => {
    const blob = new Blob([exportDecisions([d])], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${d.number.toLowerCase()}.gravenx-decisions.json`;
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
    const r = importDecisions(text, items);
    if (r.error || r.decisions.length === 0) {
      setImportError(r.error ?? "Import failed.");
      return;
    }
    for (const d of r.decisions) await recordSave(d);
    setItems((prev) => [...r.decisions, ...prev].sort((a, b) => b.updatedAt - a.updatedAt));
  };

  /** Load link candidates (named records across surfaces) when the editor opens. */
  useEffect(() => {
    if (!activeId) return;
    let live = true;
    void (async () => {
      const [systems, exps, seqs] = await Promise.all([
        listSystemProjects().catch(() => []),
        listExperiences().catch(() => []),
        listSequences().catch(() => []),
      ]);
      if (!live) return;
      setCandidates([
        ...systems.map((p) => ({ surface: "system" as const, recordId: p.id, label: p.name })),
        ...exps.map((e) => ({ surface: "wireframe" as const, recordId: e.id, label: e.name })),
        ...seqs.map((s) => ({ surface: "sequence" as const, recordId: s.id, label: s.name })),
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
            <h2 className="text-center text-[15px] font-semibold text-[#27241F]">Decision Studio</h2>
            <p className="mx-auto mt-1 max-w-xl text-center text-xs text-[#777168]">
              Architecture Decision Records linked to the systems, APIs, sequences and
              experiences they govern. Decide once, trace everywhere.
            </p>
            <p className="mt-2 flex items-center justify-center gap-2 text-center font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
              Propose · Review · Accept
              <SavePill state={saveState} />
            </p>
          </>
        ) : (
          <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <Button size="sm" variant="ghost" onClick={() => setActiveId(null)} title="Back to the library">
                ← Library
              </Button>
              <span className="rounded-md bg-[#F5F1E8] px-2 py-1 font-mono text-[12px] font-bold text-[#8A6A2F]">{active.number}</span>
              <span className="ml-auto flex items-center gap-2">
                <SavePill state={saveState} />
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${STATUS_STYLE[active.status]}`}>
                  {STATUS_LABEL[active.status]}
                </span>
                <a
                  href="/console"
                  title="Open Console - track this decision as tasks"
                  className="inline-flex items-center rounded-lg border border-[#E3D9C6] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#3A352D] transition-colors hover:border-[#C9A86A] hover:text-[#27241F]"
                >
                  Console
                </a>
              </span>
            </div>
            <TitleInput
              key={active.id}
              title={active.title}
              large
              onDone={(t) => void persist({ ...active, title: t, updatedAt: Date.now() })}
            />
            <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
              Architecture Decision Record · updated {new Date(active.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </p>
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
              placeholder="New decision - e.g. Middleware owns orchestration"
              aria-label="New decision title"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-xl border border-[#E8E2D8] bg-white px-3 py-2 text-[13px] text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none"
            />
            <Button onClick={() => void create()}>New decision</Button>
            <Button variant="secondary" onClick={() => fileRef.current?.click()} title="Import a decisions package JSON from a fellow dev">
              Import
            </Button>
            <Button
              variant="secondary"
              disabled={packBusy || items.length === 0}
              onClick={() => {
                setPackBusy(true);
                void downloadGovernancePack(items, "governance-pack.xlsx").finally(() => setPackBusy(false));
              }}
              title="Download the ADR log plus NFR and deployment checklists as .xlsx"
            >
              {packBusy ? "Building…" : "Pack (.xlsx)"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="Import decisions file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void importFile(f);
              }}
            />
          </div>
          {importError && <p className="text-[11px] text-red-700">{importError}</p>}

          {loaded && items.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {items.map((d) => (
                <li key={d.id} className="group flex items-center gap-2 rounded-xl border border-[#E8E2D8] bg-white px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setActiveId(d.id)}
                    className="min-w-0 flex-1 cursor-pointer text-left"
                    title={`Open ${d.number} ${d.title}`}
                  >
                    <span className="block truncate text-[14px] font-semibold text-[#27241F]">
                      <span className="mr-1.5 font-mono text-[11px] font-bold text-[#8A6A2F]">{d.number}</span>
                      {d.title}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-[#A39B8E]">
                      {d.links.length} link{d.links.length === 1 ? "" : "s"} ·{" "}
                      {new Date(d.updatedAt).toLocaleDateString()}
                    </span>
                  </button>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATUS_STYLE[d.status]}`}>
                    {STATUS_LABEL[d.status]}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(d.id)}
                    title={`Delete ${d.number}`}
                    aria-label={`Delete ${d.number}`}
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
              No decisions yet - name one above and start deciding.
            </p>
          )}
        </>
      )}

      {active && (
        <DecisionEditor
          decision={active}
          items={items}
          candidates={candidates}
          onPatch={(next) => void persist(next)}
          onTransition={(to, extra) => void persist(transitionDecision({ ...active, ...extra }, to))}
          onClone={() => void clone(active)}
          onExport={() => exportOne(active)}
          onDelete={() => setPendingDelete(active.id)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this decision?"
          message={`"${items.find((i) => i.id === pendingDelete)?.number ?? "Decision"}" and all of its links will be removed. This cannot be undone.`}
          confirmLabel="Delete decision"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void remove(pendingDelete)}
        />
      )}
    </div>
  );
}

/** IndexedDB write state: a failed save must shout, never vanish on reload. */
function SavePill({ state }: { state: "idle" | "saving" | "saved" | "failed" }) {
  if (state === "idle") return null;
  if (state === "saving") return <span className="font-mono text-[10px] text-[#A39B8E]">Saving…</span>;
  if (state === "saved")
    return (
      <span className="font-mono text-[10px] font-bold text-[#2F6B45]" title="Written to this browser's IndexedDB">
        Saved ✓
      </span>
    );
  return (
    <span
      className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 font-mono text-[10px] font-bold text-red-700"
      title="IndexedDB write failed - see DevTools console for [decisions]. Private windows and blocked storage lose data on reload."
    >
      Save failed
    </span>
  );
}

const fieldCls =
  "w-full rounded-xl border border-[#E8E2D8] bg-white px-3 py-2 text-[14px] leading-relaxed text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none";

/** Inline decision title: heading-sized input, commits on blur or Enter. */
function TitleInput({ title, large, onDone }: { title: string; large?: boolean; onDone: (t: string) => void }) {
  const [draft, setDraft] = useState(title);
  const commit = () => {
    const clean = draft.trim().slice(0, 160);
    if (clean && clean !== title) onDone(clean);
    else setDraft(title);
  };
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      aria-label="Decision title"
      spellCheck={false}
      className={`mt-2 w-full rounded-lg px-1 py-0.5 font-bold tracking-tight text-[#27241F] focus:outline-none focus:ring-1 focus:ring-[#C9A86A] ${
        large ? "text-[23px] leading-snug" : "min-w-0 flex-1 truncate text-[17px]"
      }`}
    />
  );
}

function Field({
  label,
  value,
  placeholder,
  rows = 3,
  onDone,
}: {
  label: string;
  value: string;
  placeholder: string;
  rows?: number;
  onDone: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">{label}</span>
      <textarea
        value={draft}
        rows={rows}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onDone(draft);
        }}
        className={`${fieldCls} resize-y`}
      />
    </label>
  );
}

function DecisionEditor({
  decision: d,
  items,
  candidates,
  onPatch,
  onTransition,
  onClone,
  onExport,
  onDelete,
}: {
  decision: Decision;
  items: Decision[];
  candidates: Candidate[];
  onPatch: (next: Decision) => void;
  onTransition: (to: DecisionStatus, extra?: Partial<Decision>) => void;
  onClone: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const [altTitle, setAltTitle] = useState("");
  const [supersedeId, setSupersedeId] = useState<string | null>(null);
  const [linkRef, setLinkRef] = useState("");
  const stamp = (next: Decision): Decision => ({ ...next, updatedAt: Date.now() });

  const unlinked = candidates.filter(
    (c) => !d.links.some((l) => l.surface === c.surface && l.recordId === c.recordId),
  );
  const successors = items.filter((i) => i.id !== d.id && i.status !== "superseded");

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
      <div className="space-y-3">
        <Field label="Context" value={d.context} placeholder="What forced this decision? Constraints, background…" rows={4}
          onDone={(v) => onPatch(stamp({ ...d, context: v.slice(0, 8000) }))} />
        <div>
          <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">Decision · rich text</p>
          <RichTextEditor
            key={d.id}
            value={d.decision}
            label="Decision"
            hint="What did we decide? Be concrete: names, paths, payloads…"
            onDone={(v) => onPatch(stamp({ ...d, decision: v.slice(0, 20000) }))}
          />
        </div>

        <div>
          <p className="mb-1 font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Alternatives considered</p>
          <ul className="space-y-1.5">
            {d.alternatives.map((a, i) => (
              <li key={`${a.title}-${i}`} className="flex items-center gap-1.5 rounded-xl border border-[#E8E2D8] bg-white px-2.5 py-2">
                <span className="min-w-0 flex-1 truncate text-[13px] text-[#3A352D]">
                  <span className="font-semibold">{a.title}</span>
                  {a.note && <span className="text-[#777168]"> — {a.note}</span>}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onPatch(stamp({ ...d, alternatives: d.alternatives.filter((_, j) => j !== i) }))
                  }
                  aria-label={`Remove alternative ${a.title}`}
                  className="shrink-0 cursor-pointer rounded p-1 text-[#C9BFAE] hover:bg-red-500/10 hover:text-red-700"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-1.5 flex gap-1.5">
            <input
              value={altTitle}
              onChange={(e) => setAltTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && altTitle.trim()) {
                  onPatch(stamp({ ...d, alternatives: [...d.alternatives, { title: altTitle.trim().slice(0, 200) }] }));
                  setAltTitle("");
                }
              }}
              placeholder="Rejected option - e.g. Spring Boot middleware"
              aria-label="New alternative"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-xl border border-[#E8E2D8] bg-white px-3 py-2 text-[12px] text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none"
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!altTitle.trim()}
              onClick={() => {
                onPatch(stamp({ ...d, alternatives: [...d.alternatives, { title: altTitle.trim().slice(0, 200) }] }));
                setAltTitle("");
              }}
            >
              Add
            </Button>
          </div>
        </div>

        <Field label="Consequences" value={d.consequences} placeholder="What follows? Trade-offs accepted, follow-ups required…" rows={3}
          onDone={(v) => onPatch(stamp({ ...d, consequences: v.slice(0, 8000) }))} />
      </div>

      <div className="space-y-2.5">
        <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
          <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Status</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {nextActions(d.status).map((a) =>
              a.to === "superseded" ? (
                <Button key={a.to} size="sm" variant="secondary" onClick={() => setSupersedeId((v) => (v ? null : successors[0]?.id ?? null))}>
                  {supersedeId ? "Cancel" : a.label}
                </Button>
              ) : (
                <Button key={a.to} size="sm" variant="secondary" onClick={() => onTransition(a.to)}>
                  {a.label}
                </Button>
              ),
            )}
            {d.status === "superseded" && d.supersededBy && (
              <p className="w-full text-[11px] text-[#777168]">
                Superseded by {items.find((i) => i.id === d.supersededBy)?.number ?? "another decision"}.
              </p>
            )}
          </div>
          {supersedeId !== null && (
            <div className="mt-1.5 flex gap-1.5">
              <select
                value={supersedeId ?? ""}
                onChange={(e) => setSupersedeId(e.target.value || null)}
                aria-label="Superseding decision"
                className="min-w-0 flex-1 cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] text-[#27241F] focus:border-[#C9A86A] focus:outline-none"
              >
                {successors.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.number} · {s.title}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                disabled={!supersedeId}
                onClick={() => {
                  if (supersedeId) onTransition("superseded", { supersededBy: supersedeId });
                  setSupersedeId(null);
                }}
              >
                Confirm
              </Button>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
          <p className="font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Governs · links</p>
          <ul className="mt-1.5 space-y-1">
            {d.links.map((l) => (
              <li key={`${l.surface}-${l.recordId}`} className="flex items-center gap-1.5 rounded-lg border border-[#E8E2D8] px-2 py-1.5">
                <a
                  href={consoleLinkHref(l)}
                  title={`Open in ${l.surface} tab`}
                  className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#3A352D] hover:text-[#8A6A2F] hover:underline"
                >
                  {l.label}
                </a>
                <span className="shrink-0 font-mono text-[9px] uppercase text-[#A39B8E]">{l.surface}</span>
                <button
                  type="button"
                  onClick={() => onPatch(unlinkDecision(d, l.surface, l.recordId))}
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
                  if (c) onPatch(linkDecision(d, { surface: c.surface, recordId: c.recordId, label: c.label }));
                  setLinkRef("");
                }}
              >
                Link
              </Button>
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] text-[#A39B8E]">
              Schema records link via AI or import — the picker covers System, Wireframe, Sequence and Draw.
            </p>
          )}
        </div>

        <RecordWhereUsed surface="decision" recordId={d.id} />

        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={onClone} title="Duplicate this decision and open the copy">
            Clone
          </Button>
          <Button size="sm" variant="secondary" onClick={onExport} title="Download this decision as a portable package">
            Export
          </Button>
          <DeepLinkButton path="/decisions" param="id" value={d.id} />
          <Button size="sm" variant="secondary" onClick={onDelete} title="Delete this decision">
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
