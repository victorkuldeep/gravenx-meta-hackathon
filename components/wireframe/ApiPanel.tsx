"use client";

import { useMemo } from "react";
import type { Experience } from "@/lib/wireframe/model";
import { apiImpact } from "@/lib/wireframe/systemBridge";

/**
 * API impact view (EPIC 09): per screen, what the experience reads,
 * writes, binds and pulls from outside - the input the System canvas
 * and Flow Lab need before anything runs.
 */
export function ApiPanel({ exp, onGotoScreen }: { exp: Experience; onGotoScreen: (screenId: string) => void }) {
  const impact = useMemo(() => apiImpact(exp), [exp]);
  const totals = impact.reduce(
    (acc, s) => ({ reads: acc.reads + s.reads.length, writes: acc.writes + s.writes.length }),
    { reads: 0, writes: 0 },
  );

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden rounded-xl border border-[#E8E2D8] bg-white" style={{ maxHeight: 640 }} aria-label="API impact">
      <div className="border-b border-[#EFE9DC] px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-[1px] text-[#27241F]">
          API impact · {totals.reads} read{totals.reads === 1 ? "" : "s"} · {totals.writes} write{totals.writes === 1 ? "" : "s"}
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {impact.every((s) => s.reads.length + s.writes.length + s.bindings.length + s.externals.length === 0) && (
          <p className="px-1 py-3 text-center text-[11px] leading-relaxed text-[#A39B8E]">
            No API surface yet - set read/write refs in the Inspector API section.
          </p>
        )}
        {impact
          .filter((s) => s.reads.length + s.writes.length + s.bindings.length + s.externals.length > 0)
          .map((s) => (
            <div key={s.screenId} className="rounded-lg border border-[#EFE9DC] p-2">
              <button
                type="button"
                onClick={() => onGotoScreen(s.screenId)}
                className="mb-1 w-full cursor-pointer truncate rounded px-1 py-0.5 text-left font-mono text-[10px] uppercase tracking-[1.5px] text-[#A39B8E] hover:bg-[#F5F1E8] hover:text-[#27241F]"
              >
                {s.screenName}
              </button>
              {s.reads.map((r) => (
                <p key={`r${r}`} className="truncate font-mono text-[10px] text-[#2F6F9F]" title={r}>GET · {r}</p>
              ))}
              {s.writes.map((w) => (
                <p key={`w${w}`} className="truncate font-mono text-[10px] text-[#9A7653]" title={w}>→ {w}</p>
              ))}
              {s.bindings.length > 0 && (
                <p className="mt-1 truncate font-mono text-[10px] text-[#777168]" title={s.bindings.join(", ")}>
                  ⚡ {s.bindings.slice(0, 3).join(", ")}{s.bindings.length > 3 ? ` +${s.bindings.length - 3}` : ""}
                </p>
              )}
              {s.externals.map((e) => (
                <p key={`e${e}`} className="truncate font-mono text-[10px] text-[#7A5FA0]" title={e}>⇅ {e}</p>
              ))}
            </div>
          ))}
      </div>
    </aside>
  );
}
