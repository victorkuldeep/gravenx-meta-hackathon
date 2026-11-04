"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import { logChange } from "@/lib/experience/migrate";
import type { StudioProject } from "@/lib/studio/types";
import type { ArchitectureDecision, ArchitectureDecisionStatus, Assumption } from "@/lib/experience/types";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const inputCls =
  "w-full rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none";

const DEC_STATUSES: ArchitectureDecisionStatus[] = ["proposed", "accepted", "rejected", "superseded", "open"];

/** Architecture decisions, assumptions/open questions, change history. */
export function DecisionsPanel({
  project,
  onMutate,
}: {
  project: StudioProject;
  onMutate: (fn: (p: StudioProject) => StudioProject) => void;
}) {
  const decisions = project.archDecisions ?? [];
  const assumptions = project.assumptions ?? [];
  const history = useMemo(() => [...(project.changeLog ?? [])].reverse().slice(0, 200), [project]);
  const [tab, setTab] = useState<"decisions" | "questions" | "history">("decisions");

  const mutateArch = (
    fn: (p: StudioProject) => StudioProject,
    entityType: string,
    entityId: string,
    changeType: string,
    summary: string
  ) => {
    onMutate((p) => {
      const next = fn(p);
      logChange(next, entityType, entityId, changeType, summary, new Date().toISOString());
      return next;
    });
  };

  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
        <div className="mb-2 flex gap-1" role="tablist" aria-label="Architecture registers">
          {(
            [
              ["decisions", `Decisions · ${decisions.length}`],
              ["questions", `Questions · ${assumptions.filter((a) => a.status === "open").length}`],
              ["history", `History · ${project.changeLog?.length ?? 0}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`rounded-md border px-2 py-1 text-[11px] font-semibold cursor-pointer ${tab === id ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] bg-white text-[#777168] hover:text-[#27241F]"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "decisions" && <DecisionList project={project} decisions={decisions} onMutate={mutateArch} />}
        {tab === "questions" && <QuestionList project={project} assumptions={assumptions} onMutate={mutateArch} />}
        {tab === "history" && (
          <ul className="max-h-[420px] space-y-1 overflow-y-auto">
            {history.map((c) => (
              <li key={c.id} className="rounded-lg border border-[#F0EBE0] px-2.5 py-1.5 text-[11px]">
                <span className="font-mono text-[#27241F]">
                  {c.timestamp.slice(0, 16).replace("T", " ")} · {c.entityType}/{c.changeType} · {c.origin}
                </span>
                <span className="block text-[#55504A]">{c.summary}</span>
              </li>
            ))}
            {history.length === 0 && <li className="text-[12px] text-[#A39B8E]">No history yet.</li>}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-[#E8E2D8] bg-[#FAF8F2] p-4 text-[12px] leading-relaxed text-[#777168]">
        <p className="font-semibold text-[#27241F]">Proposals are not approvals</p>
        <p className="mt-1">
          A <span className="font-mono">proposed</span> decision or binding is an architect&apos;s suggestion until someone
          explicitly accepts or confirms it. Imports never flip a status silently - conflicts surface in the compare view instead.
        </p>
      </div>
    </div>
  );
}

function DecisionList({
  decisions,
  onMutate,
}: {
  project: StudioProject;
  decisions: ArchitectureDecision[];
  onMutate: (fn: (p: StudioProject) => StudioProject, entityType: string, entityId: string, changeType: string, summary: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");

  const create = () => {
    if (!title.trim()) return;
    const now = new Date().toISOString();
    const d: ArchitectureDecision = {
      id: uid("ad"), title: title.trim(), context: context.trim(), status: "proposed",
      relatedEntityIds: [], createdAt: now, updatedAt: now,
    };
    onMutate(
      (p) => ({ ...p, archDecisions: [...(p.archDecisions ?? []), d] }),
      "decision", d.id, "created", `Decision proposed: "${d.title}".`
    );
    setTitle("");
    setContext("");
    setOpen(false);
  };

  return (
    <div>
      <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
        {open ? "Cancel" : "+ Propose decision"}
      </Button>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-[#F0EBE0] bg-[#FAF8F2] p-2.5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. BFF owns currency formatting)" aria-label="Decision title" className={inputCls} />
          <input value={context} onChange={(e) => setContext(e.target.value)} placeholder="Context (optional)" aria-label="Decision context" className={inputCls} />
          <span className="flex justify-end">
            <Button size="sm" disabled={!title.trim()} onClick={create}>
              Propose
            </Button>
          </span>
        </div>
      )}
      <ul className="mt-2 space-y-1.5">
        {decisions.map((d) => (
          <li key={d.id} className="rounded-lg border border-[#F0EBE0] bg-white px-2.5 py-2">
            <p className="text-[12px] font-semibold text-[#27241F]">{d.title}</p>
            {d.context && <p className="text-[11px] text-[#777168]">{d.context}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {DEC_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() =>
                    onMutate(
                      (p) => ({
                        ...p,
                        archDecisions: (p.archDecisions ?? []).map((x) =>
                          x.id === d.id ? { ...x, status: s, updatedAt: new Date().toISOString(), decidedAt: s === "accepted" || s === "rejected" ? new Date().toISOString() : x.decidedAt } : x
                        ),
                      }),
                      "decision", d.id, "status", `Decision "${d.title}" → ${s}.`
                    )
                  }
                  aria-pressed={d.status === s}
                  className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold cursor-pointer ${d.status === s ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] text-[#777168]"}`}
                >
                  {s}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onMutate((p) => ({ ...p, archDecisions: (p.archDecisions ?? []).filter((x) => x.id !== d.id) }), "decision", d.id, "deleted", `Decision "${d.title}" removed.`)}
                aria-label={`Remove decision ${d.title}`}
                className="ml-auto rounded px-1 text-[11px] text-[#B3261E] hover:bg-[#F9E8E6] cursor-pointer"
              >
                remove
              </button>
            </div>
            {(d.status === "accepted" || d.status === "proposed") && (
              <input
                defaultValue={d.decision ?? ""}
                onBlur={(e) =>
                  onMutate(
                    (p) => ({ ...p, archDecisions: (p.archDecisions ?? []).map((x) => (x.id === d.id ? { ...x, decision: e.target.value || undefined, updatedAt: new Date().toISOString() } : x)) }),
                    "decision", d.id, "updated", `Decision text recorded for "${d.title}".`
                  )
                }
                placeholder="Record the agreed decision…"
                aria-label="Decision outcome"
                className={`${inputCls} mt-1.5`}
              />
            )}
          </li>
        ))}
        {decisions.length === 0 && <li className="text-[12px] text-[#A39B8E]">No decisions yet.</li>}
      </ul>
    </div>
  );
}

function QuestionList({
  assumptions,
  onMutate,
}: {
  project: StudioProject;
  assumptions: Assumption[];
  onMutate: (fn: (p: StudioProject) => StudioProject, entityType: string, entityId: string, changeType: string, summary: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [owner, setOwner] = useState("");

  const create = () => {
    if (!question.trim()) return;
    const now = new Date().toISOString();
    const a: Assumption = {
      id: uid("q"), question: question.trim(), owner: owner.trim() || undefined,
      relatedEntityIds: [], status: "open", createdAt: now, updatedAt: now,
    };
    onMutate((p) => ({ ...p, assumptions: [...(p.assumptions ?? []), a] }), "question", a.id, "created", `Question opened: "${a.question}".`);
    setQuestion("");
    setOwner("");
    setOpen(false);
  };

  return (
    <div>
      <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
        {open ? "Cancel" : "+ Open question"}
      </Button>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-[#F0EBE0] bg-[#FAF8F2] p-2.5">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Question (e.g. Is line-item pagination required?)" aria-label="Question" className={inputCls} />
          <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Owner (optional)" aria-label="Question owner" className={inputCls} />
          <span className="flex justify-end">
            <Button size="sm" disabled={!question.trim()} onClick={create}>
              Open
            </Button>
          </span>
        </div>
      )}
      <ul className="mt-2 space-y-1.5">
        {assumptions.map((a) => (
          <li key={a.id} className="rounded-lg border border-[#F0EBE0] bg-white px-2.5 py-2">
            <p className="text-[12px] font-semibold text-[#27241F]">{a.question}</p>
            {a.owner && <p className="font-mono text-[10px] text-[#A39B8E]">owner: {a.owner}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {(["open", "resolved", "deferred"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() =>
                    onMutate(
                      (p) => ({ ...p, assumptions: (p.assumptions ?? []).map((x) => (x.id === a.id ? { ...x, status: s, updatedAt: new Date().toISOString() } : x)) }),
                      "question", a.id, "status", `Question → ${s}.`
                    )
                  }
                  aria-pressed={a.status === s}
                  className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold cursor-pointer ${a.status === s ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] text-[#777168]"}`}
                >
                  {s}
                </button>
              ))}
              <button
                type="button"
                onClick={() => onMutate((p) => ({ ...p, assumptions: (p.assumptions ?? []).filter((x) => x.id !== a.id) }), "question", a.id, "deleted", "Question removed.")}
                aria-label="Remove question"
                className="ml-auto rounded px-1 text-[11px] text-[#B3261E] hover:bg-[#F9E8E6] cursor-pointer"
              >
                remove
              </button>
            </div>
            {a.status !== "open" && (
              <input
                defaultValue={a.resolution ?? ""}
                onBlur={(e) =>
                  onMutate(
                    (p) => ({ ...p, assumptions: (p.assumptions ?? []).map((x) => (x.id === a.id ? { ...x, resolution: e.target.value || undefined, updatedAt: new Date().toISOString() } : x)) }),
                    "question", a.id, "updated", "Resolution recorded."
                  )
                }
                placeholder="Resolution notes…"
                aria-label="Resolution"
                className={`${inputCls} mt-1.5`}
              />
            )}
          </li>
        ))}
        {assumptions.length === 0 && <li className="text-[12px] text-[#A39B8E]">No open questions.</li>}
      </ul>
    </div>
  );
}
