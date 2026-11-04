"use client";

import { useEffect, useState } from "react";
import Button from "./ui/Button";

interface WelcomeModalProps {
  open: boolean;
  onConnect: () => void;
  onExplore: () => void;
}

const CHIPS = ["REST payloads", "ERD + Graph", "Composite batches", "OpenAPI validate"];

/** Rotating hero lines: black lead, burgundy accent. One studio, five promises. */
const TAGLINES: { lead: string; accent: string }[] = [
  { lead: "Payloads", accent: "without the grunt work." },
  { lead: "ERDs drawn", accent: "from live metadata." },
  { lead: "Simulate integrations", accent: "before they're built." },
  { lead: "Decisions with", accent: "a paper trail." },
  { lead: "Wireframes bound", accent: "to real Salesforce schema." },
];

export function WelcomeModal({ open, onConnect, onExplore }: WelcomeModalProps) {
  const [accepted, setAccepted] = useState(false);
  const [tagline, setTagline] = useState(0);

  // Rotate the hero line every 10s while the modal is up. Reduced-motion
  // users (and SSR) stay on the first line.
  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setTagline((i) => (i + 1) % TAGLINES.length), 10000);
    return () => window.clearInterval(t);
  }, [open ]);
  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="modal-card max-w-xl">
        <div className="px-6 sm:px-8 pt-7 pb-6 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
            Salesforce Engineering Studio
          </p>
          <h2
            key={tagline}
            id="welcome-title"
            className="hero-title hero-title--red tagline-rotate mt-2 min-h-[132px] text-4xl sm:min-h-[156px] sm:text-5xl"
          >
            {TAGLINES[tagline].lead} <em>{TAGLINES[tagline].accent}</em>
          </h2>
          <div className="mt-1 flex items-center justify-center gap-1.5" aria-hidden="true">
            {TAGLINES.map((_, i) => (
              <span
                key={i}
                className={`h-1 w-1 rounded-full transition-colors ${i === tagline ? "bg-[#722F37]" : "bg-[#D8D0C0]"}`}
              />
            ))}
          </div>
          <p className="mx-auto mt-3 text-sm leading-relaxed text-ivory-700 max-w-md">
            Welcome to{" "}
            <strong className="font-bold tracking-tight">
              <span className="gravenx-brand__lead">GRAVEN</span>
              <span className="gravenx-brand__rest">X</span>
            </strong>{" "}
            - connect to any org and build accurate payloads from live metadata. No manual
            field copy-paste.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
            {CHIPS.map((c) => (
              <span
                key={c}
                className="rounded-full border border-[var(--color-line)] bg-[var(--color-canvas)] px-2.5 py-1 text-[11px] font-medium text-ivory-700"
              >
                {c}
              </span>
            ))}
          </div>
        </div>

        <div className="px-6 sm:px-8 pb-3">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-4 py-3 text-left">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              aria-label="Accept the Terms and Conditions and Privacy Policy"
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#A98450]"
            />
            <span className="text-xs leading-relaxed text-ivory-700">
              I accept the{" "}
              <a
                href="/terms"
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-medium underline hover:text-ivory-950"
              >
                Terms &amp; Conditions
              </a>{" "}
              and{" "}
              <a
                href="/privacy"
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="font-medium underline hover:text-ivory-950"
              >
                Privacy Policy
              </a>
              , and I have authority to connect this org.
            </span>
          </label>
        </div>

        <div className="px-6 sm:px-8 pb-3 flex flex-col sm:flex-row sm:items-center gap-3">
          <Button
            size="lg"
            onClick={onConnect}
            disabled={!accepted}
            title={accepted ? "Open the connection dialog" : "Accept the Terms & Privacy Policy first"}
            className="sm:flex-1"
          >
            Connect to Salesforce
          </Button>
          <Button size="lg" variant="secondary" onClick={onExplore} className="sm:flex-1">
            Explore the studio first
          </Button>
        </div>

        <p className="px-6 sm:px-8 pb-5 text-center text-[11px] leading-relaxed text-ivory-600">
          Your access token is never written to disk - session memory only. Independent project.
        </p>
      </div>
    </div>
  );
}
