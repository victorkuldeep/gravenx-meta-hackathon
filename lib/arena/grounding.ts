/**
 * Arena grounding library: architect-owned context the LLM must reason with -
 * client framework skills, AGENTS.md / MUSE.md agent files, API specs, and
 * any Markdown the org runs on. Built-in skill packs teach the *how*;
 * grounding teaches the *here* (this org, this framework, these rules).
 *
 * Docs are org-agnostic by default and opt-in per session - the composer
 * (session.ts) merges enabled docs with built-in packs, custom content
 * winning on conflict and saying so.
 */
export type GroundingKind = "skill" | "agent-file" | "framework" | "doc";

export interface GroundingDoc {
  id: string;
  name: string;
  kind: GroundingKind;
  /** Raw markdown/text. Pasted or uploaded - never fetched remotely. */
  content: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export const KIND_LABEL: Record<GroundingKind, string> = {
  skill: "Skill",
  "agent-file": "Agent file",
  framework: "Framework",
  doc: "Doc",
};

/** Per-doc cap - keeps a session composable and the composer honest. */
export const MAX_DOC_BYTES = 100 * 1024;

export function newGroundingDoc(name: string, kind: GroundingKind, content: string): GroundingDoc {
  const now = Date.now();
  const clean = content.length > MAX_DOC_BYTES ? content.slice(0, MAX_DOC_BYTES) : content;
  return {
    id: `gnd_${now.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: name.trim() || "Untitled grounding",
    kind,
    content: clean,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function groundingBytes(docs: GroundingDoc[]): number {
  return docs.reduce((n, d) => n + d.content.length, 0);
}

export function validateGrounding(name: string, content: string): string | null {
  if (!name.trim()) return "Give the context a name.";
  if (!content.trim()) return "Content is empty - paste Markdown or upload a file.";
  if (content.length > MAX_DOC_BYTES * 4) return `That file is ${(content.length / 1024).toFixed(0)}KB - trim it under ${MAX_DOC_BYTES / 1024}KB so sessions stay composable.`;
  return null;
}
