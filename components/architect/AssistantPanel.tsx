"use client";

import { useMemo, useState } from "react";
import { mergeSuggestions, suggestForProject, suggestProjectGaps } from "@/lib/api-contracts/assistant";
import { setDecisionStatus } from "@/lib/api-contracts/decision-model";
import type { ApiProject, Decision } from "@/lib/api-contracts/types";
import { newStudioId } from "@/lib/composite/studio";
import Button from "../ui/Button";
import type { OrchestratorProps } from "./Orchestrator";

/**
 * Right rail: rule-based facilitation. Suggestions are proposed only -
 * accept/reject/defer is always an explicit architect action, and only
 * accepted decisions compile. Metadata insights show live facts.
 */
export function AssistantPanel(props: OrchestratorProps) {
  const { drafts, activeId, describes } = props;
  const { onPatchDraft } = props;
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const draft = activeId ? (drafts.get(activeId) ?? null) : null;

  const suggestions = useMemo(() => {
    if (!draft) return [];
    const metaCounts = new Map<string, number>();
    for (const obj of draft.boundary.participatingObjects) {
      const d = describes.get(obj);
      if (d) metaCounts.set(obj, d.fields.length);
    }
    const have = new Set(draft.decisions.map((d) => d.id));
    return [...suggestForProject(draft, metaCounts), ...suggestProjectGaps(draft)].filter((s) => !have.has(s.id));
  }, [draft, describes]);

  if (!draft) return null;

  const pending = draft.decisions.filter((d) => d.status === "proposed" || d.status === "needs-clarification");

  const addAll = () => {
    const { project } = mergeSuggestions(draft, suggestions);
    onPatchDraft(draft.id, () => project);
  };

  const decide = (id: string, to: Decision["status"], chosen?: string) => {
    const d = draft.decisions.find((x) => x.id === id);
    if (!d) return;
    const withAnswer =
      chosen !== undefined && chosen !== d.chosen ? { ...d, chosen } : d;
    const staged: ApiProject = {
      ...draft,
      decisions: draft.decisions.map((x) => (x.id === id ? withAnswer : x)),
    };
    const { project, ok } = setDecisionStatus(staged, id, to);
    if (ok) onPatchDraft(draft.id, () => project);
  };

  const listed = [...pending].sort((a, b) => a.createdAt - b.createdAt);
  const metaFacts = draft.boundary.participatingObjects.map((o) => {
    const d = describes.get(o);
    return { object: o, fields: d ? d.fields.length : null };
  });

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
            Assistant · {pending.length} pending
          </p>
          {suggestions.length > 0 && (
            <Button size="sm" onClick={addAll}>
              Add {suggestions.length} to register
            </Button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-[#777168]">
          Facilitates, never decides. Proposed items do not compile until accepted.
        </p>
        <div className="mt-2 max-h-[380px] space-y-1.5 overflow-y-auto">
          {suggestions.length === 0 && listed.length === 0 && (
            <p className="px-1 py-2 text-[11px] text-[#A39B8E]">Nothing pending - the register is quiet.</p>
          )}
          {suggestions.map((s) => (
            <div key={s.id} className="rounded-lg border border-dashed border-[#D8C7A9] bg-[#F5F1E8]/60 px-2 py-1.5">
              <p className="text-[12px] font-medium text-[#27241F]">{s.question}</p>
              <p className="mt-0.5 text-[11px] text-[#777168]">{s.rationale}</p>
              <p className="mt-0.5 font-mono text-[10px] text-[#A39B8E]">{s.topic}</p>
            </div>
          ))}
          {listed.map((d) => (
            <div key={d.id} className="rounded-lg border border-[#E8E2D8] px-2 py-1.5">
              <p className="text-[12px] font-medium text-[#27241F]">{d.question}</p>
              {d.options.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {d.options.map((o) => (
                    <button
                      key={o}
                      onClick={() => setAnswers((p) => ({ ...p, [d.id]: o }))}
                      className={`rounded-md border px-1.5 py-0.5 text-[11px] cursor-pointer ${
                        (answers[d.id] ?? d.chosen) === o
                          ? "border-[#211F1B] bg-[#211F1B] text-white"
                          : "border-[#E8E2D8] text-[#777168] hover:text-[#27241F]"
                      }`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-1.5 flex gap-1">
                <button
                  onClick={() => decide(d.id, "accepted", answers[d.id])}
                  className="rounded-md bg-[#211F1B] px-2 py-0.5 text-[11px] font-semibold text-white hover:opacity-90 cursor-pointer"
                >
                  Accept
                </button>
                <button
                  onClick={() => decide(d.id, "rejected")}
                  className="rounded-md border border-[#E8E2D8] px-2 py-0.5 text-[11px] hover:border-[#B84C42] hover:text-[#B84C42] cursor-pointer"
                >
                  Reject
                </button>
                <button
                  onClick={() => decide(d.id, "deferred")}
                  className="rounded-md border border-[#E8E2D8] px-2 py-0.5 text-[11px] hover:text-[#27241F] cursor-pointer"
                >
                  Defer
                </button>
              </div>
              {d.chosen !== "" && (
                <p className="mt-1 font-mono text-[10px] text-[#A39B8E]">chosen: {d.chosen || answers[d.id] || "—"}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Metadata facts</p>
        {metaFacts.length === 0 && (
          <p className="mt-1 text-[11px] text-[#A39B8E]">No participating objects yet.</p>
        )}
        {metaFacts.map((m) => (
          <div key={m.object} className="mt-1 flex items-center justify-between font-mono text-[11px]">
            <span className="text-[#27241F]">{m.object}</span>
            <span className="text-[#A39B8E]">{m.fields === null ? "not loaded" : `${m.fields} fields`}</span>
          </div>
        ))}
        <NewSuggestion draftId={draft.id} onPatchDraft={onPatchDraft} />
      </div>
    </div>
  );
}

function NewSuggestion({
  draftId,
  onPatchDraft,
}: {
  draftId: string;
  onPatchDraft: OrchestratorProps["onPatchDraft"];
}) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [question, setQuestion] = useState("");
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 w-full rounded-lg border border-dashed border-[#E8E2D8] px-2 py-1.5 text-[11px] text-[#777168] hover:text-[#27241F] hover:border-[#A98450] transition-colors cursor-pointer"
      >
        + Log an open question
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-[#E8E2D8] p-2">
      <input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="Topic"
        className="w-full rounded-md border border-[#E8E2D8] px-2 py-1 text-[12px] focus:border-[#A98450] focus:outline-none"
      />
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Open question…"
        className="w-full rounded-md border border-[#E8E2D8] px-2 py-1 text-[12px] focus:border-[#A98450] focus:outline-none"
      />
      <div className="flex gap-1.5">
        <Button
          size="sm"
          disabled={topic.trim() === "" || question.trim() === ""}
          onClick={() => {
            onPatchDraft(draftId, (p) => ({
              ...p,
              decisions: [
                ...p.decisions,
                {
                  id: newStudioId("dec"),
                  topic: topic.trim(),
                  question: question.trim(),
                  options: [],
                  chosen: "",
                  rationale: "Logged by the architect.",
                  owner: "",
                  status: "needs-clarification" as const,
                  suggested: false,
                  relatedOps: [],
                  createdAt: Date.now(),
                  revision: p.version,
                },
              ],
            }));
            setTopic("");
            setQuestion("");
            setOpen(false);
          }}
        >
          Log it
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
