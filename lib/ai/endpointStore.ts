"use client";

/**
 * Session-only store for editable provider endpoints (today: the "Custom
 * endpoint" preset). Mirrors the keyVault posture:
 *
 * - endpoint lives in tab memory + a sessionStorage mirror (survives in-app
 *   navigation, dies with the tab);
 * - NEVER written to IDB, projects, exports, history or logs;
 * - cleared on demand (disconnect / explicit clear).
 *
 * This exists because a custom baseURL used to live only in Model Studio's
 * modal-local state: activating "custom" wrote the key to the vault but the
 * endpoint evaporated on modal close, so chat posted to "" and failed.
 * Both Model Studio and Arena quick-connect read/write through here, and
 * AiDock resolves the chat baseURL through it - one source of truth.
 */

const STORE_KEY = "gravenx_ai_endpoints_v1";

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
    /* quota/private mode - memory still holds the endpoint for this view */
  }
}

export function getProviderEndpoint(providerId: string): string {
  return readStore()[providerId] ?? "";
}

export function setProviderEndpoint(providerId: string, endpoint: string): void {
  const next = readStore();
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (trimmed === "") delete next[providerId];
  else next[providerId] = trimmed;
  writeStore(next);
}

export function hasProviderEndpoint(providerId: string): boolean {
  return getProviderEndpoint(providerId) !== "";
}

export function clearProviderEndpoints(): void {
  writeStore({});
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}
