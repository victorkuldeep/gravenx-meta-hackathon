"use client";

import { getCachedConnection } from "@/lib/session/cache";

/**
 * V1 access gate for the AI module: a live Salesforce connection acts as
 * login. Sources, in order: the module connection cache (survives
 * client-side route trips) and the `gravenx_session` restore record
 * (survives reloads until the tab dies). Pure read - no side effects.
 */

const SESSION_KEY = "gravenx_session";

/**
 * Expired-token latch. Presence checks cannot detect a dead token (the
 * session record survives expiry), so the app sets this when Salesforce
 * reports 401/invalid-session and clears it on reconnect. While set, the
 * gate stays closed even with a session record on disk.
 */
let sessionDead = false;

export const SESSION_EXPIRED_EVENT = "gravenx:session-expired";

export function markSessionExpired(): void {
  sessionDead = true;
  try {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  } catch {
    /* non-browser module graph - flag alone still closes the gate */
  }
}

export function clearSessionExpired(): void {
  sessionDead = false;
}

/**
 * Org key scoping AI memory. Prefers the live connection's resolved org
 * key, falls back to the session record's hostname, then "local".
 */
export function aiHistoryKey(): string {
  try {
    const cached = getCachedConnection();
    if (cached?.orgKey) return cached.orgKey;
  } catch {
    /* ignore */
  }
  try {
    if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { instanceUrl?: unknown };
        if (s && typeof s.instanceUrl === "string" && s.instanceUrl) {
          try {
            const host = new URL(s.instanceUrl).hostname;
            if (host) return host;
          } catch {
            return s.instanceUrl;
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return "local";
}

export interface LiveSession {
  instanceUrl: string;
  token: string;
  apiVersion: string;
  orgKey?: string;
  objectCount?: number;
}

/**
 * Full live session, same two sources as the gate: module cache first
 * (fast path after connect / client-side trips), then the tab's restore
 * record (survives reloads). Panels and agent tools share this - never
 * read only one source or a reloaded tab looks disconnected.
 */
export function readLiveSession(): LiveSession | null {
  try {
    const c = getCachedConnection();
    if (c && typeof c.token === "string" && c.token && typeof c.instanceUrl === "string" && c.instanceUrl) {
      return {
        instanceUrl: c.instanceUrl,
        token: c.token,
        apiVersion: c.apiVersion || "v60.0",
        orgKey: c.orgKey,
        objectCount: c.objectCount,
      };
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof sessionStorage === "undefined") return null;
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { instanceUrl?: unknown; token?: unknown; apiVersion?: unknown };
    if (s && typeof s.instanceUrl === "string" && s.instanceUrl && typeof s.token === "string" && s.token) {
      return {
        instanceUrl: s.instanceUrl,
        token: s.token,
        apiVersion: typeof s.apiVersion === "string" && s.apiVersion ? s.apiVersion : "v60.0",
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function isSalesforceConnected(): boolean {
  if (sessionDead) return false;
  try {
    if (getCachedConnection()) return true;
  } catch {
    /* non-browser module graph - fall through */
  }
  try {
    if (typeof sessionStorage === "undefined") return false;
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return false;
    const s = parsed as { instanceUrl?: unknown; token?: unknown };
    return typeof s.instanceUrl === "string" && s.instanceUrl !== "" && typeof s.token === "string" && s.token !== "";
  } catch {
    return false;
  }
}
