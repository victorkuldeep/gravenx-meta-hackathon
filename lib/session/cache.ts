"use client";

import type { SalesforceObject } from "@/lib/salesforce/types";

/**
 * Module-level connection cache. ES modules persist across client-side route
 * transitions (JSON / Contracts / Architect are separate routes that unmount
 * the `/` page tree), so a live connection + object list survives a round
 * trip with zero refetch and zero boot modal. A full browser reload clears
 * this (fresh module graph) and falls back to the sessionStorage restore flow.
 */
export interface CachedConnection {
  instanceUrl: string;
  token: string;
  apiVersion: string;
  objects: SalesforceObject[];
  objectCount: number;
  /** Resolved org key for workspace autosave (org id w/ host fallback). */
  orgKey: string;
}

let cached: CachedConnection | null = null;

export function getCachedConnection(): CachedConnection | null {
  return cached;
}

export function setCachedConnection(c: CachedConnection): void {
  cached = c;
}

export function clearCachedConnection(): void {
  cached = null;
}
