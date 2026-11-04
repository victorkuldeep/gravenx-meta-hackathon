"use client";

/**
 * Settings tab: environments (base URLs only - secrets stay in the
 * session vault), production marking with run guardrails, run-evidence
 * retention, and storage maintenance.
 */

import { useEffect, useState } from "react";
import Button from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { deleteSystemRun, listSystemRuns } from "@/lib/system-design/runStore";
import { newId, type SystemProject } from "@/lib/system-design/model";
import { fieldLabel, monoInput, panelShell, textInput, type Mutate } from "./shared";

interface Props {
  project: SystemProject;
  mutate: Mutate;
}

export function SettingsTab({ project, mutate }: Props) {
  const [runCount, setRunCount] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: "", baseUrl: "" });
  const [pendingDeleteEnv, setPendingDeleteEnv] = useState<string | null>(null);
  const [confirmClearRuns, setConfirmClearRuns] = useState(false);

  /** Per-system URL inside one environment. Blank clears back to the node URL. */
  const setOverride = (envId: string, sysId: string, url: string) =>
    mutate((p) => ({
      ...p,
      environments: p.environments.map((x) => {
        if (x.id !== envId) return x;
        const next = { ...(x.baseUrlOverrides ?? {}) };
        if (!url.trim()) delete next[sysId];
        else next[sysId] = url.slice(0, 2000);
        return { ...x, baseUrlOverrides: next };
      }),
    }));

  useEffect(() => {
    let live = true;
    void listSystemRuns(100).then((runs) => {
      if (live) setRunCount(runs.length);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className={panelShell}>
      <h2 className="text-sm font-bold text-ivory-950">Settings</h2>

      <section aria-label="Environments" className="mt-3">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-ivory-950">Environments · {project.environments.length}</h3>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-ivory-600">
          One environment retargets the <strong>whole canvas</strong>: give each environment its own URL per
          system, and switching environment switches all {project.systems.length} system
          {project.systems.length === 1 ? "" : "s"} at once (Sandbox set → Prod set). A system with no
          override below uses its own URL from the canvas node; the fallback covers systems that have
          none. Base URLs only - tokens live in the session vault, never here.
        </p>
        <ul className="mt-1.5 space-y-1.5">
          {project.environments.map((e) => {
            const overCount = Object.keys(e.baseUrlOverrides ?? {}).length;
            return (
              <li key={e.id} className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <label className="flex items-center gap-1.5" title="Active environment for runs">
                    <input
                      type="radio"
                      name="sd-active-env"
                      checked={project.activeEnvironmentId === e.id}
                      onChange={() => mutate((p) => ({ ...p, activeEnvironmentId: e.id }))}
                      className="cursor-pointer accent-amber-800"
                    />
                    <input
                      value={e.name}
                      onChange={(ev) => mutate((p) => ({ ...p, environments: p.environments.map((x) => (x.id === e.id ? { ...x, name: ev.target.value } : x)) }))}
                      spellCheck={false}
                      aria-label="Environment name"
                      className="w-32 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs font-bold text-ivory-950 hover:border-[var(--color-line)] focus:border-bronze-500 focus:outline-none"
                    />
                  </label>
                  {overCount > 0 && (
                    <span className="rounded-md bg-bronze-500/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-bronze-700">
                      {overCount} override{overCount === 1 ? "" : "s"}
                    </span>
                  )}
                  <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] font-bold text-red-700" title="Runs against this environment require an explicit confirm">
                    <input
                      type="checkbox"
                      checked={!!e.isProduction}
                      onChange={(ev) => mutate((p) => ({ ...p, environments: p.environments.map((x) => (x.id === e.id ? { ...x, isProduction: ev.target.checked || undefined } : x)) }))}
                      className="cursor-pointer accent-red-700"
                    />
                    PROD
                  </label>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteEnv(e.id)}
                    aria-label={`Delete environment ${e.name}`}
                    className="ml-auto rounded px-1.5 text-ivory-400 hover:text-red-700 cursor-pointer"
                  >
                    ×
                  </button>
                  {pendingDeleteEnv === e.id && (
                    <ConfirmDialog
                      title={`Delete environment "${e.name}"?`}
                      message="Per-system URL overrides inside it go with it. This cannot be undone."
                      confirmLabel="Delete environment"
                      onCancel={() => setPendingDeleteEnv(null)}
                      onConfirm={() => {
                        setPendingDeleteEnv(null);
                        mutate((p) => ({
                          ...p,
                          environments: p.environments.filter((x) => x.id !== e.id),
                          activeEnvironmentId: p.activeEnvironmentId === e.id ? null : p.activeEnvironmentId,
                        }));
                      }}
                    />
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="w-28 shrink-0 truncate text-[10px] font-semibold uppercase tracking-wider text-ivory-600">Fallback URL</span>
                  <input
                    value={e.baseUrl}
                    onChange={(ev) => mutate((p) => ({ ...p, environments: p.environments.map((x) => (x.id === e.id ? { ...x, baseUrl: ev.target.value } : x)) }))}
                    placeholder="https://… (only when a system has no URL of its own)"
                    spellCheck={false}
                    aria-label={`Fallback base URL for ${e.name}`}
                    className={`${monoInput} min-w-0 flex-1`}
                  />
                </div>
                {project.systems.length === 0 ? (
                  <p className="mt-1.5 text-[11px] text-ivory-500">Add systems on the canvas to set per-system URLs.</p>
                ) : (
                  <ul className="mt-1.5 space-y-1 border-t border-[var(--color-line-soft)] pt-1.5">
                    {project.systems.map((s) => (
                      <li key={s.id} className="flex items-center gap-1.5">
                        <span className="w-28 shrink-0 truncate text-[11px] font-semibold text-ivory-800" title={s.name}>
                          {s.name}
                        </span>
                        <input
                          value={e.baseUrlOverrides?.[s.id] ?? ""}
                          onChange={(ev) => setOverride(e.id, s.id, ev.target.value)}
                          placeholder={s.baseUrl ? `${s.baseUrl} (from node)` : "no URL on node - uses fallback"}
                          spellCheck={false}
                          aria-label={`${s.name} URL in ${e.name}`}
                          className={`${monoInput} min-w-0 flex-1`}
                        />
                        {(e.baseUrlOverrides?.[s.id] ?? "") !== "" && (
                          <button
                            type="button"
                            onClick={() => setOverride(e.id, s.id, "")}
                            aria-label={`Clear ${s.name} override in ${e.name}`}
                            title="Clear override - fall back to the node URL"
                            className="shrink-0 rounded px-1.5 text-ivory-400 hover:text-red-700 cursor-pointer"
                          >
                            ×
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-1.5 flex gap-1.5">
          <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Name, e.g. UAT" spellCheck={false} aria-label="New environment name" className={`${textInput} !w-44 shrink-0`} />
          <input value={draft.baseUrl} onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))} placeholder="Fallback https://…" spellCheck={false} aria-label="New environment fallback URL" className={`${monoInput} min-w-52 flex-1`} />
          <Button
            size="sm"
            disabled={!draft.name.trim()}
            className="shrink-0 whitespace-nowrap"
            onClick={() => {
              if (!draft.name.trim()) return;
              mutate((p) => ({ ...p, environments: [...p.environments, { id: newId("env"), name: draft.name.trim(), baseUrl: draft.baseUrl.trim(), baseUrlOverrides: {} }] }));
              setDraft({ name: "", baseUrl: "" });
            }}
          >
            + Environment
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ivory-600">
          Production environments are a guardrail, not a mode: every run targeting one asks for an explicit confirm first.
        </p>
      </section>

      <section aria-label="Retention" className="mt-4 border-t border-[var(--color-line-soft)] pt-3">
        <h3 className="text-xs font-bold text-ivory-950">Run evidence retention</h3>
        <div className="mt-1.5 flex items-center gap-2">
          <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-ivory-800">
            Keep runs for
            <input
              type="number"
              min={1}
              max={365}
              value={project.settings.retentionDays}
              onChange={(e) => {
                const n = Number(e.target.value);
                mutate((p) => ({ ...p, settings: { retentionDays: !Number.isFinite(n) ? 30 : Math.min(365, Math.max(1, Math.trunc(n))) } }));
              }}
              aria-label="Retention days"
              className={`${monoInput} w-20`}
            />
            days
          </label>
          <span className="text-[11px] text-ivory-500">The Runs tab prunes older evidence on request - nothing auto-deletes.</span>
        </div>
      </section>

      <section aria-label="Storage" className="mt-4 border-t border-[var(--color-line-soft)] pt-3">
        <h3 className="text-xs font-bold text-ivory-950">Storage</h3>
        <div className="mt-1.5 flex items-center gap-2">
          <p className="text-xs text-ivory-700">{runCount === null ? "Counting run evidence…" : `${runCount} saved run${runCount === 1 ? "" : "s"} in this browser.`}</p>
          <Button
            size="sm"
            variant="ghost"
            disabled={!runCount}
            onClick={() => setConfirmClearRuns(true)}
          >
            Clear all runs
          </Button>
          {confirmClearRuns && (
            <ConfirmDialog
              title="Delete ALL saved run evidence?"
              message="Every run in this browser is purged - the Runs tab goes empty. This cannot be undone."
              confirmLabel="Delete everything"
              tone="danger"
              onCancel={() => setConfirmClearRuns(false)}
              onConfirm={() => {
                setConfirmClearRuns(false);
                void (async () => {
                  const all = await listSystemRuns(100);
                  for (const r of all) await deleteSystemRun(r.id);
                  setRunCount(0);
                })();
              }}
            />
          )}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-ivory-600">
          <span className={fieldLabel}>Safety</span>
          Real calls go through the allowlisted execution proxy; private hosts (VPN / Zscaler) are unreachable by design - mock those operations instead. Never paste literal secrets into headers, mocks, or payloads; use vault variables.
        </p>
      </section>
    </div>
  );
}
