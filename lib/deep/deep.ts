"use client";

import { useEffect, useState } from "react";

/**
 * Deep links (record-level navigation). Every entry point reads its query
 * param on mount and selects the matching record; unknown or absent values
 * never break the page - the tab opens exactly as before. Links address
 * records by id, with human numbers (ADR-001, REQ-102) accepted anywhere
 * an id works, matched case-insensitively.
 */

/** Read one query param client-side. SSR-safe: null until mounted. */
export function useDeepParam(key: string): string | null {
  const [value, setValue] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get(key)?.trim();
      setValue(raw ? raw : null);
    } catch {
      setValue(null);
    }
  }, [key]);
  return value;
}

/**
 * Mirror the open record into the URL (?key=value) with replaceState - no
 * reload, no history spam. Back/forward still work because the entry stays
 * readable on mount; passing null removes the key.
 */
export function syncDeepParam(key: string, value: string | null): void {
  try {
    const url = new URL(window.location.href);
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  } catch {
    /* non-browser or locked history - links still work when copied */
  }
}

/** Absolute deep link for the current origin: path + ?key=value. */
export function deepLinkFor(path: string, key: string, value: string): string {
  try {
    const url = new URL(path, window.location.origin);
    url.searchParams.set(key, value);
    return url.toString();
  } catch {
    return `${path}?${key}=${encodeURIComponent(value)}`;
  }
}

/** Clipboard copy with a textarea fallback for non-secure contexts. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Match a deep value against records by id, or by human number when present. */
export function findDeepRecord<T extends { id: string; number?: string }>(
  items: T[],
  raw: string | null,
): T | null {
  if (!raw) return null;
  const q = raw.trim();
  if (!q) return null;
  const lower = q.toLowerCase();
  return (
    items.find((i) => i.id === q || (typeof i.number === "string" && i.number.toLowerCase() === lower)) ?? null
  );
}
