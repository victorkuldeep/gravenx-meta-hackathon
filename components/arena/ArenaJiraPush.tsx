"use client";

import { useState } from "react";
import {
  createJiraIssue,
  fetchCreateMeta,
  mdToAdf,
  normalizeJiraSite,
  type JiraProject,
} from "@/lib/pmo/jira";
import { clearPmoConnection, getPmoConnection, hasPmoCredentials, setPmoConnection } from "@/lib/pmo/jiraVault";
import { getPmoDefaults, setPmoDefaults } from "@/lib/pmo/defaults";

const inputCls =
  "w-full rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-1.5 text-[12px] placeholder:text-ivory-400";

/**
 * Arena → Jira one-click attach-back: the session handoff brief (problem,
 * rounds, artifacts, active context) becomes the issue description, so the
 * decisions and design travel to the ticket together. Session-only creds.
 */
export function ArenaJiraPush({ title, brief }: { title: string; brief: string }) {
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
    try {
      const list = await fetchCreateMeta({ site: site.site, email: conn.email.trim(), token: conn.token.trim() });
      setProjects(list);
      setConn(
        setPmoConnection({
          site: site.site,
          email: conn.email.trim(),
          token: conn.token.trim(),
          projectKey: list.some((p) => p.key === conn.projectKey) ? conn.projectKey : list[0].key,
          issueTypeId: "",
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach JIRA.");
    } finally {
      setBusy(null);
    }
  };

  const push = async () => {
    if (!project || !issueType) return;
    setBusy("push");
    setError(null);
    setDone(null);
    try {
      const creds = { site: conn.site, email: conn.email, token: conn.token };
      const ref = await createJiraIssue(creds, {
        projectKey: project.key,
        issueTypeId: issueType.id,
        summary: title.trim().slice(0, 255) || "GRAVENX Arena session",
        description: mdToAdf(brief.trim() || "_Empty session brief._"),
        labels: ["gravenx-arena"],
      });
      setPmoDefaults({ provider: "jira", projectKey: project.key, issueTypeId: issueType.id });
      setDone(`Created ${ref.key}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Push failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-[var(--color-line)] bg-white p-2.5">
      {!connected || !projects ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-ivory-600">Connect Jira once per tab - email + API token, session-only.</p>
          <input value={conn.site} onChange={(e) => update({ site: e.target.value })} placeholder="acme.atlassian.net" spellCheck={false} autoComplete="off" aria-label="JIRA site" className={inputCls} />
          <div className="flex gap-1.5">
            <input value={conn.email} onChange={(e) => update({ email: e.target.value })} placeholder="you@company.com" spellCheck={false} autoComplete="off" aria-label="JIRA email" className={inputCls} />
            <input value={conn.token} onChange={(e) => update({ token: e.target.value })} placeholder="API token" type="password" spellCheck={false} autoComplete="off" aria-label="JIRA API token" className={inputCls} />
          </div>
          <button
            type="button"
            onClick={() => void loadProjects()}
            disabled={busy === "projects"}
            className="cursor-pointer rounded-lg bg-ivory-950 px-3 py-1.5 text-[12px] font-bold text-ivory-100 hover:bg-ivory-800 disabled:opacity-50"
          >
            {busy === "projects" ? "Connecting…" : "Connect Jira"}
          </button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            <select value={conn.projectKey} onChange={(e) => update({ projectKey: e.target.value, issueTypeId: "" })} aria-label="JIRA project" className="rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 text-[12px]">
              {projects.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.key} · {p.name}
                </option>
              ))}
            </select>
            <select value={conn.issueTypeId} onChange={(e) => update({ issueTypeId: e.target.value })} aria-label="Issue type" className="rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 text-[12px]">
              <option value="">Issue type…</option>
              {(project?.issueTypes ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                clearPmoConnection();
                setConn(getPmoConnection());
                setProjects(null);
              }}
              className="cursor-pointer rounded px-2 text-[11px] text-ivory-500 hover:text-ivory-950"
            >
              Disconnect
            </button>
          </div>
          <button
            type="button"
            onClick={() => void push()}
            disabled={!issueType || busy === "push"}
            className="cursor-pointer rounded-lg bg-bronze-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-bronze-700 disabled:opacity-50"
          >
            {busy === "push" ? "Pushing…" : "Attach brief to Jira"}
          </button>
        </div>
      )}
      {error && <p className="mt-1.5 text-[12px] text-red-700">{error}</p>}
      {done && <p className="mt-1.5 text-[12px] font-bold text-emerald-700">{done}</p>}
    </div>
  );
}
