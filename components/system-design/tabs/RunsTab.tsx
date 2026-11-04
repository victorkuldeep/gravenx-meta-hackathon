"use client";

/**
 * Runs & Observability tab: every persisted run (single, edge, chain) with
 * per-hop evidence, Markdown export, and retention pruning. Runs keep
 * pinned evidence - reopening one never re-executes anything.
 */

import { useCallback, useEffect, useState } from "react";
import Button from "../../ui/Button";
import { ConfirmDialog, PromptDialog } from "../../ui/ConfirmDialog";
import { deleteSystemRun, listSystemRuns, saveSystemRun, type SystemRunRecord } from "@/lib/system-design/runStore";
import { computeVerdict } from "@/lib/system-design/verdict";
import { downloadRunMarkdown, renderRunMarkdown } from "@/lib/system-design/runMarkdown";
import { fieldLabel, panelShell, type Mutate } from "./shared";
import type { SystemProject } from "@/lib/system-design/model";

interface Props {
  project: SystemProject;
  mutate: Mutate;
}

export function recordToMarkdown(projectName: string, r: SystemRunRecord): string {
  return renderRunMarkdown({
    title: `Run evidence - ${r.operationName}`,
    projectName,
    environmentName: r.environmentName,
    startedAt: r.createdAt,
    seedBody: r.requestBodyPreview || "_empty_",
    lanes: [
      {
        path: [r.systemName, r.operationName],
        hops: (r.steps ?? []).map((s) => ({
          label: s.label,
          status: s.status >= 100 && s.status < 400 ? ("ok" as const) : ("failed" as const),
          durationMs: s.durationMs,
          endpoint: s.endpoint,
          requestBody: s.requestBodyPreview ?? "",
          responseBody: s.responseBodyPreview ?? "",
          note: s.statusText,
        })),
        stopped: null,
      },
    ],
  });
}

