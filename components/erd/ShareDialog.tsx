"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "../ui/Button";
import { apiFetch } from "@/lib/api";
import { shareStructureBytes, type ShareStructure } from "@/lib/erd/shareLink";

/**
 * Share dialog: publishes the live canvas as an ephemeral KV-backed link.
 * Structure only (api names, positions, view) plus opt-in notes. Field
 * metadata never leaves the browser; the link self-destructs in 30 minutes.
 */
export function ShareDialog({
  open,
  onClose,
  objectCount,
  getStructure,
}: {
  open: boolean;
  onClose: () => void;
  objectCount: number;
  getStructure: (includeNotes: boolean) => ShareStructure;
}) {
  const [includeNotes, setIncludeNotes] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [backendDown, setBackendDown] = useState<boolean | null>(null);

  // Probe backend status on open: a missing KV binding (added in dashboard
  // but not yet deployed) must read as guidance, not a failed attempt.
  useEffect(() => {
    if (!open) return;
    setBackendDown(null);
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/share/health");
        const text = await r.text();
        const data = JSON.parse(text) as { kv?: boolean };
        if (!cancelled) setBackendDown(data.kv !== true);
      } catch {
        if (!cancelled) setBackendDown(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open ]);

  const bytes = useMemo(
    () => (open ? shareStructureBytes(getStructure(includeNotes)) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, includeNotes]
  );

  if (!open) return null;

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const response = await apiFetch("/api/share", getStructure(includeNotes), 30000);
      // Read text first: a crashed worker returns an empty body, and
      // response.json() on it throws a useless parse error. Surface status.
      const text = await response.text();
      let data: { id?: string; error?: string };
      try {
        data = JSON.parse(text) as { id?: string; error?: string };
      } catch {
        throw new Error(
          response.ok
            ? "Share backend returned an unreadable response - check Observability logs."
            : `Share backend failed (HTTP ${response.status}) - check Observability logs.`
        );
      }
      if (!response.ok || !data.id) {
        throw new Error(typeof data.error === "string" ? data.error : "Could not create share link.");
      }
      setLink(`${window.location.origin}/?share=${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create share link.");
    } finally {
      setCreating(false);
    }
  };

  const close = () => {
    setLink(null);
    setError(null);
    setCopied(false);
    onClose();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={close}>
      <div className="modal-card max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)]">
          <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
            Collaborate · {objectCount} object{objectCount === 1 ? "" : "s"} · ≈{(bytes / 1024).toFixed(1)} KB
          </p>
          <h2 id="share-title" className="mt-1 text-lg font-bold text-ivory-950">
            Share this canvas
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-ivory-600">
            Teammates open the link, connect their own org, and your diagram rebuilds
            with their metadata. Structure only - no field data, no tokens.
          </p>
        </div>
        <div className="px-6 py-4">
          {!link ? (
            <>
              <label className="flex cursor-pointer items-start gap-2 text-xs text-ivory-900">
                <input
                  type="checkbox"
                  checked={includeNotes}
                  onChange={(e) => setIncludeNotes(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-bronze-600"
                />
                <span>
                  <strong>Include design notes + TODOs</strong>
                  <span className="block text-[11px] text-ivory-600">Off by default - meeting notes can hold anything.</span>
                </span>
              </label>
              {backendDown === true && (
                <p className="mt-2.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800" role="status">
                  Share backend not connected on this deployment - add the SHARE_KV binding in
                  Cloudflare Settings → Bindings, then redeploy.
                </p>
              )}
              {error && (
                <p className="mt-2.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-2 text-xs text-red-700" role="alert">
                  {error}
                </p>
              )}
              <div className="mt-3.5 flex gap-2">
                <Button size="sm" onClick={() => void create()} loading={creating} className="flex-1" disabled={objectCount === 0}>
                  Create link · self-destructs in 30 min
                </Button>
                <Button size="sm" variant="ghost" onClick={close}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-ivory-950">Link ready - expires in 30 minutes</p>
              <div className="mt-2 flex gap-1.5">
                <input
                  readOnly
                  value={link}
                  onFocus={(e) => e.target.select()}
                  aria-label="Share link"
                  className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-1.5 font-mono text-[11px] text-ivory-900 focus:border-bronze-500 focus:outline-none"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void (async () => {
                      try {
                        await navigator.clipboard.writeText(link);
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 1600);
                      } catch {
                        /* clipboard unavailable - link is selectable above */
                      }
                    })();
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <div className="mt-3 flex justify-end">
                <Button size="sm" variant="ghost" onClick={close}>
                  Done
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
