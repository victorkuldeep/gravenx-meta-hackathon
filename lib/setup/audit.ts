import { STORES, withStore } from "@/lib/db";

/**
 * Agent audit trail - every model tool call, success or fail, newest
 * first, capped. The Setup tab reads this; AiDock writes it (auto tools
 * and Apply/Discard resolutions alike). Best-effort off-browser.
 */

export interface AuditEvent {
  id: string;
  at: number;
  skill: string;
  tool: string;
  label: string;
  ok: boolean;
  detail?: string;
}

const MAX_EVENTS = 200;

function newId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `audit_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    /* fall through */
  }
  return `audit_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function logToolRun(e: Omit<AuditEvent, "id" | "at">): Promise<void> {
  const entry: AuditEvent = { ...e, id: newId(), at: Date.now() };
  try {
    await withStore(STORES.agentAudit, "readwrite", (s) => s.put(entry));
    const all = await withStore<AuditEvent[]>(STORES.agentAudit, "readonly", (s) => s.getAll());
    if (all.length > MAX_EVENTS) {
      const drop = all.sort((a, b) => a.at - b.at).slice(0, all.length - MAX_EVENTS);
      await withStore(STORES.agentAudit, "readwrite", (s) => {
        for (const d of drop) s.delete(d.id);
        // Return the last request so withStore resolves after the batch.
        return s.getAll();
      });
    }
  } catch {
    /* audit never breaks the agent */
  }
}

export async function listAuditRuns(limit = 100): Promise<AuditEvent[]> {
  try {
    const all = await withStore<AuditEvent[]>(STORES.agentAudit, "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.at - a.at).slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}

export async function clearAudit(): Promise<void> {
  try {
    await withStore(STORES.agentAudit, "readwrite", (s) => s.clear());
  } catch {
    /* ignore */
  }
}