export function RunsTab({ project }: Props) {
  const [runs, setRuns] = useState<SystemRunRecord[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setRuns(await listSystemRuns(100));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const retentionMs = project.settings.retentionDays * 24 * 3600 * 1000;
  const stale = runs.filter((r) => Date.now() - r.createdAt > retentionMs);

  const [confirmPrune, setConfirmPrune] = useState(false);
  const [pendingDeleteRun, setPendingDeleteRun] = useState<string | null>(null);
  const [signRun, setSignRun] = useState<SystemRunRecord | null>(null);

  const prune = async () => {
    if (stale.length === 0) return;
    setConfirmPrune(false);
    setBusy(true);
    try {
      for (const r of stale) await deleteSystemRun(r.id);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={panelShell}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-ivory-950">Runs & Observability · {runs.length}</h2>
        <span className="text-[11px] text-ivory-500">pinned evidence · retention {project.settings.retentionDays}d (Settings)</span>
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" disabled={busy || stale.length === 0} onClick={() => setConfirmPrune(true)}>
            Prune {stale.length > 0 ? `${stale.length} stale` : "stale"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>Refresh</Button>
        </div>
      </div>
      {confirmPrune && (
        <ConfirmDialog
          title={`Delete ${stale.length} stale run${stale.length === 1 ? "" : "s"}?`}
          message={`Runs older than ${project.settings.retentionDays} days are purged. This cannot be undone.`}
          confirmLabel="Delete stale runs"
          onCancel={() => setConfirmPrune(false)}
          onConfirm={() => void prune()}
        />
      )}

      {runs.length === 0 ? (
        <p className="mt-3 text-xs text-ivory-500">No runs saved yet - test an operation or run a chain and the evidence lands here.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {runs.map((r) => {
            const open = openId === r.id;
            const ok = r.status >= 100 && r.status < 400;
            return (
              <li key={r.id} className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${ok ? "bg-green-600" : "bg-red-600"}`} />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ivory-950">
                    {r.operationName} <span className="font-mono font-normal text-ivory-500">{r.method} · {r.systemName} · {r.environmentName} · {r.kind ?? "single"}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-ivory-500">
                    {r.status} · {r.durationMs}ms · {new Date(r.createdAt).toLocaleString()}
                  </span>
                  {r.scenarioId && (
                    <span title={`Launched by scenario ${project.scenarios.find((s) => s.id === r.scenarioId)?.name ?? r.scenarioId}`} className="shrink-0 rounded-md border border-[var(--color-line)] bg-white px-1.5 py-0.5 font-mono text-[10px] text-bronze-700">
                      {project.scenarios.find((s) => s.id === r.scenarioId)?.name ?? "deleted scenario"}
                    </span>
                  )}
                  {r.verdict && (
                    <span title={r.verdict === "override-pass" ? `Signed override${r.verdictNote ? `: ${r.verdictNote}` : ""}` : `Expected ${project.scenarios.find((s) => s.id === r.scenarioId)?.expectStatus ?? "?"} · deterministic`} className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold ${r.verdict === "fail" ? "border-red-300 bg-red-50 text-red-700" : "border-[#2F6B45] bg-[#2F6B45]/10 text-[#2F6B45]"}`}>
                      {r.verdict === "override-pass" ? "override-pass" : r.verdict}
                    </span>
                  )}
                  <button type="button" onClick={() => setOpenId(open ? null : r.id)} aria-expanded={open} className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-ivory-600 hover:bg-ivory-300 cursor-pointer">{open ? "▾" : "▸"}</button>
                  <button
                    type="button"
                    onClick={() => downloadRunMarkdown(recordToMarkdown(project.name, r), `run-${r.id}.md`)}
                    className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-bronze-600 hover:bg-bronze-500/10 cursor-pointer"
                  >
                    .md
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteRun(r.id)}
                    aria-label="Delete run"
                    className="rounded px-1.5 py-0.5 text-ivory-400 hover:text-red-700 cursor-pointer"
                  >
                    ×
                  </button>
                  {pendingDeleteRun === r.id && (
                    <ConfirmDialog
                      title="Delete this run evidence?"
                      message="The pinned request, response and timings are removed. This cannot be undone."
                      confirmLabel="Delete run"
                      onCancel={() => setPendingDeleteRun(null)}
                      onConfirm={() => {
                        setPendingDeleteRun(null);
                        void deleteSystemRun(r.id).then(refresh);
                      }}
                    />
                  )}
                </div>
                {open && (
                  <div className="mt-2 space-y-1.5 border-t border-[var(--color-line-soft)] pt-2">
                    <p className={fieldLabel}>Endpoint</p>
                    <p className="break-all font-mono text-[10px] text-ivory-700">{r.endpoint}{r.truncated ? " · (truncated preview)" : ""}</p>
                    {r.scenarioId && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[10px] text-ivory-500">
                          Verdict {r.verdict ?? "none - scenario states no expectation"} · pinned at save, never re-judged.
                        </span>
                        {r.verdict === "override-pass" ? (
                          <button
                            type="button"
                            onClick={() => {
                              const s = project.scenarios.find((x) => x.id === r.scenarioId);
                              const next = s ? computeVerdict(s.expectStatus, r.status) : null;
                              const cleared: SystemRunRecord = { ...r };
                              delete cleared.verdict;
                              delete cleared.verdictNote;
                              if (next) cleared.verdict = next;
                              void saveSystemRun(cleared).then(refresh);
                            }}
                            className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-bronze-600 hover:bg-bronze-500/10 cursor-pointer"
                          >
                            Clear override
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setSignRun(r)}
                              className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-bronze-600 hover:bg-bronze-500/10 cursor-pointer"
                            >
                              Mark handled
                            </button>
                            {signRun?.id === r.id && (
                              <PromptDialog
                                title="Sign this override"
                                message="Why does this run count as handled? The note is pinned to the evidence."
                                inputLabel="Override reason"
                                placeholder="e.g. downstream returned 202 after retry - verified in logs"
                                confirmLabel="Sign override"
                                onCancel={() => setSignRun(null)}
                                onConfirm={(note) => {
                                  setSignRun(null);
                                  const signed: SystemRunRecord = { ...r, verdict: "override-pass" };
                                  if (note) signed.verdictNote = note.slice(0, 500);
                                  void saveSystemRun(signed).then(refresh);
                                }}
                              />
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {(r.steps ?? []).length > 0 && (
                      <>
                        <p className={fieldLabel}>Hops ({r.steps!.length})</p>
                        <ul className="space-y-1">
                          {r.steps!.map((s, i) => (
                            <li key={i} className="flex items-center gap-1.5 font-mono text-[10px] text-ivory-700">
                              <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.status >= 100 && s.status < 400 ? "bg-green-600" : "bg-red-600"}`} />
                              <span className="min-w-0 flex-1 truncate">{s.label}</span>
                              <span className="shrink-0 text-ivory-500">{s.status} · {s.durationMs}ms</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                      <div>
                        <p className={fieldLabel}>Request</p>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ivory-950 p-2 font-mono text-[10px] text-ivory-100">{r.requestBodyPreview || "_empty_"}</pre>
                      </div>
                      <div>
                        <p className={fieldLabel}>Response</p>
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-ivory-950 p-2 font-mono text-[10px] text-ivory-100">{r.responseBodyPreview || "_empty_"}</pre>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
