"use client";

/**
 * Session-only vault for BYOK provider keys. Mirrors the Salesforce /
 * System-Design secret posture (lib/system-design/credentials.ts):
 *
 * - keys live in tab memory + a sessionStorage mirror (survives in-app
 *   navigation, dies with the tab);
 * - NEVER written to IDB, projects, exports, history or logs;
 * - cleared on demand (disconnect / explicit clear).
 *
 * The agent reaches providers through our same-origin proxy routes,
 * which forward the session key per request - keys are never stored
 * server-side and never logged.
 */

const STORE_KEY = "gravenx_ai_keys_v1";

let mem: Record<string, string> | null = null;

function readStore(): Record<string, string> {
  if (mem) return { ...mem };
  mem = {};
  try {
    if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === "string" && v) mem[k] = v;
          }
        }
      }
    }
  } catch {
    mem = {};
  }
  return { ...mem };
}

function writeStore(next: Record<string, string>): void {
  mem = { ...next };
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(mem));
    }
  } catch {
    /* quota/private mode - memory still holds the keys for this view */
  }
}

export function getProviderKey(providerId: string): string {
  return readStore()[providerId] ?? "";
}

export function setProviderKey(providerId: string, key: string): void {
  const next = readStore();
  const trimmed = key.trim();
  if (trimmed === "") delete next[providerId];
  else next[providerId] = trimmed;
  writeStore(next);
}

export function hasProviderKey(providerId: string): boolean {
  return getProviderKey(providerId) !== "";
}

export function clearProviderKeys(): void {
  writeStore({});
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

/** Provider ids that currently hold a key (for the settings summary). */
export function keyedProviders(): string[] {
  return Object.keys(readStore());
}
