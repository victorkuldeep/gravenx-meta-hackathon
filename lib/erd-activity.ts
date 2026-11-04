import { STORES, withStore } from "@/lib/db";

/**
 * Arch Activity - the audit trail for ORG MUTATIONS made from the ERD.
 *
 * Principle: canvas-local curation (place/hide/remove/tags/filters) is
 * reversible and covered by snapshots, so it stays OUT. Everything that
 * touches the org - metadata deploys (object/field/relationship) and record
 * edits - lands HERE with timestamp, actor, surface context and outcome.
 * That makes every metadata change traceable and exportable (JIRA/back-sync
 * read this, never the canvas).
 */

export type ArchActor = "architect" | "agent-bridge";
export type ArchCategory = "metadata" | "data";
export type ArchAction =
  | "create-object"
  | "create-field"
  | "create-relationship"
  | "update-record"
  | "deploy-failed";

export interface ArchActivityEntry {
  id: string;
  /** Epoch ms. */
  at: number;
  actor: ArchActor;
  /** Always "erd" today; kept so System/Sequence mutations can join later. */
  surface: string;
  /** ERD view at action time. */
  view?: string;
  /** Canvas root object at action time. */
  root?: string;
  category: ArchCategory;
  action: ArchAction;
  /** e.g. "Account.Tier__c" or "Account/001…". */
  target: string;
  ok: boolean;
  /** Human outcome line - never contains tokens. */
  message: string;
}

const MAX_EVENTS = 500;

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto)
      return `arch_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    /* fall through */
  }
  return `arch_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function buildEntry(e: Omit<ArchActivityEntry, "id" | "at">, at = Date.now()): ArchActivityEntry {
  return { ...e, id: newId(), at };
}

export async function logArchActivity(e: Omit<ArchActivityEntry, "id" | "at">): Promise<void> {
  const entry = buildEntry(e);
  try {
    await withStore(STORES.archActivity, "readwrite", (s) => s.put(entry));
    const all = await withStore<ArchActivityEntry[]>(STORES.archActivity, "readonly", (s) => s.getAll());
    if (all.length > MAX_EVENTS) {
      const drop = all.sort((a, b) => a.at - b.at).slice(0, all.length - MAX_EVENTS);
      await withStore(STORES.archActivity, "readwrite", (s) => {
        for (const d of drop) s.delete(d.id);
        return s.getAll();
      });
    }
  } catch {
    /* audit never breaks the studio */
  }
}

export async function listArchActivity(limit = 200): Promise<ArchActivityEntry[]> {
  try {
    const all = await withStore<ArchActivityEntry[]>(STORES.archActivity, "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.at - a.at).slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}

export async function clearArchActivity(): Promise<void> {
  try {
    await withStore(STORES.archActivity, "readwrite", (s) => s.clear());
  } catch {
    /* ignore */
  }
}

function fmtTime(at: number): string {
  try {
    return new Date(at).toISOString();
  } catch {
    return String(at);
  }
}

/** Markdown "Arch Activity" report - paste into JIRA/Confluence or attach. */
export function renderActivityReport(entries: ArchActivityEntry[], orgHost: string): string {
  const sorted = [...entries].sort((a, b) => a.at - b.at);
  const ok = sorted.filter((e) => e.ok).length;
  const lines = [
    `# Arch Activity - GRAVENX ERD`,
    ``,
    `- Exported: ${fmtTime(Date.now())}`,
    `- Org: ${orgHost || "unknown"}`,
    `- Actions: ${sorted.length} (${ok} succeeded, ${sorted.length - ok} failed)`,
    ``,
    `| Time (UTC) | Actor | Category | Action | Target | Outcome | Detail |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
  ];
  for (const e of sorted) {
    const cell = (v: string) => v.replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(
      `| ${fmtTime(e.at)} | ${e.actor} | ${e.category} | ${e.action} | ${cell(e.target)} | ${e.ok ? "ok" : "FAILED"} | ${cell(e.message)} |`
    );
  }
  lines.push(``, `_Canvas-local curation (place/hide/remove/tags) is excluded by design - snapshots cover it._`);
  return lines.join("\n");
}
