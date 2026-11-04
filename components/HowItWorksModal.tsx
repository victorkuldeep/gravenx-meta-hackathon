"use client";

import { useEffect } from "react";
import Button from "./ui/Button";

interface HowItWorksModalProps {
  open: boolean;
  onClose: () => void;
  onConnect: () => void;
}

const STEPS = [
  {
    n: "01",
    title: "Connect securely",
    points: [
      "Three ways in: Credentials, Session ID (frontdoor-link 1-click), or token help.",
      "Token stays in session memory only; every call is proxied server-side.",
      "Dead sessions reopen the login by themselves - expired tokens get a reconnect dialog, never a dead screen.",
    ],
  },
  {
    n: "02",
    title: "Find anything fast",
    points: [
      "Relevance-ranked search everywhere: exact matches first, ⌘K quick-find across 2,700+ objects.",
      "Live field metadata: types, picklists, references, required flags, writability split for POST vs PATCH.",
      "Picklist inspector: value counts open floating panels with defaults and inactive flags.",
    ],
  },
  {
    n: "03",
    title: "Build in five modes",
    points: [
      "Single payloads with type-aware editors, Composite batches, SOQL with query plans.",
      "Multi-object GraphQL graphs and an ERD Schema Map with discovery and laser walkthroughs.",
      "Timeouts on every call (30s browser, 25s proxy) - nothing ever hangs silently.",
    ],
  },
  {
    n: "04",
    title: "Export, test, collect",
    points: [
      "JSON, cURL, JS fetch, Apex, CSV/Excel, hi-res PNG, and Postman v2.1 collections.",
      "Live test runs with confirmation, full response viewer, and SOQL stop support.",
      "Stage requests across builders into named collections - IndexedDB-backed, export once.",
    ],
  },
];

const MODES = [
  { name: "Single Object", desc: "POST or PATCH one record with live field metadata." },
  { name: "Composite API", desc: "Multi-sObject graphs with reference IDs in a single call." },
  { name: "SOQL", desc: "Inspector-style queries with plans, history, saved queries and exports." },
  { name: "GraphQL", desc: "Multi-object graphs plus nested traversal - read-only, one round trip." },
  { name: "Schema Map", desc: "ERD canvas - discover the model, spotlight parents, export PNG." },
  { name: "Collections", desc: "Stage requests from any builder, export a Postman collection at once." },
];

export function HowItWorksModal({ open, onClose, onConnect }: HowItWorksModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="how-title"
      onClick={onClose}
    >
      <div
        className="modal-card max-w-4xl flex flex-col"
        style={{ maxHeight: "88vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 sm:px-8 pt-6 pb-4 border-b border-[var(--color-line-soft)] shrink-0">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
              How it works
            </p>
            <h2 id="how-title" className="hero-title mt-1 text-2xl sm:text-3xl">
              Five builders, <em>one connection.</em>
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close how it works dialog"
            className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-6 sm:px-8 py-5 space-y-5">
          <ol className="grid sm:grid-cols-2 gap-3">
            {STEPS.map((s, i) => (
              <li key={s.n} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] p-4">
                <div className="flex items-baseline gap-2">
                  <span className={`font-display text-2xl font-bold ${i % 2 === 0 ? "text-[#722F37]" : "text-[#C9A86A]"}`}>{s.n}</span>
                  <p className="text-sm font-semibold text-ivory-950">{s.title}</p>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {s.points.map((p) => (
                    <li key={p} className="flex gap-2 text-[12px] leading-relaxed text-ivory-700">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--color-accent)]" aria-hidden="true" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>

          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)] mb-2">
              The full toolkit
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {MODES.map((m) => (
                <div key={m.name} className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
                  <p className="text-xs font-semibold text-ivory-950">{m.name}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-ivory-600">{m.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 sm:px-8 py-4 border-t border-[var(--color-line-soft)] bg-[var(--color-canvas)] flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
          <p className="flex-1 text-[11px] leading-relaxed text-ivory-600">
            Your access token is never written to disk - session memory only.
          </p>
          <div className="flex gap-2 shrink-0">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              onClick={() => {
                onClose();
                onConnect();
              }}
            >
              Connect to Salesforce
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
