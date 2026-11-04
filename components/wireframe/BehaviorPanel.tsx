"use client";

import { useMemo } from "react";
import type { Experience } from "@/lib/wireframe/model";
import { behaviorCount, screenBehaviors } from "@/lib/wireframe/behavior";

/**
 * Behavior overview (EPIC 07): every interaction intent grouped by screen,
 * dangling navigations flagged, one click jumps to the component.
 */
export function BehaviorPanel({ exp, onSelectComponent }: { exp: Experience; onSelectComponent: (id: string) => void }) {
  const groups = useMemo(() => screenBehaviors(exp), [exp]);
  const total = behaviorCount(exp);

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden rounded-xl border border-[#E8E2D8] bg-white" style={{ maxHeight: 640 }} aria-label="Behavior overview">
      <div className="border-b border-[#EFE9DC] px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-[1px] text-[#27241F]">
          Behavior · {total} action{total === 1 ? "" : "s"}
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {groups.length === 0 && (
          <p className="px-1 py-3 text-center text-[11px] leading-relaxed text-[#A39B8E]">
            No actions yet - give a button an interaction in the Inspector, e.g. click → save → Account.
          </p>
        )}
        {groups.map((g) => (
          <div key={g.screenId || "none"} className="rounded-lg border border-[#EFE9DC] p-2">
            <p className="mb-1 truncate font-mono text-[10px] uppercase tracking-[1.5px] text-[#A39B8E]">{g.screenName}</p>
            <ul className="space-y-1">
              {g.items.map((i) => (
                <li key={i.componentId}>
                  <button
                    type="button"
                    onClick={() => onSelectComponent(i.componentId)}
                    className="w-full cursor-pointer rounded-md px-1.5 py-1 text-left hover:bg-[#F5F1E8]"
                    title={`${i.kind} · on ${i.trigger}`}
                  >
                    <span className="block truncate text-[12px] font-medium text-[#27241F]">
                      {i.label} <span className="font-mono text-[10px] text-[#A39B8E]">on {i.trigger} → {i.action}{i.target ? ` · ${i.target}` : ""}</span>
                    </span>
                    {i.dangling && (
                      <span className="block truncate text-[11px] text-red-700">⚠ navigates nowhere - no such screen</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  );
}
