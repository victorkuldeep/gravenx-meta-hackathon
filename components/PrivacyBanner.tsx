"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const KEY = "sf-privacy-ack";

/**
 * Privacy banner: full-width, clearly visible on home (both before and after
 * connecting). Strictly-essential storage only — session in sessionStorage,
 * designs in IndexedDB, banner flag in localStorage. No tracking, no ad
 * cookies. Links to the GDPR-ready Privacy Policy, Terms, and Security pages.
 */
export function PrivacyBanner() {
  // Start acked so server prerender and first paint agree; the effect
  // reveals the banner only for visitors who never dismissed it.
  const [acked, setAcked] = useState(true);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(KEY) !== "1") setAcked(false);
    } catch {
      /* storage unavailable - stay dismissed */
    }
  }, []);

  if (acked) return null;

  const ack = () => {
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* storage unavailable */
    }
    setAcked(true);
  };

  return (
    <div
      role="region"
      aria-label="Privacy notice"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_-12px_40px_-16px_rgba(24,20,12,0.35)]"
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
        <span
          className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] text-[var(--color-accent-dark)] sm:flex"
          aria-hidden="true"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M12 3 5 5.8v5.4c0 4.4 2.9 7.6 7 9.3 4.1-1.7 7-4.9 7-9.3V5.8L12 3Z" />
            <path d="m9.2 11.8 2 2 3.6-4" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-[var(--color-ink)]">
            Your privacy, by design — GDPR-ready, essential storage only
          </p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--color-ink-soft)]">
            Your Salesforce session stays in this browser tab and your designs stay in this browser. No
            tracking, no ad cookies — see the{" "}
            <Link href="/privacy" className="font-medium underline hover:text-[var(--color-ink)]">
              Privacy Policy
            </Link>
            {", "}
            <Link href="/terms" className="font-medium underline hover:text-[var(--color-ink)]">
              Terms
            </Link>
            {" and "}
            <Link href="/security" className="font-medium underline hover:text-[var(--color-ink)]">
              Security
            </Link>
            .
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/privacy"
            className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-xs font-semibold text-[var(--color-ink)] hover:border-[var(--color-accent)] transition-colors"
          >
            Learn more
          </Link>
          <button
            type="button"
            onClick={ack}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--color-accent-dark)] transition-colors cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
