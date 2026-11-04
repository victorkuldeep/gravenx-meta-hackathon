"use client";

import { useState } from "react";
import Button from "../ui/Button";
import { isValidCredName, normalizeCredName, type CredVault } from "@/lib/system-design/credentials";

/**
 * Session credential vault (env-var style): one-time KEY = secret setup,
 * retained for the browser tab only. Never saved to projects, exports,
 * history or disk beyond the tab session. Reference as $env.NAME.
 */
export function CredentialsModal({
  open,
  onClose,
  vault,
  onSet,
  onRemove,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  vault: CredVault;
  onSet: (name: string, value: string) => void;
  onRemove: (name: string) => void;
  onClear: () => void;
}) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;
  const names = Object.keys(vault).sort();

  const add = () => {
    const clean = normalizeCredName(name);
    if (!isValidCredName(clean)) {
      setError("Names use A-Z, 0-9 and underscore only (max 64).");
      return;
    }
    if (!value) {
      setError("Value is empty - nothing to store.");
      return;
    }
    setError(null);
    onSet(clean, value.trim());
    setName("");
    setValue("");
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="cred-title" onClick={onClose}>
      <div
        className="modal-card max-w-md flex flex-col"
        style={{ maxHeight: "88vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)] shrink-0">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
              Session only · {names.length} stored · never saved or exported
            </p>
            <h2 id="cred-title" className="mt-1 text-lg font-bold text-ivory-950">
              Credentials
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ivory-600">
              One-time setup - reference as <span className="font-mono font-semibold">$env.NAME</span> in
              bodies, headers and tokens. Kept for this browser tab only.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close credentials"
            className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {names.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[var(--color-line)] px-3 py-3 text-[11px] text-ivory-500">
              Vault is empty. Add tokens and keys once - every runner resolves them at send time.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {names.map((n) => (
                <li key={n} className="flex items-center gap-1.5 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-bold text-ivory-950">
                    $env.{n}
                  </span>
                  <span className="font-mono text-[10px] text-ivory-500" title="Value never displayed in full">
                    ••••••
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemove(n)}
                    aria-label={`Delete ${n}`}
                    title={`Delete ${n}`}
                    className="rounded p-1 text-ivory-400 hover:text-red-700 hover:bg-red-500/10 transition-colors cursor-pointer"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-1.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
              placeholder="NAME"
              spellCheck={false}
              aria-label="Credential name"
              className="w-32 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 font-mono text-[11px] font-bold text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
            />
            <div className="relative min-w-0 flex-1">
              <input
                type={reveal ? "text" : "password"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") add();
                }}
                placeholder="secret value"
                autoComplete="off"
                spellCheck={false}
                aria-label="Credential value"
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 pr-8 font-mono text-[11px] text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? "Hide value" : "Show value"}
                title={reveal ? "Hide value" : "Show value"}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-ivory-500 hover:text-ivory-950 cursor-pointer"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
            <Button size="sm" onClick={add}>
              Add
            </Button>
          </div>
          {error && (
            <p className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-2 text-xs text-red-700" role="alert">
              {error}
            </p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-[var(--color-line-soft)] shrink-0 flex items-center justify-between">
          <button
            type="button"
            onClick={onClear}
            disabled={names.length === 0}
            className="text-[11px] text-ivory-500 hover:text-red-700 underline cursor-pointer disabled:opacity-40"
          >
            Clear vault
          </button>
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
