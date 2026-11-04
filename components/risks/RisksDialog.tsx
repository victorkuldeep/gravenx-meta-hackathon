"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "../ui/Button";
import { analyzeProject, sequencesForProject, type RiskFinding } from "@/lib/risks/rules";
import { findingKey, proveFindings, type ProofState } from "@/lib/risks/proof";
import { downloadRiskRegister } from "@/lib/risks/register";
import { proposeScenario, type ScenarioDraft } from "@/lib/risks/scenarios";
import type { SystemProject } from "@/lib/system-design/model";
import { listSystemRuns, type SystemRunRecord } from "@/lib/system-design/runStore";
import { listSequences } from "@/lib/sequence/store";
import { linkDecision, newDecision, nextDecisionNumber } from "@/lib/decisions/model";
import { listDecisions, saveDecision } from "@/lib/decisions/store";
import { newConsoleTask } from "@/lib/console/model";
import { saveConsoleTask } from "@/lib/console/store";
import type { SequenceDocument } from "@/lib/sequence/model";

const SEVERITY_STYLE: Record<RiskFinding["severity"], string> = {
  high: "border-red-300 bg-red-50 text-red-700",
  medium: "border-[#E3D9C6] bg-[#FBF6EC] text-[#7A5C3A]",
  low: "border-[var(--color-line-soft)] bg-[var(--color-canvas)] text-ivory-600",
};

const PROOF_STYLE: Record<ProofState, string> = {
  unproven: "border-[var(--color-line-soft)] bg-[var(--color-canvas)] text-ivory-500",
  covered: "border-[#E3D9C6] bg-[#FBF6EC] text-[#7A5C3A]",
  "proven-live": "border-[#2F6B45] bg-[#2F6B45]/10 text-[#2F6B45]",
  "proven-mock": "border-bronze-500 bg-bronze-100 text-bronze-700",
  failed: "border-red-300 bg-red-50 text-red-700",
};

const PROOF_LABEL: Record<ProofState, string> = {
  unproven: "unproven",
  covered: "covered",
  "proven-live": "proven live",
  "proven-mock": "proven mock",
  failed: "reproduced",
};

/**
 * Risk lens dialog: deterministic findings over the open project, each
 * citing its records. Any finding can become a linked ADR proposal, or a
 * failure scenario that proves or refutes it against run evidence.
 */
