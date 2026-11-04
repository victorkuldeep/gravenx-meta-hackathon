"use client";

import { useEffect, useRef } from "react";

interface SupportDialogProps {
  open: boolean;
  onClose: () => void;
}

const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/victorkuldeep";

export function SupportDialog({ open, onClose }: SupportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div
        className="relative w-full max-w-sm rounded-2xl bg-[var(--color-surface)] border border-[var(--color-line)] shadow-2xl p-6 text-center space-y-4"
        role="dialog"
        aria-labelledby="support-dialog-title"
      >
        <button
          type="button"
          className="absolute top-4 right-4 p-1 rounded-md text-[var(--color-muted)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-strong)] transition-colors cursor-pointer"
          onClick={onClose}
          aria-label="Close support dialog"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="h-4 w-4">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="w-10 h-10 rounded-full bg-[var(--color-canvas)] border border-[var(--color-line)] flex items-center justify-center mx-auto text-[var(--color-accent)]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="h-5 w-5">
            <path d="M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8Z" />
            <path d="M16 9h2a2 2 0 0 1 0 4h-2M7 4c0 1-1 1.5-1 2.5M11 4c0 1-1 1.5-1 2.5" />
          </svg>
        </div>

        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-accent)] mb-1">
            Support the workbench
          </p>
          <h2 id="support-dialog-title" className="text-lg font-serif text-[var(--color-ink)] font-normal">
            Buy me a coffee
          </h2>
          <p className="text-xs text-[var(--color-muted)] mt-1.5 leading-relaxed">
            If this workbench helped your work, scan the QR code or visit my Buy Me a Coffee profile.
          </p>
        </div>

        <a
          className="block p-3 rounded-xl bg-white border border-[var(--color-line)] max-w-[200px] mx-auto hover:shadow-md transition-shadow"
          href={BUY_ME_A_COFFEE_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Open Kuldeep Singh's Buy Me a Coffee profile"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/bmc-qr.png" alt="Buy Me a Coffee QR code for Kuldeep Singh" className="w-full h-auto" />
        </a>

        <p className="text-[11px] text-[var(--color-muted)]">Scan or visit Buy Me a Coffee</p>

        <a
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-accent)] hover:underline font-medium"
          href={BUY_ME_A_COFFEE_URL}
          target="_blank"
          rel="noreferrer"
        >
          Open Buy Me a Coffee profile
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="h-3 w-3">
            <path d="M7 17 17 7M7 7h10v10" />
          </svg>
        </a>

        <div className="pt-2">
          <button
            type="button"
            className="w-full py-2 rounded-lg bg-ivory-950 text-xs font-semibold text-ivory-100 hover:bg-bronze-600 transition-colors cursor-pointer"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
