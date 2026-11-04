"use client";

import { useMemo, useState } from "react";
import type { DebugSession, ExecutionModel, Finding } from "@/lib/log-decomposer/model";
import { logTimestamp } from "@/lib/log-decomposer/model";
import { suggestHypotheses, summarizeInvestigation } from "@/lib/log-decomposer/investigate";

const HYP_STATUS: Record<string, { next: string; label: string; cls: string }> = {
  open: { next: "supported", label: "Open", cls: "border-[var(--color-line)] bg-white text-ivory-600" },
  supported: { next: "refuted", label: "Supported", cls: "border-emerald-600 bg-emerald-700 text-white" },
  refuted: { next: "open", label: "Refuted", cls: "border-red-400 bg-red-50 text-red-700" },
};

function uid(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

function briefOf(session: DebugSession, findings: Finding[]): string {
  const sev = new Map<string, number>();
  for (const f of findings) sev.set(f.severity, (sev.get(f.severity) ?? 0) + 1);
  const inv = session.investigation ?? { hypotheses: [], questions: [] };
  const lines = [
    `INVESTIGATION BRIEF - ${session.title}`,
    `Problem: ${session.problem || "(not stated)"}`,
    `Status: ${session.status} - ${session.logs.length} logs, ${session.executions.length} executions, ${findings.length} findings (${[...sev.entries()].map(([s, n]) => `${n} ${s}`).join(", ") || "none"}).`,
    "",
    "HYPOTHESES",
    ...inv.hypotheses.map((h) => `- [${h.status.toUpperCase()}] ${h.text}`),
    ...(inv.hypotheses.length === 0 ? ["- (none yet)"] : []),
    "",
    "OPEN QUESTIONS",
    ...inv.questions.filter((q) => !q.resolved).map((q) => `- ${q.text}`),
    ...(inv.questions.every((q) => q.resolved) ? ["- (none open)"] : []),
  ];
  return lines.join("\n");
}

export function InvestigatePanel({
  session,
  findings,
  executions,
  onPersist,
  onJump,
}: {
  session: DebugSession;
  findings: Finding[];
  executions: ExecutionModel[];
  onPersist: (next: DebugSession) => Promise<void>;
  onJump: (nodeId: string | null, line: number | null) => void;
}) {
  const inv = session.investigation ?? { hypotheses: [], questions: [] };
  const [hDraft, setHDraft] = useState("");
  const [qDraft, setQDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const saveInv = (next: typeof inv) => onPersist({ ...session, investigation: next });

  // Newest log first - batches store oldest-first, so position lies.
  const ordered = useMemo(() => {
    const t = new Map(session.logs.map((l) => [l.salesforceLogId, logTimestamp(l)]));
    return [...executions].sort((a, b) => (t.get(b.logId) ?? 0) - (t.get(a.logId) ?? 0));
  }, [executions, session.logs]);
  const verdict = useMemo(() => summarizeInvestigation(ordered, findings), [ordered, findings]);

  const suggestions = useMemo(
    () => suggestHypotheses(findings).filter((s) => !inv.hypotheses.some((h) => h.text === s)),
    [findings, inv.hypotheses]
  );

  const acceptSuggestions = () =>
    void saveInv({
      ...inv,
      hypotheses: [
        ...inv.hypotheses,
        ...suggestions.map((text) => ({ id: uid("h"), text, status: "open" as const, createdAt: Date.now() })),
      ],
    });

  const stages = [
    { label: "Captured", done: session.logs.length > 0 },
    { label: "Decomposed", done: session.executions.length > 0 },
    { label: "Findings", done: findings.length > 0 },
    { label: "Hypotheses", done: inv.hypotheses.length > 0 },
    { label: "RCA", done: !!session.rca },
  ];

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(briefOf(session, findings));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable - brief stays on screen */
    }
  };

  const verdictStyle =
    verdict?.status === "failed"
      ? { pill: "bg-red-600 text-white", text: "text-red-700" }
      : verdict?.status === "warning"
        ? { pill: "bg-amber-500 text-white", text: "text-amber-800" }
        : { pill: "bg-emerald-600 text-white", text: "text-emerald-700" };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {verdict ? (
        <section aria-label="Investigation verdict" className="rounded-xl border border-[var(--color-line)] bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${verdictStyle.pill}`}>
              {verdict.status}
            </span>
            <p className="min-w-0 flex-1 text-[13px] font-bold text-ivory-950">{verdict.headline}</p>
          </div>
          <ul className="mt-1.5 space-y-1">
            {verdict.bullets.map((b, i) => (
              <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed text-ivory-800">
                <span aria-hidden="true" className={`font-bold ${verdictStyle.text}`}>
                  ·
                </span>
                <span className="min-w-0 flex-1">{b}</span>
              </li>
            ))}
          </ul>
          {verdict.narrative.length > 0 && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[11px] font-bold text-ivory-500 hover:text-ivory-950">
                What happened, in order
              </summary>
              <ol className="mt-1 space-y-0.5 font-mono text-[11px] text-ivory-700">
                {verdict.narrative.map((n, i) => (
                  <li key={i}>
                    <span className="mr-1.5 text-ivory-400">{String(i + 1).padStart(2, "0")}</span>
                    {n}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>
      ) : (
        <p className="rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-6 text-center text-[12px] text-ivory-500">
          Pull a log and the investigation writes itself - verdict, narrative and hypotheses arrive with the decomposition.
        </p>
      )}
      <section aria-label="Investigation progress" className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2">
        {stages.map((s, i) => (
          <span key={s.label} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true" className="text-[11px] text-ivory-400">→</span>}
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                s.done ? "border-emerald-600 bg-emerald-700 text-white" : "border-[var(--color-line)] bg-white text-ivory-500"
              }`}
            >
              {s.done ? "✓ " : ""}{s.label}
            </span>
          </span>
        ))}
        <button
          type="button"
          onClick={() => void copyBrief()}
          title="Copy a text brief of this investigation for chat, Jira or email"
          className="ml-auto cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1 text-[11px] font-bold text-ivory-700 hover:border-bronze-600"
        >
          {copied ? "Copied ✓" : "Copy brief"}
        </button>
      </section>

      <div className="grid min-h-0 items-start gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
          <div className="flex items-center gap-2">
            <h3 className="text-[13px] font-bold text-ivory-950">Hypotheses · {inv.hypotheses.length}</h3>
            {suggestions.length > 0 && (
              <button
                type="button"
                onClick={acceptSuggestions}
                title="Draft hypotheses from the deterministic findings - one click, then edit or discard"
                className="ml-auto shrink-0 cursor-pointer rounded-lg border border-[#722F37] bg-white px-2.5 py-1 text-[11px] font-bold text-[#722F37] hover:bg-[#722F37] hover:text-white"
              >
                Suggest {suggestions.length} from findings
              </button>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-ivory-500">What might be wrong. Click the status to advance it - the AI reads these too.</p>
          <div className="mt-2 flex gap-1.5">
            <input
              value={hDraft}
              onChange={(e) => setHDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hDraft.trim()) {
                  void saveInv({ ...inv, hypotheses: [...inv.hypotheses, { id: uid("h"), text: hDraft.trim(), status: "open", createdAt: Date.now() }] });
                  setHDraft("");
                }
              }}
              placeholder="e.g. Synchronous callout blows the 120s limit"
              aria-label="New hypothesis"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[12px] placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={!hDraft.trim()}
              onClick={() => {
                void saveInv({ ...inv, hypotheses: [...inv.hypotheses, { id: uid("h"), text: hDraft.trim(), status: "open", createdAt: Date.now() }] });
                setHDraft("");
              }}
              className="shrink-0 cursor-pointer rounded-lg bg-ivory-950 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-ivory-800 disabled:opacity-40"
            >
              Add
            </button>
          </div>
          <ul className="mt-2 space-y-1.5">
            {inv.hypotheses.map((h) => {
              const st = HYP_STATUS[h.status] ?? HYP_STATUS.open;
              return (
                <li key={h.id} className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => void saveInv({ ...inv, hypotheses: inv.hypotheses.map((x) => (x.id === h.id ? { ...x, status: st.next as typeof x.status } : x)) })}
                    title={`Mark ${st.next}`}
                    className={`shrink-0 cursor-pointer rounded-full border px-2 py-0.5 text-[10px] font-bold ${st.cls}`}
                  >
                    {st.label}
                  </button>
                  <span className="min-w-0 flex-1 text-[12px] text-ivory-950">{h.text}</span>
                  <button
                    type="button"
                    onClick={() => void saveInv({ ...inv, hypotheses: inv.hypotheses.filter((x) => x.id !== h.id) })}
                    aria-label="Delete hypothesis"
                    className="shrink-0 cursor-pointer rounded p-1 text-ivory-400 hover:bg-red-50 hover:text-red-700"
                  >
                    ×
                  </button>
                </li>
              );
            })}
            {inv.hypotheses.length === 0 && <li className="px-1 py-2 text-[12px] text-ivory-500">No hypotheses yet - write the first guess, then prove or kill it with evidence.</li>}
          </ul>
        </section>

        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
          <h3 className="text-[13px] font-bold text-ivory-950">Open questions · {inv.questions.filter((q) => !q.resolved).length}</h3>
          <p className="mt-0.5 text-[11px] text-ivory-500">What the engineer still needs to answer or check in the org.</p>
          <div className="mt-2 flex gap-1.5">
            <input
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && qDraft.trim()) {
                  void saveInv({ ...inv, questions: [...inv.questions, { id: uid("q"), text: qDraft.trim(), resolved: false, createdAt: Date.now() }] });
                  setQDraft("");
                }
              }}
              placeholder="e.g. Is the 120s callout timeout approved?"
              aria-label="New question"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[12px] placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={!qDraft.trim()}
              onClick={() => {
                void saveInv({ ...inv, questions: [...inv.questions, { id: uid("q"), text: qDraft.trim(), resolved: false, createdAt: Date.now() }] });
                setQDraft("");
              }}
              className="shrink-0 cursor-pointer rounded-lg bg-ivory-950 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-ivory-800 disabled:opacity-40"
            >
              Add
            </button>
          </div>
          <ul className="mt-2 space-y-1.5">
            {inv.questions.map((q) => (
              <li key={q.id} className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-2">
                <input
                  type="checkbox"
                  checked={q.resolved}
                  onChange={() => void saveInv({ ...inv, questions: inv.questions.map((x) => (x.id === q.id ? { ...x, resolved: !x.resolved } : x)) })}
                  aria-label={`Mark question resolved: ${q.text}`}
                  className="h-3.5 w-3.5 shrink-0 accent-[#722F37]"
                />
                <span className={`min-w-0 flex-1 text-[12px] ${q.resolved ? "text-ivory-400 line-through" : "text-ivory-950"}`}>{q.text}</span>
                <button
                  type="button"
                  onClick={() => void saveInv({ ...inv, questions: inv.questions.filter((x) => x.id !== q.id) })}
                  aria-label="Delete question"
                  className="shrink-0 cursor-pointer rounded p-1 text-ivory-400 hover:bg-red-50 hover:text-red-700"
                >
                  ×
                </button>
              </li>
            ))}
            {inv.questions.length === 0 && <li className="px-1 py-2 text-[12px] text-ivory-500">No questions yet - log what needs a human or the org to answer.</li>}
          </ul>
        </section>
      </div>

      <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <h3 className="text-[13px] font-bold text-ivory-950">
          Evidence board · {findings.length > 0 ? `${findings.length} findings` : `${executions.length} decomposed logs`}
        </h3>
        <p className="mt-0.5 text-[11px] text-ivory-500">
          {findings.length > 0
            ? "Deterministic findings, one click from their execution context. Attach what proves a hypothesis."
            : "This log is clean - no anomalies fired. The decomposition itself is the evidence: open any log to walk it."}
        </p>
        {findings.length === 0 && executions.length === 0 ? (
          <p className="px-1 py-3 text-[12px] text-ivory-500">No logs in this session yet - pull a log first.</p>
        ) : findings.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {findings.slice(0, 30).map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-2">
                <span className="shrink-0 rounded-full bg-ivory-200 px-1.5 py-px text-[10px] font-bold text-ivory-700">{f.type}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-ivory-950" title={f.title}>{f.title}</span>
                <button
                  type="button"
                  onClick={() => onJump(f.relatedNodeIds[0] ?? null, null)}
                  title="Open in Explore"
                  className="shrink-0 cursor-pointer rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px] font-bold text-ivory-700 hover:border-bronze-600"
                >
                  Inspect
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {executions.map((e) => (
              <li key={e.executionId} className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-600" title="Decomposed" />
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-bold text-ivory-950" title={e.metadata.operation ?? e.logId}>
                  {e.metadata.operation ?? e.logId}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-ivory-500">
                  {e.nodes.length}n · {e.metrics.eventCount}e · {typeof e.metadata.durationMs === "number" ? `${e.metadata.durationMs}ms` : "—"}
                </span>
                <button
                  type="button"
                  onClick={() => onJump(e.rootIds[0] ?? null, null)}
                  title="Open in Explore"
                  className="shrink-0 cursor-pointer rounded-md border border-[var(--color-line)] px-2 py-1 text-[11px] font-bold text-ivory-700 hover:border-bronze-600"
                >
                  Inspect
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
