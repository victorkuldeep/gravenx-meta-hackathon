"use client";

import { useState } from "react";
import type { ConsoleAttachment, ConsoleTask } from "@/lib/console/model";
import {
  attachJiraFile,
  buildJiraIssueInput,
  createJiraIssue,
  fetchCreateMeta,
  normalizeJiraSite,
  type JiraProject,
} from "@/lib/pmo/jira";
import { clearPmoConnection, getPmoConnection, hasPmoCredentials, setPmoConnection } from "@/lib/pmo/jiraVault";
import { getPmoDefaults, setPmoDefaults } from "@/lib/pmo/defaults";

/**
 * JIRA push: connect once per tab (email + API token, session-only), pick a
 * live project → issue type from createmeta, push the entry. Screenshots ride
 * along as issue attachments. The issue key is stored back on the task as a
 * backlink chip - push-only, no status sync in V1.
 */

const inputCls =
  "w-full rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[12px] text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none";

export function JiraPushPanel({
  task,
  attachments,
  onPatch,
}: {
  task: ConsoleTask;
  attachments: ConsoleAttachment[];
  onPatch: (patch: Partial<ConsoleTask>) => void;
}) {
  // Session vault first, sticky per-org defaults fill the blanks - the
  // next tab on this org starts where the architect left off.
  const [conn, setConn] = useState(() => {
    const v = getPmoConnection();
    const d = getPmoDefaults();
    return {
      ...v,
      projectKey: v.projectKey || d.projectKey || "",
      issueTypeId: v.issueTypeId || d.issueTypeId || "",
    };
  });
  const [projects, setProjects] = useState<JiraProject[] | null>(null);
  const [busy, setBusy] = useState<"projects" | "push" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const connected = hasPmoCredentials(conn);
  const project = projects?.find((p) => p.key === conn.projectKey) ?? null;
  const issueType = project?.issueTypes.find((t) => t.id === conn.issueTypeId) ?? null;

  const update = (patch: Partial<typeof conn>) => setConn((c) => ({ ...c, ...patch }));

  const loadProjects = async () => {
    setBusy("projects");
    setError(null);
    setDone(null);
    const site = normalizeJiraSite(conn.site);
    if (!site.ok) {
      setError(site.error);
      setBusy(null);
      return;
    }
    if (!conn.email.trim() || !conn.token.trim()) {
      setError("Email and API token are both required.");
      setBusy(null);
      return;
    }
    const creds = { site: site.site, email: conn.email.trim(), token: conn.token.trim() };
    try {
      const list = await fetchCreateMeta(creds);
      setProjects(list);
      const kept = setPmoConnection({
        site: site.site,
        email: creds.email,
        token: creds.token,
        projectKey: list.some((p) => p.key === conn.projectKey) ? conn.projectKey : list[0].key,
        issueTypeId: "",
      });
      setConn(kept);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach JIRA.");
    } finally {
      setBusy(null);
    }
  };

  const pickProject = (key: string) => {
    const next = setPmoConnection({ projectKey: key, issueTypeId: "" });
    setConn(next);
    setPmoDefaults({ provider: "jira", projectKey: key });
  };

  const pickIssueType = (id: string) => {
    const next = setPmoConnection({ issueTypeId: id });
    setConn(next);
    setPmoDefaults({ provider: "jira", issueTypeId: id });
  };

  const push = async () => {
    if (!project || !issueType) return;
    setBusy("push");
    setError(null);
    setDone(null);
    try {
      const creds = { site: conn.site, email: conn.email, token: conn.token };
      const ref = await createJiraIssue(creds, buildJiraIssueInput(task, project.key, issueType.id));
      let attached = 0;
      for (const a of attachments) {
        try {
          const blob = await (await fetch(a.dataUrl)).blob();
          await attachJiraFile(creds, ref.key, blob, a.name);
          attached++;
        } catch {
          /* best effort - the issue itself is already created */
        }
      }
      const at = Date.now();
      onPatch({
        pmo: { system: "jira", key: ref.key, url: ref.url, at },
        history: [...task.history, { at, what: `Pushed to JIRA as ${ref.key}.` }].slice(-500),
      });
      setPmoDefaults({ provider: "jira", projectKey: project.key, issueTypeId: issueType.id });
      setDone(
        attached > 0
          ? `Created ${ref.key} with ${attached} screenshot${attached === 1 ? "" : "s"}.`
          : `Created ${ref.key}.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Push failed.");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = () => {
    clearPmoConnection();
    setConn(getPmoConnection());
    setProjects(null);
    setError(null);
    setDone(null);
  };

  return (
    <div className="mt-1.5 rounded-xl border border-[#E8E2D8] bg-[#FBFAF7] p-2.5">
      {task.pmo?.system === "jira" && (
        <p className="mb-1.5 text-[12px] text-[#777168]">
          Pushed as{" "}
          <a href={task.pmo.url} target="_blank" rel="noreferrer" className="font-semibold text-[#8A6A2F] hover:underline">
            {task.pmo.key} ↗
          </a>{" "}
          · pushing again creates a new issue.
        </p>
      )}
      {!connected || !projects ? (
        <div className="space-y-1.5">
          <p className="text-[12px] leading-relaxed text-[#777168]">
            Connect with an email + API token (session-only, never stored). Projects and issue types load live - no
            guessing keys.
          </p>
          <input
            value={conn.site}
            onChange={(e) => update({ site: e.target.value })}
            placeholder="acme.atlassian.net"
            spellCheck={false}
            autoComplete="off"
            aria-label="JIRA site"
            className={inputCls}
          />
          <div className="flex gap-1.5">
            <input
              value={conn.email}
              onChange={(e) => update({ email: e.target.value })}
              placeholder="you@company.com"
              spellCheck={false}
              autoComplete="off"
              aria-label="JIRA email"
              className={inputCls}
            />
            <input
              value={conn.token}
              onChange={(e) => update({ token: e.target.value })}
              placeholder="API token"
              type="password"
              autoComplete="off"
              aria-label="JIRA API token"
              className={inputCls}
            />
          </div>
          <button
            type="button"
            disabled={busy === "projects"}
            onClick={() => void loadProjects()}
            className="cursor-pointer rounded-lg bg-[#27241F] px-2.5 py-1.5 text-xs font-semibold text-[#F5F1E8] hover:bg-[#3A352D] disabled:cursor-default disabled:opacity-40"
          >
            {busy === "projects" ? "Loading projects…" : "Connect & load projects"}
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#777168]">{conn.site}</span>
            <button type="button" onClick={() => void loadProjects()} className="cursor-pointer text-[11px] font-semibold text-[#8A6A2F] hover:underline">
              Reload
            </button>
            <button type="button" onClick={disconnect} className="cursor-pointer text-[11px] text-[#A39B8E] hover:text-red-700 hover:underline">
              Disconnect
            </button>
          </div>
          <div className="flex gap-1.5">
            <label className="flex-1">
              <span className="mb-0.5 block font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Project</span>
              <select
                value={conn.projectKey}
                onChange={(e) => pickProject(e.target.value)}
                aria-label="JIRA project"
                className="w-full cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] font-semibold text-[#27241F] focus:border-[#C9A86A] focus:outline-none"
              >
                {projects.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} ({p.key})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex-1">
              <span className="mb-0.5 block font-mono text-[9px] uppercase tracking-[2px] text-[#A39B8E]">Issue type</span>
              <select
                value={conn.issueTypeId}
                onChange={(e) => pickIssueType(e.target.value)}
                aria-label="JIRA issue type"
                className="w-full cursor-pointer rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] font-semibold text-[#27241F] focus:border-[#C9A86A] focus:outline-none"
              >
                <option value="">Pick…</option>
                {(project?.issueTypes ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={!issueType || busy === "push"}
            onClick={() => void push()}
            className="cursor-pointer rounded-lg bg-[#27241F] px-2.5 py-1.5 text-xs font-semibold text-[#F5F1E8] hover:bg-[#3A352D] disabled:cursor-default disabled:opacity-40"
          >
            {busy === "push" ? "Pushing…" : task.pmo?.system === "jira" ? "Push as new issue" : `Push as ${issueType?.name ?? "issue"}`}
          </button>
          <p className="text-[11px] text-[#A39B8E]">
            Pushes the saved description{attachments.length > 0 ? ` + ${attachments.length} screenshot${attachments.length === 1 ? "" : "s"}` : ""}. Save the description first if you just edited it.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1.5 rounded-lg border border-[#E5AFAF] bg-[#F9E9E9] px-2.5 py-1.5 text-[12px] text-[#A02C2C]">
          {error}
        </p>
      )}
      {done && <p className="mt-1.5 text-[12px] font-semibold text-[#3E6B34]">{done}</p>}
    </div>
  );
}
