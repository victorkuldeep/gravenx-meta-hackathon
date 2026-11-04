"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { keyedProviders } from "@/lib/ai/keyVault";
import { SKILL_PACKS } from "@/lib/ai/skills";
import { listGrounding } from "@/lib/arena/groundingStore";
import type { GroundingDoc } from "@/lib/arena/grounding";
import {
  addRound,
  composeSessionContext,
  deleteSession,
  listSessions,
  newSession,
  saveSession,
  sessionBrief,
  type EngineeringSession,
  type RoundKind,
  type SessionArtifact,
} from "@/lib/arena/session";
import { ArenaGate } from "./ArenaGate";
import { ArenaJiraPush } from "./ArenaJiraPush";
import { GroundingPanel } from "./GroundingPanel";
import { ProblemIngress } from "./ProblemIngress";

const ROUND_KINDS: RoundKind[] = ["finding", "proposal", "critique", "revision", "decision", "note"];
const ARTIFACT_KINDS = ["system", "sequence", "wireframe", "draw", "adr", "requirement", "workpackage", "note"] as const;

export function ArenaPanel() {
  const [brains, setBrains] = useState<string[]>([]);
  const [docs, setDocs] = useState<GroundingDoc[]>([]);
  const [sessions, setSessions] = useState<EngineeringSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [roundKind, setRoundKind] = useState<RoundKind>("finding");
  const [roundBody, setRoundBody] = useState("");
  const [artKind, setArtKind] = useState<SessionArtifact["kind"]>("adr");
  const [artRef, setArtRef] = useState("");
  const [artLabel, setArtLabel] = useState("");
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setBrains(keyedProviders());
    setDocs(await listGrounding());
    setSessions(await listSessions());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = sessions.find((s) => s.id === activeId) ?? null;

  const persist = useCallback(
    async (s: EngineeringSession) => {
      await saveSession(s);
      setSessions(await listSessions());
    },
    []
  );

  const create = useCallback(async () => {
    const s = newSession(titleDraft || `Session ${sessions.length + 1}`);
    await saveSession(s);
    setTitleDraft("");
    setSessions(await listSessions());
    setActiveId(s.id);
  }, [titleDraft, sessions.length]);

  const ctx = useMemo(() => {
    if (!active) return null;
    return composeSessionContext(active, SKILL_PACKS, docs);
  }, [active, docs]);

  if (brains.length === 0) {
    // Scrollable wrapper: the gate is taller than the viewport and used to
    // slide under the sticky footer with no way to reach the bottom.
    return (
      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        <ArenaGate onConnected={() => void refresh()} />
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="flex min-h-0 flex-col rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <div className="flex gap-1.5">
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
            placeholder="New session, e.g. Order sync"
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[12px]"
          />
          <button
            type="button"
            onClick={() => void create()}
            className="shrink-0 cursor-pointer rounded-lg bg-ivory-950 px-3 py-1.5 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800"
          >
            + New
          </button>
        </div>
        <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
          {sessions.length === 0 && <li className="px-1 py-4 text-center text-[12px] text-ivory-500">No sessions yet - name one above.</li>}
          {sessions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setActiveId(s.id)}
                className={`w-full cursor-pointer rounded-lg border px-2.5 py-2 text-left ${
                  s.id === activeId ? "border-bronze-600 bg-white" : "border-transparent hover:bg-white"
                }`}
              >
                <p className="truncate text-[12px] font-bold text-ivory-950">{s.title}</p>
                <p className="text-[11px] text-ivory-500">
                  {s.status} · {s.rounds.length} rounds · {new Date(s.updatedAt).toLocaleDateString()}
                </p>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 border-t border-[var(--color-line)] pt-2">
          <p className="text-[11px] text-ivory-500">Brain: {brains.join(", ")}</p>
        </div>
      </aside>

      <div className="min-h-0 space-y-3 overflow-y-auto pr-0.5">
        {!active && (
          <div className="space-y-3">
            <ProblemIngress
              onStarted={(id) => {
                setActiveId(id);
                void refresh();
              }}
            />
            <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-8 text-center text-[13px] text-ivory-500">
              Or pick an existing session - each owns its problem, context, discussion rounds and artifacts.
            </div>
          </div>
        )}
        {active && ctx && (
          <>
            <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-ivory-950">{active.title}</h2>
                <span className="rounded-full bg-ivory-200 px-2 py-0.5 text-[11px] font-bold text-ivory-700">{active.status}</span>
                {active.status === "discussing" && (
                  <button
                    type="button"
                    onClick={() => void persist({ ...active, status: "accepted" })}
                    className="cursor-pointer rounded-lg bg-emerald-700 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-800"
                  >
                    Accept solution
                  </button>
                )}
                {active.status === "accepted" && (
                  <button
                    type="button"
                    onClick={() => void persist({ ...active, status: "handed-off" })}
                    className="cursor-pointer rounded-lg bg-ivory-950 px-3 py-1.5 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800"
                  >
                    Mark handed off
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void deleteSession(active.id).then(() => {
                      setActiveId(null);
                      void refresh();
                    });
                  }}
                  className="cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 py-1.5 text-[12px] hover:bg-red-50 hover:text-red-700"
                >
                  Delete
                </button>
              </div>
              <label className="mt-3 block text-[11px] font-bold uppercase tracking-wide text-ivory-500" htmlFor="arena-problem">
                Problem
              </label>
              <textarea
                id="arena-problem"
                defaultValue={active.problem}
                key={`${active.id}-problem`}
                onBlur={(e) => {
                  if (e.target.value !== active.problem) void persist({ ...active, problem: e.target.value });
                }}
                placeholder="The Jira ticket in one paragraph, or the raw problem as the architect heard it…"
                rows={3}
                className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[13px]"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  defaultValue={active.jiraRef}
                  key={`${active.id}-jira`}
                  onBlur={(e) => {
                    if (e.target.value !== active.jiraRef) void persist({ ...active, jiraRef: e.target.value.trim() });
                  }}
                  placeholder="Jira ref, e.g. PROJ-4821"
                  className="w-48 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 font-mono text-[12px]"
                />
                <input
                  defaultValue={active.orgKey}
                  key={`${active.id}-org`}
                  onBlur={(e) => {
                    if (e.target.value !== active.orgKey) void persist({ ...active, orgKey: e.target.value.trim() });
                  }}
                  placeholder="Org label (optional)"
                  className="w-48 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[12px]"
                />
              </div>
            </section>

            <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
              <h3 className="text-[13px] font-bold text-ivory-950">Session context</h3>
              <p className="text-[11px] text-ivory-500">Built-in packs plus your grounding - composed identically for you and the LLM.</p>
              <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-ivory-500">Built-in skills</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {SKILL_PACKS.map((p) => {
                  const on = active.skillIds.includes(p.name);
                  return (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => {
                        const skillIds = on ? active.skillIds.filter((n) => n !== p.name) : [...active.skillIds, p.name];
                        void persist({ ...active, skillIds });
                      }}
                      title={p.system.slice(0, 160)}
                      className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                        on ? "border-bronze-600 bg-bronze-600 text-white" : "border-[var(--color-line)] bg-white hover:border-bronze-600"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-ivory-500">Your grounding</p>
              {docs.length === 0 && <p className="mt-1 text-[12px] text-ivory-500">Library empty - add framework skills below.</p>}
              <div className="mt-1 flex flex-wrap gap-1.5">
                {docs.map((d) => {
                  const on = active.groundingIds.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => {
                        const groundingIds = on ? active.groundingIds.filter((id) => id !== d.id) : [...active.groundingIds, d.id];
                        void persist({ ...active, groundingIds });
                      }}
                      title={`${d.content.length} bytes`}
                      className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                        on ? "border-emerald-700 bg-emerald-700 text-white" : "border-[var(--color-line)] bg-white hover:border-emerald-700"
                      }`}
                    >
                      {d.name}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 rounded-lg bg-white px-3 py-2 text-[12px]">
                <p className="font-bold text-ivory-950">
                  Composed: {ctx.sections.length} sections · {(ctx.totalBytes / 1024).toFixed(1)}KB
                </p>
                <ul className="mt-1 space-y-0.5 text-ivory-600">
                  {ctx.sections.map((s) => (
                    <li key={s.title} className="truncate" title={s.title}>
                      · {s.title}
                    </li>
                  ))}
                </ul>
                {ctx.overrides.length > 0 && (
                  <p className="mt-1 font-bold text-amber-700">Your grounding overrides built-in: {ctx.overrides.join(", ")}</p>
                )}
              </div>
            </section>

            <GroundingPanel docs={docs} onChange={() => void refresh()} />

            <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
              <h3 className="text-[13px] font-bold text-ivory-950">Discussion rounds</h3>
              <p className="text-[11px] text-ivory-500">Every proposal, critique and decision lands here - this log is the session memory.</p>
              <ol className="mt-2 space-y-2">
                {active.rounds.length === 0 && <li className="text-[12px] text-ivory-500">No rounds yet - log the problem as the first finding.</li>}
                {active.rounds.map((r) => (
                  <li key={r.id} className="rounded-lg border border-[var(--color-line)] bg-white px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-bronze-700">
                      {r.kind} · {new Date(r.createdAt).toLocaleString()}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-ivory-950">{r.body}</p>
                  </li>
                ))}
              </ol>
              <div className="mt-2 flex flex-wrap gap-2">
                <select
                  value={roundKind}
                  onChange={(e) => setRoundKind(e.target.value as RoundKind)}
                  aria-label="Round kind"
                  className="rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 text-[12px]"
                >
                  {ROUND_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <input
                  value={roundBody}
                  onChange={(e) => setRoundBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && roundBody.trim()) {
                      void persist(addRound(active, roundKind, roundBody)).then(() => setRoundBody(""));
                    }
                  }}
                  placeholder="Log a finding, proposal, critique… (Enter to save)"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[12px]"
                />
                <button
                  type="button"
                  disabled={!roundBody.trim()}
                  onClick={() => {
                    void persist(addRound(active, roundKind, roundBody)).then(() => setRoundBody(""));
                  }}
                  className="cursor-pointer rounded-lg bg-ivory-950 px-3 py-1.5 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800 disabled:opacity-50"
                >
                  Log round
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
              <h3 className="text-[13px] font-bold text-ivory-950">Artifacts</h3>
              <p className="text-[11px] text-ivory-500">Addresses, never copies - canvases, ADRs and work packages this session produced.</p>
              <ul className="mt-2 space-y-1.5">
                {active.artifacts.length === 0 && <li className="text-[12px] text-ivory-500">No artifacts linked yet.</li>}
                {active.artifacts.map((a, i) => (
                  <li key={`${a.kind}:${a.ref}:${i}`} className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[12px]">
                    <span className="shrink-0 rounded-full bg-ivory-200 px-1.5 py-px text-[10px] font-bold text-ivory-700">{a.kind}</span>
                    <span className="min-w-0 flex-1 truncate font-bold text-ivory-950" title={`${a.label} (${a.ref})`}>
                      {a.label} <span className="font-mono font-normal text-ivory-500">{a.ref}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void persist({ ...active, artifacts: active.artifacts.filter((_, j) => j !== i) })}
                      aria-label={`Remove ${a.label}`}
                      className="shrink-0 cursor-pointer rounded p-1 text-ivory-500 hover:bg-red-50 hover:text-red-600"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                <select
                  value={artKind}
                  onChange={(e) => setArtKind(e.target.value as SessionArtifact["kind"])}
                  aria-label="Artifact kind"
                  className="rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 text-[12px]"
                >
                  {ARTIFACT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <input
                  value={artRef}
                  onChange={(e) => setArtRef(e.target.value)}
                  placeholder="Ref, e.g. ADR-004 or canvas id"
                  className="w-48 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 font-mono text-[12px]"
                />
                <input
                  value={artLabel}
                  onChange={(e) => setArtLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && artRef.trim()) {
                      void persist({ ...active, artifacts: [...active.artifacts, { kind: artKind, ref: artRef.trim(), label: artLabel.trim() || artRef.trim() }] }).then(() => {
                        setArtRef("");
                        setArtLabel("");
                      });
                    }
                  }}
                  placeholder="Label"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[12px]"
                />
                <button
                  type="button"
                  disabled={!artRef.trim()}
                  onClick={() => {
                    void persist({ ...active, artifacts: [...active.artifacts, { kind: artKind, ref: artRef.trim(), label: artLabel.trim() || artRef.trim() }] }).then(() => {
                      setArtRef("");
                      setArtLabel("");
                    });
                  }}
                  className="cursor-pointer rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-[12px] font-bold hover:bg-ivory-50 disabled:opacity-50"
                >
                  Link
                </button>
              </div>
              <div className="mt-3 border-t border-[var(--color-line)] pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const brief = sessionBrief(active, (ctx?.sections ?? []).map((s) => s.title));
                    void navigator.clipboard.writeText(brief).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                  className="cursor-pointer rounded-lg bg-ivory-950 px-3 py-1.5 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800"
                >
                  {copied ? "Copied" : "Copy handoff brief"}
                </button>
                <span className="ml-2 text-[11px] text-ivory-500">Problem + rounds + artifacts - paste into Jira or hand to Claude Code.</span>
              </div>
              <ArenaJiraPush title={active.title} brief={sessionBrief(active, (ctx?.sections ?? []).map((s) => s.title))} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
