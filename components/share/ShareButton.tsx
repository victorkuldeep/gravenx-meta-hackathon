"use client";

import { useState } from "react";
import Button from "../ui/Button";
import { apiFetch } from "@/lib/api";
import { buildShareEnvelope, type ShareEnvelopeKind } from "@/lib/share/envelope";

/**
 * Generic ephemeral share button: POSTs an org-independent model package
 * (sequence / experience / system project) to /api/share and hands back a
 * 30-minute link. The receiver's route consumes ?share=<id> and imports a
 * local copy - nothing executes, no tokens travel.
 */
export function ShareButton({
  kind,
  name,
  getPayload,
}: {
  kind: ShareEnvelopeKind;
  name: string;
  getPayload: () => unknown;
}) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const envelope = buildShareEnvelope(kind, name, getPayload());
      const response = await apiFetch("/api/share", envelope, 30000);
      const text = await response.text();
      let data: { id?: string; error?: string };
      try {
        data = JSON.parse(text) as { id?: string; error?: string };
      } catch {
        throw new Error(
          response.ok
            ? "Share backend returned an unreadable response."
            : `Share backend failed (HTTP ${response.status}).`,
        );
      }
      if (!response.ok || !data.id) {
        throw new Error(typeof data.error === "string" ? data.error : "Could not create share link.");
      }
      const path = kind === "sequence" ? "/sequence" : kind === "experience" ? "/wireframe" : "/system";
      setLink(`${window.location.origin}${path}?share=${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create share link.");
    } finally {
      setCreating(false);
    }
  };

  const close = () => {
    setOpen(false);
    setLink(null);
    setError(null);
    setCopied(false);
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} title="Share a 30-minute link to this as a portable copy">
        Share
      </Button>
      {open && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={close}>
          <div className="modal-card max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-[var(--color-line-soft)] px-6 pt-5 pb-4">
              <p className="text-[10px] font-semibold tracking-[2px] text-[var(--color-accent-dark)] uppercase">
                Collaborate · expires in 30 min
              </p>
              <h2 id="share-title" className="mt-1 text-lg font-bold text-ivory-950">
                Share &ldquo;{name}&rdquo;
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-ivory-600">
                Teammates open the link and get a local copy in their library. Model only - no tokens, no live data.
              </p>
            </div>
            <div className="px-6 py-4">
              {!link ? (
                <>
                  {error && (
                    <p className="mt-0 mb-2.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-2 text-xs text-red-700" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void create()} loading={creating} className="flex-1">
                      Create link
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
      )}
    </>
  );
}
