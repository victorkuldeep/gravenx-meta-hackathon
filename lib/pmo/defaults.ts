"use client";

import { aiHistoryKey } from "@/lib/ai/gate";

/**
 * Sticky per-org PMO defaults - the NON-SECRET half of the Deliver panels.
 * Project keys, issue types, instances (hostnames, never credentials) and
 * tables persist per org in localStorage so the next tab starts where the
 * architect left off. Secrets never land here: tokens/passwords stay in the
 * session-only vaults and are always re-entered per tab.
 *
 * Org scope reuses the AI history key (org id → host → "local"), so PMO
 * defaults follow the same org the architect is connected to.
 */

const STORE_KEY = "gravenx_pmo_defaults_v1";

export interface PmoOrgDefaults {
  provider?: "jira" | "snow";
  projectKey?: string;
  issueTypeId?: string;
  snowInstance?: string;
  snowTable?: string;
}

type DefaultsMap = Record<string, PmoOrgDefaults>;

function readAll(): DefaultsMap {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: DefaultsMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const d = v as Record<string, unknown>;
      const clean: PmoOrgDefaults = {};
      if (d.provider === "jira" || d.provider === "snow") clean.provider = d.provider;
      for (const f of ["projectKey", "issueTypeId", "snowInstance", "snowTable"] as const) {
        if (typeof d[f] === "string" && (d[f] as string).trim()) clean[f] = (d[f] as string).trim().slice(0, 200);
      }
      out[k.slice(0, 200)] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** Org scope for PMO defaults - same key as the per-org AI history. */
export function pmoOrgKey(): string {
  try {
    return aiHistoryKey();
  } catch {
    return "local";
  }
}

export function getPmoDefaults(org = pmoOrgKey()): PmoOrgDefaults {
  return readAll()[org] ?? {};
}

export function setPmoDefaults(patch: PmoOrgDefaults, org = pmoOrgKey()): PmoOrgDefaults {
  const all = readAll();
  const next = { ...(all[org] ?? {}), ...patch };
  for (const k of Object.keys(next) as (keyof PmoOrgDefaults)[]) {
    if (next[k] === undefined || next[k] === "") delete next[k];
  }
  all[org] = next;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* private mode - session vaults still carry this tab */
  }
  return { ...next };
}