export function RisksDialog({
  project,
  onClose,
  onSelectNode,
  onAddScenario,
}: {
  project: SystemProject;
  onClose: () => void;
  onSelectNode: (id: string) => void;
  onAddScenario?: (draft: ScenarioDraft) => void;
}) {
  const [sequences, setSequences] = useState<SequenceDocument[]>([]);
  const [runs, setRuns] = useState<SystemRunRecord[]>([]);
  const [proposed, setProposed] = useState<Record<string, string>>({});
  const [proved, setProved] = useState<Record<string, string>>({});
  const [tracked, setTracked] = useState<Record<string, string>>({});
  const [regBusy, setRegBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void listSequences()
      .catch(() => [])
      .then((s) => {
        if (live) setSequences(s);
      });
    void listSystemRuns(100)
      .catch(() => [])
      .then((r) => {
        if (live) setRuns(r);
      });
    return () => {
      live = false;
    };
  }, []);

  const findings = useMemo(
    () => analyzeProject(project, sequencesForProject(project, sequences)),
    [project, sequences],
  );
  const proofs = useMemo(
    () => new Map(proveFindings(findings, project.scenarios, runs, project.settings.retentionDays).map((p) => [p.key, p])),
    [findings, project.scenarios, project.settings.retentionDays, runs],
  );

  const propose = async (f: RiskFinding) => {
    const key = findingKey(f);
    const existing = await listDecisions().catch(() => []);
    let d = newDecision(`Risk: ${f.message.slice(0, 120)}`, nextDecisionNumber(existing));
    d = {
      ...d,
      context: `Raised by the risk lens (${f.rule}, ${f.severity}): ${f.message}`,
      history: [...d.history, { at: Date.now(), what: "Raised from the risk lens." }],
    };
    d = linkDecision(d, { surface: "system", recordId: project.id, label: project.name });
    await saveDecision(d);
    setProposed((prev) => ({ ...prev, [key]: d.number }));
  };

  const prove = (f: RiskFinding, draft: ScenarioDraft) => {
    if (!onAddScenario) return;
    onAddScenario(draft);
    setProved((prev) => ({ ...prev, [findingKey(f)]: draft.name }));
  };

  const track = async (f: RiskFinding) => {
    const key = findingKey(f);
    const proof = proofs.get(key);
    const coveringNames = (proof?.scenarioIds ?? [])
      .map((id) => project.scenarios.find((s) => s.id === id)?.name)
      .filter((n): n is string => !!n);
    const base = newConsoleTask(`Prove risk: ${f.rule} - ${f.refs[0]?.name ?? project.name}`);
    const task = {
      ...base,
      body: [
        `${f.message}`,
        proof ? `Proof: ${PROOF_LABEL[proof.state]}.` : null,
        coveringNames.length > 0 ? `Validating scenarios: ${coveringNames.join(", ")}.` : "No validating scenario yet - use Prove it first.",
        `Raised by the risk lens on ${project.name}; run the scenario from the System tab, Scenarios panel.`,
      ]
        .filter(Boolean)
        .join("\n"),
      links: [{ surface: "system" as const, recordId: project.id, label: project.name }],
      history: [...base.history, { at: Date.now(), what: "Tracked from the risk lens." }],
    };
    await saveConsoleTask(task);
    setTracked((prev) => ({ ...prev, [key]: task.id }));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Architecture risks"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
          Risk lens
        </p>
        <h2 className="mt-1 text-lg font-bold text-[var(--color-ink)]">
          {findings.length} finding{findings.length === 1 ? "" : "s"} · {project.name}
        </h2>
        <p className="mt-1 text-[11px] text-ivory-600">
          Deterministic rules over the model - every finding cites its records. Unstated policy reads as
          unchecked, never as safe.
        </p>
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            disabled={regBusy || findings.length === 0}
            onClick={() => {
              setRegBusy(true);
              const states = new Map<string, ProofState>();
              for (const [k, p] of proofs) states.set(k, p.state);
              const safe = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";
              void downloadRiskRegister(project.name, findings, states, `${safe}-risk-register.xlsx`).finally(() => setRegBusy(false));
            }}
            title="Download the risk register as .xlsx"
          >
            {regBusy ? "Building…" : "Register (.xlsx)"}
          </Button>
        </div>
        {findings.length === 0 ? (
          <p className="mt-3 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-3 py-4 text-center text-[12px] text-ivory-600">
            No risks stated against this design. Add timeouts, retries and versions - or enjoy the clean sheet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {findings.map((f) => {
              const key = findingKey(f);
              const proof = proofs.get(key);
              const coveringNames = (proof?.scenarioIds ?? [])
                .map((id) => project.scenarios.find((s) => s.id === id)?.name)
                .filter((n): n is string => !!n);
              const draft = onAddScenario && !proved[key] ? proposeScenario(project, f, sequences) : null;
              return (
                <li key={key} className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-3">
                  <div className="flex items-center gap-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${SEVERITY_STYLE[f.severity]}`}>
                      {f.severity}
                    </span>
                    <span className="font-mono text-[10px] text-ivory-500">{f.rule}</span>
                    {proof && (
                      <span title={coveringNames.length > 0 ? `Validated by: ${coveringNames.join(", ")}` : "No scenario exercises this finding yet"} className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PROOF_STYLE[proof.state]}`}>
                        {PROOF_LABEL[proof.state]}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[12px] leading-snug text-ivory-950">{f.message}</p>
                  {coveringNames.length > 0 && (
                    <p className="mt-1 font-mono text-[10px] text-ivory-500">Validated by: {coveringNames.join(", ")}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {f.refs.map((r) =>
                      r.surface === "system" ? (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => {
                            onSelectNode(r.id);
                            onClose();
                          }}
                          title={`Select ${r.name} on the canvas`}
                          className="cursor-pointer rounded-md border border-[var(--color-line)] bg-white px-1.5 py-0.5 font-mono text-[10px] text-bronze-700 hover:border-bronze-500"
                        >
                          {r.name}
                        </button>
                      ) : (
                        <a
                          key={r.id}
                          href={`/sequence?id=${encodeURIComponent(r.id)}`}
                          title="Open the exact sequence document"
                          className="rounded-md border border-[var(--color-line)] bg-white px-1.5 py-0.5 font-mono text-[10px] text-bronze-700 hover:border-bronze-500"
                        >
                          {r.name}
                        </a>
                      ),
                    )}
                    {proved[key] ? (
                      <span title={`Scenario "${proved[key]}" added - run it from the Scenarios tab`} className="ml-auto font-mono text-[10px] font-bold text-[#2F6B45]">
                        ✓ {proved[key].slice(0, 40)} →
                      </span>
                    ) : draft ? (
                      <button
                        type="button"
                        onClick={() => prove(f, draft)}
                        title={`${draft.rationale} Runs from the Scenarios tab.`}
                        className="ml-auto cursor-pointer rounded-md border border-bronze-500 px-1.5 py-0.5 text-[10px] font-semibold text-bronze-700 hover:bg-bronze-100"
                      >
                        Prove it
                      </button>
                    ) : null}
                    {proposed[key] ? (
                      <a
                        href={`/decisions?id=${encodeURIComponent(proposed[key])}`}
                        title="Open the exact decision"
                        className="ml-auto font-mono text-[10px] font-bold text-[#2F6B45] hover:underline"
                      >
                        {proposed[key]} proposed →
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void propose(f)}
                        title="Propose an ADR answering this finding, pre-linked to this project"
                        className="ml-auto cursor-pointer rounded-md border border-bronze-500 px-1.5 py-0.5 text-[10px] font-semibold text-bronze-700 hover:bg-bronze-100"
                      >
                        Propose ADR
                      </button>
                    )}
                    {tracked[key] ? (
                      <a
                        href={`/console?task=${encodeURIComponent(tracked[key])}`}
                        title="Open the exact Console task"
                        className="font-mono text-[10px] font-bold text-[#2F6B45] hover:underline"
                      >
                        tracked →
                      </a>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void track(f)}
                        title="Log a Console task tracking this finding, linked to this project"
                        className="cursor-pointer rounded-md border border-[var(--color-line)] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-ivory-600 hover:border-bronze-500 hover:text-bronze-700"
                      >
                        Track
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-4 flex justify-end">
          <Button size="sm" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
