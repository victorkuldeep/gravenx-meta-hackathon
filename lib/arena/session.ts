/**
 * EngineeringSession: the persistent unit of Arena work. The LLM context
 * window is temporary - the session is the source of truth that survives it.
 *
 * problem -> context (org + Jira + grounding) -> rounds of discussion ->
 * acceptance -> artifacts (visuals by address) -> work packages -> handoff.
 */
import { STORES, withStore } from "@/lib/db";
import type { GroundingDoc } from "./grounding";

export type SessionStatus = "open" | "discussing" | "accepted" | "handed-off";
export type RoundKind = "problem" | "finding" | "proposal" | "critique" | "revision" | "decision" | "note";

export interface SessionRound {
  id: string;
  kind: RoundKind;
  body: string;
  createdAt: number;
}

export interface SessionArtifact {
  kind: "system" | "sequence" | "wireframe" | "draw" | "adr" | "requirement" | "workpackage" | "note";
  /** Address, never a copy: canvas id / ADR number / note id. */
  ref: string;
  label: string;
}

export interface EngineeringSession {
  id: string;
  title: string;
  problem: string;
  jiraRef: string;
  orgKey: string;
  /** Built-in skill pack names active for this session. */
  skillIds: string[];
  /** Custom grounding doc ids active for this session. */
  groundingIds: string[];
  status: SessionStatus;
  rounds: SessionRound[];
  artifacts: SessionArtifact[];
  createdAt: number;
  updatedAt: number;
}

export function newSession(title: string): EngineeringSession {
  const now = Date.now();
  return {
    id: `sess_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    title: title.trim() || "Untitled session",
    problem: "",
    jiraRef: "",
    orgKey: "",
    skillIds: [],
    groundingIds: [],
    status: "open",
    rounds: [],
    artifacts: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function addRound(s: EngineeringSession, kind: RoundKind, body: string): EngineeringSession {
  if (!body.trim()) return s;
  return {
    ...s,
    status: s.status === "open" ? "discussing" : s.status,
    rounds: [...s.rounds, { id: `rnd_${Date.now().toString(36)}`, kind, body: body.trim(), createdAt: Date.now() }],
    updatedAt: Date.now(),
  };
}

export interface ComposedContext {
  sections: { title: string; body: string }[];
  totalBytes: number;
  /** Custom doc names shadowing built-in pack names - custom wins, stated openly. */
  overrides: string[];
}

const BUILTIN_PREFIX = "GRAVENX built-in";
const CUSTOM_PREFIX = "Org grounding (architect-owned)";

/**
 * Merge built-in packs + enabled custom docs into one ordered context.
 * Pure - the Arena panel and (later) the agent loop share it, so what the
 * architect sees composed is byte-identical to what the LLM receives.
 */
export function composeSessionContext(
  session: EngineeringSession,
  packs: { name: string; label: string; system: string }[],
  docs: GroundingDoc[]
): ComposedContext {
  const active = docs.filter((d) => session.groundingIds.includes(d.id));
  const packNames = new Set(packs.map((p) => p.name.toLowerCase()));
  const overrides = active.filter((d) => packNames.has(d.name.trim().toLowerCase())).map((d) => d.name);
  const sections = [
    ...packs
      .filter((p) => session.skillIds.includes(p.name))
      .map((p) => ({ title: `${BUILTIN_PREFIX} · ${p.label}`, body: p.system })),
    ...active.map((d) => ({ title: `${CUSTOM_PREFIX} · ${d.name}`, body: d.content })),
  ];
  return { sections, totalBytes: sections.reduce((n, s) => n + s.title.length + s.body.length, 0), overrides };
}

/** One-click handoff brief: problem, rounds, artifacts, active context names. */
export function sessionBrief(s: EngineeringSession, contextTitles: string[]): string {
  const lines = [`# ${s.title}`, ``, `Status: ${s.status}`, ``];
  if (s.jiraRef) lines.push(`Jira: ${s.jiraRef}`, ``);
  if (s.problem) lines.push(`## Problem`, ``, s.problem, ``);
  if (contextTitles.length > 0) lines.push(`## Active context`, ``, ...contextTitles.map((t) => `- ${t}`), ``);
  for (const r of s.rounds) lines.push(`## ${r.kind}`, ``, r.body, ``);
  if (s.artifacts.length > 0) {
    lines.push(`## Artifacts`, ``, ...s.artifacts.map((a) => `- [${a.kind}] ${a.label} (${a.ref})`), ``);
  }
  return lines.join("\n");
}

export async function listSessions(): Promise<EngineeringSession[]> {
  try {
    const all = await withStore<EngineeringSession[]>(STORES.arenaSessions, "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveSession(s: EngineeringSession): Promise<boolean> {
  try {
    await withStore(STORES.arenaSessions, "readwrite", (st) => st.put({ ...s, updatedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export async function deleteSession(id: string): Promise<boolean> {
  try {
    await withStore(STORES.arenaSessions, "readwrite", (s) => s.delete(id));
    return true;
  } catch {
    return false;
  }
}
