"use client";

import { useState } from "react";
import Button from "../ui/Button";
import type { Experience } from "@/lib/wireframe/model";
import { buildSpec } from "@/lib/wireframe/buildSpec";

/**
 * Build-instruction dialog (EPIC 10): the deterministic spec, ready to
 * paste into a coding agent. Copy or download - the experience version
 * travels in the text so generated code stays traceable.
 */
export function SpecDialog({ exp, onClose }: { exp: Experience; onClose: () => void }) {
  const [spec] = useState(() => buildSpec(exp));
  const [copied, setCopied] = useState(false);

  const download = () => {
    try {
      const blob = new Blob([spec], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exp.name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-v${exp.version}-build-spec.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      /* download unavailable - copy still works */
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Build instructions"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
          AI build instructions
        </p>
        <h2 className="mt-1 text-lg font-bold text-[var(--color-ink)]">
          {exp.name} · v{exp.version}
        </h2>
        <pre className="mt-3 min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[#E8E2D8] bg-white p-3 font-mono text-[11px] leading-relaxed text-[#27241F]">
          {spec}
        </pre>
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              void (async () => {
                try {
                  await navigator.clipboard.writeText(spec);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* clipboard denied */
                }
              })();
            }}
          >
            {copied ? "Copied ✓" : "Copy spec"}
          </Button>
          <Button size="sm" variant="secondary" onClick={download}>
            Download .md
          </Button>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
