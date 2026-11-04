"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { SalesforceDescribeResult, SalesforceObject } from "@/lib/salesforce/types";

interface Session {
  instanceUrl: string;
  token: string;
  apiVersion: string;
}

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem("gravenx_session");
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return s.token && s.instanceUrl ? s : null;
  } catch {
    return null;
  }
}

/**
 * Salesforce metadata for Mapping Studio. Reuses the established
 * session + /api/salesforce/objects + /describe flow - no second auth.
 */
export function useMappingMetadata() {
  const [session, setSession] = useState<Session | null>(null);
  const [objects, setObjects] = useState<SalesforceObject[]>([]);
  const [describes, setDescribes] = useState<Map<string, SalesforceDescribeResult>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSession(readSession());
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void apiFetch("/api/salesforce/objects", session)
      .then(async (r) => {
        const data = (await r.json()) as { objects?: SalesforceObject[]; error?: string };
        if (cancelled) return;
        if (r.ok && Array.isArray(data.objects)) setObjects(data.objects);
        else setError(typeof data.error === "string" ? data.error : "Failed to load objects.");
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load objects.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const loadDescribe = useCallback(
    async (objectName: string): Promise<SalesforceDescribeResult | null> => {
      if (!session) return null;
      const cached = describes.get(objectName);
      if (cached) return cached;
      try {
        const response = await apiFetch("/api/salesforce/describe", { ...session, objectName });
        const data = (await response.json()) as SalesforceDescribeResult & { error?: string };
        if (!response.ok || !data.name) {
          setError(typeof data.error === "string" ? data.error : `Describe failed for ${objectName}.`);
          return null;
        }
        setDescribes((prev) => new Map(prev).set(objectName, data));
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : `Describe failed for ${objectName}.`);
        return null;
      }
    },
    [session, describes]
  );

  return { connected: !!session, session, objects, describes, loading, error, loadDescribe };
}
