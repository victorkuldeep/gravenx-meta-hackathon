"use client";

import { normalizeJiraSite } from "./jira";

/**
 * Session-only vault for PMO connections (JIRA first, ServiceNow later).
 * Same posture as the AI key vault (lib/ai/keyVault.ts) and the Salesforce
 * session token:
 *
 * - connection secrets live in tab memory + a sessionStorage mirror (die
 *   with the tab);
 * - NEVER written to IDB, tasks, exports or logs - the only exception is the
 *   explicit opt-in encrypted row in lib/pmo/secureStore.ts (AES-GCM,
 *   passphrase-derived key, Setup → Delivery);
 * - last-used project/issue-type are convenience defaults, also session-only
 *   (per-org PMO defaults are a follow-up, not V1).
 *
 * Pushes ride the same-origin proxy (/api/pmo/jira), which forwards the
 * credentials per request - the worker never stores them.
 */

const STORE_KEY = "gravenx_pmo_v1";

export interface PmoConnection {
  site: string;
  email: string;
  token: string;
  projectKey: string;
  issueTypeId: string;
}

const EMPTY: PmoConnection = { site: "", email: "", token: "", projectKey: "", issueTypeId: "" };

let mem: PmoConnection | null = null;

function readStore(): PmoConnection {
  if (mem) return { ...mem };
  mem = { ...EMPTY };
  try {
    if (typeof sessionStorage !== "undefined") {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const p = parsed as Record<string, unknown>;
          for (const k of ["site", "email", "token", "projectKey", "issueTypeId"] as const) {
            if (typeof p[k] === "string") mem[k] = p[k] as string;
          }
        }
      }
    }
  } catch {
    mem = { ...EMPTY };
  }
  return { ...mem };
}

function writeStore(next: PmoConnection): void {
  mem = { ...next };
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem(STORE_KEY, JSON.stringify(mem));
  } catch {
    /* quota/private mode - memory still holds the connection for this view */
  }
}

export function getPmoConnection(): PmoConnection {
  return readStore();
}

export function setPmoConnection(next: Partial<PmoConnection>): PmoConnection {
  const rawSite = (next.site ?? mem?.site ?? "").trim();
  const norm = normalizeJiraSite(rawSite);
  const merged: PmoConnection = {
    // Canonical origin when it parses - every reader gets the same site.
    site: norm.ok ? norm.site : rawSite,
    email: (next.email ?? mem?.email ?? "").trim(),
    token: (next.token ?? mem?.token ?? "").trim(),
    projectKey: next.projectKey ?? mem?.projectKey ?? "",
    issueTypeId: next.issueTypeId ?? mem?.issueTypeId ?? "",
  };
  // Never persist a half-connected secret: no site/email means no token kept.
  if (!merged.site || !merged.email) merged.token = "";
  writeStore(merged);
  return { ...merged };
}

export function clearPmoConnection(): void {
  writeStore({ ...EMPTY });
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

export function hasPmoCredentials(c = readStore()): boolean {
  return c.site !== "" && c.email !== "" && c.token !== "";
}
