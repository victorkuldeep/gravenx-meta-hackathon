"use client";

import { useState } from "react";
import { composeHandoffBrief, draftRcaFromSession } from "@/lib/log-decomposer/rca";
import type { DebugSession, RootCauseAnalysis } from "@/lib/log-decomposer/model";

const CONFIDENCE: RootCauseAnalysis["confidence"][] = ["LOW", "MEDIUM", "HIGH"];

export function RcaPanel({
  session,
  onPersist,
}: {
  session: DebugSession;
  onPersist: (next: DebugSession) => Promise<void>;
}) {
  const [draft, setDraft] = useState<RootCauseAnalysis>(
    () =>
      session.rca ?? {
        summary: "",
        rootCause: undefined,
        contributingFactors: [],
        evidence: [],
        impact: undefined,
        recommendations: [],
        confidence: "LOW",
        createdAt: Date.now(),
      }
  );
  const [copied, setCopied] = useState(false);
  const [factorsText, setFactorsText] = useState((session.rca?.contributingFactors ?? []).join("\n"));
  const [recsText, setRecsText] = useState((session.rca?.recommendations ?? []).join("\n"));

  const set = <K extends keyof RootCauseAnalysis>(k: K, v: RootCauseAnalysis[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = () =>
    onPersist({
      ...session,
      status: session.status === "parsed" ? "diagnosed" : session.status,
      rca: {
        ...draft,
        contributingFactors: factorsText.split("\n").map((s) => s.trim()).filter(Boolean),
        recommendations: recsText.split("\n").map((s) => s.trim()).filter(Boolean),
        createdAt: draft.createdAt || Date.now(),
      },
    });

  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-bold text-ivory-950">Root cause analysis</h3>
          <button
            type="button"
            onClick={() => {
              const d = draftRcaFromSession(session);
              setDraft(d);
              setFactorsText(d.contributingFactors.join("\n"));
              setRecsText(d.recommendations.join("\n"));
            }}
            className="ml-auto cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 py-1 text-[11px] font-bold hover:bg-ivory-50"
          >
            Draft from findings
          </button>
        </div>
        <label className="mt-2 block text-[11px] font-bold uppercase tracking-wide text-ivory-500" htmlFor="rca-summary">Summary</label>
        <input
          id="rca-summary"
          value={draft.summary}
          onChange={(e) => set("summary", e.target.value)}
          placeholder="One line: what failed"
          className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[13px]"
        />
        <label className="mt-2 block text-[11px] font-bold uppercase tracking-wide text-ivory-500" htmlFor="rca-cause">Root cause</label>
        <textarea
          id="rca-cause"
          value={draft.rootCause ?? ""}
          onChange={(e) => set("rootCause", e.target.value || undefined)}
          placeholder="Why it failed - the mechanism, not the symptom"
          rows={3}
          className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[13px]"
        />
        <label className="mt-2 block text-[11px] font-bold uppercase tracking-wide text-ivory-500" htmlFor="rca-factors">Contributing factors (one per line)</label>
        <textarea
          id="rca-factors"
          value={factorsText}
          onChange={(e) => setFactorsText(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 font-mono text-[12px]"
        />
        <label className="mt-2 block text-[11px] font-bold uppercase tracking-wide text-ivory-500" htmlFor="rca-recs">Recommendations (one per line)</label>
        <textarea
          id="rca-recs"
          value={recsText}
          onChange={(e) => setRecsText(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 font-mono text-[12px]"
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-ivory-500">Confidence</span>
          {CONFIDENCE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set("confidence", c)}
              aria-pressed={draft.confidence === c}
              className={`cursor-pointer rounded-full border px-3 py-1 text-[12px] font-bold ${
                draft.confidence === c ? "border-[#9A7653] bg-[#FBF6EC]" : "border-[var(--color-line)] bg-white"
              }`}
            >
              {c}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void save()}
            disabled={!draft.summary.trim()}
            className="ml-auto cursor-pointer rounded-lg bg-ivory-950 px-4 py-1.5 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800 disabled:opacity-50"
          >
            Save RCA
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-bold text-ivory-950">Handoff brief</h3>
          <button
            type="button"
            onClick={() => {
              const brief = composeHandoffBrief(session, { ...draft, contributingFactors: factorsText.split("\n").map((s) => s.trim()).filter(Boolean), recommendations: recsText.split("\n").map((s) => s.trim()).filter(Boolean) });
              const url = URL.createObjectURL(new Blob([brief], { type: "text/markdown" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = `${session.title.replace(/[^a-zA-Z0-9-_]+/g, "_") || "debug-session"}-rca.md`;
              document.body.appendChild(a);
              a.click();
              a.remove();
              window.setTimeout(() => URL.revokeObjectURL(url), 5000);
            }}
            disabled={!draft.summary.trim()}
            title="Download the brief as a Markdown work package"
            className="ml-auto cursor-pointer rounded-lg border border-[var(--color-line)] bg-white px-3 py-1.5 text-[12px] font-bold text-ivory-700 hover:border-bronze-600 disabled:opacity-50"
          >
            Download .md
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(composeHandoffBrief(session, { ...draft, contributingFactors: factorsText.split("\n").map((s) => s.trim()).filter(Boolean), recommendations: recsText.split("\n").map((s) => s.trim()).filter(Boolean) })).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              });
            }}
            disabled={!draft.summary.trim()}
            className="cursor-pointer rounded-lg bg-ivory-950 px-3 py-1.5 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800 disabled:opacity-50"
          >
            {copied ? "Copied" : "Copy brief"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-ivory-500">Problem + cause + evidence by reference + fix - paste into Jira or hand to a coding agent.</p>
        <pre className="mt-2 max-h-96 overflow-y-auto rounded-lg bg-ivory-950 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ivory-200">
          {composeHandoffBrief(session, { ...draft, contributingFactors: factorsText.split("\n").map((s) => s.trim()).filter(Boolean), recommendations: recsText.split("\n").map((s) => s.trim()).filter(Boolean) })}
        </pre>
      </section>
    </div>
  );
}
