"use client";

import { findMissingVars, resolveEnvVars, type CredVault } from "./credentials";
import type { OperationHeader } from "./model";

export interface HeaderRow {
  key: string;
  value: string;
}

/** Prefill for run-dialog token fields: the stored Authorization header is
 * declarative intent (Postman habit) but the backend only forwards auth from
 * the per-run token - so the dialog opens carrying the stored value and the
 * wire stays memory-only. Returns "" when no stored auth exists. Refs stay
 * refs ($env resolves at send, tracking vault edits). */
export function authTokenPrefill(stored: OperationHeader[] | undefined): string {
  const found = (stored ?? []).find((h) => h.key.trim().toLowerCase() === "authorization");
  if (!found) return "";
  const m = found.value.match(/^\s*Bearer\s+(.+?)\s*$/i);
  return (m ? m[1] : found.value).trim();
}

/** Stored op headers + ad-hoc dialog rows, resolved against the vault.
 * Ad-hoc rows win on name conflict (case-insensitive). Empty names drop.
 * Returns rows ready to send plus any missing $env names (senders block). */
export function buildSendHeaders(
  stored: OperationHeader[] | undefined,
  adhoc: HeaderRow[],
  vault: CredVault
): { headers: HeaderRow[]; missing: string[] } {
  const seen = new Set<string>();
  const merged: HeaderRow[] = [];
  const push = (key: string, value: string) => {
    const name = key.trim();
    if (!name) return;
    const lower = name.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    merged.push({ key: name, value });
  };
  // Ad-hoc first so dialog edits override stored config.
  for (const h of adhoc) push(h.key, h.value);
  for (const h of stored ?? []) push(h.key, h.value);
  // Default JSON content type unless the caller configured one.
  if (!seen.has("content-type")) {
    merged.unshift({ key: "Content-Type", value: "application/json" });
  }
  const missing = findMissingVars(
    merged.map((h) => h.value),
    vault
  );
  const headers = merged.map((h) => ({ key: h.key, value: resolveEnvVars(h.value, vault).text }));
  return { headers, missing };
}
