import { STORES, withStore } from "@/lib/db";
import { debugSessionSchema, type DebugSession } from "./model";

/**
 * Debug Session persistence. Sessions live in the central gravenx-studio
 * DB (debug-sessions store), scoped by org key so switching orgs switches
 * investigations. Cap 20 per org, oldest pruned on save. Raw log bodies
 * ride inside the session's CapturedLog records (capped at capture time).
 * All functions degrade to safe empties off-browser instead of throwing.
 */

const MAX_PER_ORG = 20;

export async function listDebugSessions(orgKey: string): Promise<DebugSession[]> {
  try {
    const all = await withStore<DebugSession[]>(STORES.debugSessions, "readonly", (s) => s.getAll());
    const mine = (Array.isArray(all) ? all : [])
      .map((rec) => debugSessionSchema.safeParse(rec))
      .filter((p) => p.success && p.data.orgKey === orgKey)
      .map((p) => (p as { data: DebugSession }).data)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return mine;
  } catch {
    return [];
  }
}

export async function loadDebugSession(id: string): Promise<DebugSession | null> {
  try {
    const rec = await withStore<unknown>(STORES.debugSessions, "readonly", (s) => s.get(id));
    const parsed = debugSessionSchema.safeParse(rec);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function saveDebugSession(session: DebugSession): Promise<{ ok: boolean; error?: string }> {
  try {
    const parsed = debugSessionSchema.safeParse(session);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return { ok: false, error: `Session failed validation (${first?.path.join(".") || "session"}: ${first?.message || "invalid"}).` };
    }
    const next: DebugSession = { ...parsed.data, updatedAt: Date.now() };
    await withStore(STORES.debugSessions, "readwrite", (s) => s.put(next));
    const mine = await listDebugSessions(next.orgKey);
    const overflow = mine.slice(MAX_PER_ORG);
    await Promise.all(overflow.map((old) => withStore(STORES.debugSessions, "readwrite", (s) => s.delete(old.id)).catch(() => undefined)));
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown storage error";
    const blocked = msg.includes("blocked");
    return {
      ok: false,
      error: blocked
        ? `Database upgrade is blocked by another open GRAVENX tab (${msg}). Close other tabs and retry - it auto-retries first.`
        : `Storage failed: ${msg}`,
    };
  }
}

export async function deleteDebugSession(id: string): Promise<boolean> {
  try {
    await withStore(STORES.debugSessions, "readwrite", (s) => s.delete(id));
    return true;
  } catch {
    return false;
  }
}
