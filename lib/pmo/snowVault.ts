"use client";

import { normalizeSnowInstance } from "./snow";

/**
 * Session-only vault for the ServiceNow connection. Same posture as the
 * JIRA vault (lib/pmo/jiraVault.ts): secrets live in tab memory + a
 * sessionStorage mirror and die with the tab - never IDB, tasks, exports
 * or logs (except the explicit encrypted opt-in in lib/pmo/secureStore.ts).
 * The table pick is convenience, also session-only; the sticky
 * per-org default lives in lib/pmo/defaults.ts (non-secret, persistent).
 */

const STORE_KEY = "gravenx_pmo_snow_v1";

export interface SnowConnection {
  instance: string;
  user: string;
  pass: string;
  table: string;
}

const EMPTY: SnowConnection = { instance: "", user: "", pass: "", table: "incident" };

let mem: SnowConnection | null = null;

function readStore(): SnowConnection {
  if (mem) return { ...mem };
  mem = { ...EMPTY };
  try {
    if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const p = parsed as Record<string, unknown>;
          for (const k of ["instance", "user", "pass", "table"] as const) {
            if (typeof p[k] === "string" && (p[k] as string)) mem[k] = p[k] as string;
          }
        }
      }
    }
  } catch {
    mem = { ...EMPTY };
  }
  return { ...mem };
}

function writeStore(next: SnowConnection): void {
  mem = { ...next };
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(STORE_KEY, JSON.stringify(mem));
  } catch {
    /* quota/private mode - memory still holds the connection for this view */
  }
}

export function getSnowConnection(): SnowConnection {
  return readStore();
}

export function setSnowConnection(next: Partial<SnowConnection>): SnowConnection {
  const rawInstance = (next.instance ?? mem?.instance ?? "").trim();
  const norm = normalizeSnowInstance(rawInstance);
  const out: SnowConnection = {
    // Canonical origin when it parses - every reader gets the same instance.
    instance: norm.ok ? norm.instance : rawInstance,
    user: (next.user ?? mem?.user ?? "").trim(),
    pass: (next.pass ?? mem?.pass ?? "").trim(),
    table: (next.table ?? mem?.table ?? "").trim() || "incident",
  };
  // Never persist a half-connected secret: no instance/user means no password kept.
  if (!out.instance || !out.user) out.pass = "";
  writeStore(out);
  return { ...out };
}

export function clearSnowConnection(): void {
  writeStore({ ...EMPTY });
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

export function hasSnowCredentials(c = readStore()): boolean {
  return c.instance !== "" && c.user !== "" && c.pass !== "";
}
