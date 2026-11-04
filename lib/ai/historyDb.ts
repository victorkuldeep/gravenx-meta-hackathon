import { STORES, withStore } from "@/lib/db";

/**
 * Agentic session history, persisted per Salesforce org.
 *
 * Without this the agent is amnesiac: every chat re-derives context the
 * user already gave. Sessions live in the central `gravenx-studio` DB
 * (ai-sessions store), scoped by org key so switching orgs switches
 * memory. Cap 30 per org, oldest pruned on save. All functions degrade
 * to safe empties off-browser (tests, SSR) instead of throwing.
 */

export interface StoredTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiSession {
  id: string;
  orgKey: string;
  title: string;
  providerId: string;
  modelId: string;
  skillName: string;
  turns: StoredTurn[];
  totalIn: number;
  totalOut: number;
  createdAt: number;
  updatedAt: number;
}

export interface SessionDraft {
  providerId: string;
  modelId: string;
  skillName: string;
  turns: StoredTurn[];
  totalIn: number;
  totalOut: number;
}

const MAX_PER_ORG = 30;

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `ai_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    /* fall through */
  }
  return `ai_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newSessionId(): string {
  return newId();
}

/** Title from the first user message, markdown-stripped, capped. */
export function titleForTurns(turns: StoredTurn[]): string {
  const first = turns.find((t) => t.role === "user" && t.content.trim());
  if (!first) return "New conversation";
  const clean = first.content.replace(/[#*`_>\[\]()]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return "New conversation";
  return clean.length > 55 ? `${clean.slice(0, 52)}…` : clean;
}

export async function saveAiSession(orgKey: string, id: string, draft: SessionDraft): Promise<boolean> {
  const turns = draft.turns.filter((t) => t.content.trim() !== "");
  if (turns.length === 0) return false;
  try {
    const existing = await withStore<AiSession | undefined>(STORES.aiSessions, "readonly", (s) => s.get(id)).catch(() => undefined);
    const now = Date.now();
    const record: AiSession = {
      id,
      orgKey,
      title: titleForTurns(turns),
      providerId: draft.providerId,
      modelId: draft.modelId,
      skillName: draft.skillName,
      turns,
      totalIn: draft.totalIn,
      totalOut: draft.totalOut,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await withStore(STORES.aiSessions, "readwrite", (s) => s.put(record));
    // Prune beyond cap (fire-and-forget safe: failure leaves extras).
    try {
      const all = await withStore<AiSession[]>(STORES.aiSessions, "readonly", (s) => s.getAll());
      const mine = all.filter((r) => r.orgKey === orgKey).sort((a, b) => b.updatedAt - a.updatedAt);
      for (const extra of mine.slice(MAX_PER_ORG)) {
        await withStore(STORES.aiSessions, "readwrite", (s) => s.delete(extra.id));
      }
    } catch {
      /* prune is best-effort */
    }
    return true;
  } catch {
    return false;
  }
}

export async function listAiSessions(orgKey: string): Promise<AiSession[]> {
  return (await listAllAiSessions()).filter((r) => r.orgKey === orgKey);
}

/** Every session in this browser, newest first - powers Setup usage + recent orgs. */
export async function listAllAiSessions(): Promise<AiSession[]> {
  try {
    const all = await withStore<AiSession[]>(STORES.aiSessions, "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function loadAiSession(id: string): Promise<AiSession | null> {
  try {
    return (await withStore<AiSession | undefined>(STORES.aiSessions, "readonly", (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}

export async function deleteAiSession(id: string): Promise<boolean> {
  try {
    await withStore(STORES.aiSessions, "readwrite", (s) => s.delete(id));
    return true;
  } catch {
    return false;
  }
}
