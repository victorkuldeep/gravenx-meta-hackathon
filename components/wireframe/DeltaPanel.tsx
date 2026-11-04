"use client";

import { useMemo, useState } from "react";
import Button from "../ui/Button";
import type { Experience } from "@/lib/wireframe/model";
import { invalidProposals, schemaDelta } from "@/lib/wireframe/proposed";

/** Copy helper with a legacy fallback for non-secure contexts. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

function specText(exp: Experience): string {
  const lines = [`SCHEMA IMPACT - ${exp.name} (v${exp.version})`, ""];
  for (const d of schemaDelta(exp)) {
    lines.push(`${d.object}`);
    if (d.existing.length > 0) {
      lines.push("Existing");
      for (const f of d.existing) lines.push(`  ✓ ${f}`);
    }
    if (d.proposed.length > 0) {
      lines.push("New");
      for (const p of d.proposed) {
        const extra = p.type === "Picklist" || p.type === "Multiselect Picklist" ? ` [${(p.values ?? []).join(" | ")}]` : "";
        lines.push(`  + ${p.apiName} (${p.type})${p.required ? " required" : ""}${extra}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Schema delta view (EPIC 06): per-object existing bindings vs proposed
 * fields, invalid proposals flagged, one-click metadata spec copy for the
 * Author queue / client review.
 */
export function DeltaPanel({ exp, onSelectComponent }: { exp: Experience; onSelectComponent: (id: string) => void }) {
  const delta = useMemo(() => schemaDelta(exp), [exp]);
  const invalid = useMemo(() => invalidProposals(exp.components), [exp.components]);
  const [copied, setCopied] = useState(false);

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden rounded-xl border border-[#E8E2D8] bg-white" style={{ maxHeight: 640 }} aria-label="Schema delta">
      <div className="border-b border-[#EFE9DC] px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-[1px] text-[#27241F]">
          Schema delta · {exp.proposedFields.length} proposed
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {invalid.length > 0 && (
          <div className="rounded-lg bg-red-500/5 p-2">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[1.5px] text-red-700">Needs attention · {invalid.length}</p>
            <ul className="space-y-1">
              {invalid.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => onSelectComponent(o.id)}
                    className="w-full cursor-pointer truncate rounded-md px-1.5 py-1 text-left text-[11px] text-red-700 hover:bg-red-500/10"
                    title={o.problems.join(" ")}
                  >
                    {o.label} - {o.problems[0]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {delta.length === 0 && (
          <p className="px-1 py-3 text-center text-[11px] leading-relaxed text-[#A39B8E]">
            No bindings yet - bind a component or propose a field to see the org impact.
          </p>
        )}
        {delta.map((d) => (
          <div key={d.object} className="rounded-lg border border-[#EFE9DC] p-2">
            <p className="mb-1 truncate font-mono text-[11px] font-bold text-[#27241F]">{d.object}</p>
            {d.existing.length > 0 && (
              <ul className="mb-1 space-y-px">
                {d.existing.slice(0, 8).map((f) => (
                  <li key={f} className="truncate font-mono text-[10px] text-[#2F7D4F]">✓ {f}</li>
                ))}
                {d.existing.length > 8 && (
                  <li className="font-mono text-[10px] text-[#A39B8E]">+{d.existing.length - 8} more</li>
                )}
              </ul>
            )}
            {d.proposed.map((p) => (
              <p key={p.apiName} className="truncate font-mono text-[10px] text-[#8A6A2F]" title={`${p.label} · ${p.type}`}>
                + {p.apiName} · {p.type}
              </p>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-[#EFE9DC] p-2">
        <Button
          size="sm"
          variant="secondary"
          className="w-full"
          disabled={delta.length === 0}
          onClick={() => {
            void copyText(specText(exp)).then((ok) => {
              if (ok) {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            });
          }}
        >
          {copied ? "Copied ✓" : "Copy metadata spec"}
        </Button>
      </div>
    </aside>
  );
}
