"use client";

import { useState } from "react";
import Button from "../ui/Button";
import type { Experience, Journey } from "@/lib/wireframe/model";
import { createJourney, moveJourneyScreen, toggleJourneyScreen } from "@/lib/wireframe/journey";

/**
 * Journey overview (EPIC 08): named paths through screens - the demo
 * script, the click path, the workshop walkthrough. Selecting a step
 * jumps to that screen on the canvas.
 */
export function JourneyPanel({
  exp,
  onPatchJourneys,
  onGotoScreen,
}: {
  exp: Experience;
  onPatchJourneys: (journeys: Journey[]) => void;
  onGotoScreen: (screenId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const screensById = new Map(exp.screens.map((s) => [s.id, s]));

  const update = (id: string, fn: (j: Journey) => Journey) =>
    onPatchJourneys(exp.journeys.map((j) => (j.id === id ? fn(j) : j)));

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-hidden rounded-xl border border-[#E8E2D8] bg-white" style={{ maxHeight: 640 }} aria-label="Journeys">
      <div className="border-b border-[#EFE9DC] px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-[1px] text-[#27241F]">
          Journeys · {exp.journeys.length}
        </p>
        <div className="mt-1.5 flex gap-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                onPatchJourneys([...exp.journeys, createJourney(draft)]);
                setDraft("");
              }
            }}
            placeholder="New journey…"
            aria-label="New journey name"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-[#E8E2D8] px-2 py-1.5 text-xs text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none"
          />
          <Button
            size="sm"
            title="Add journey"
            onClick={() => {
              if (!draft.trim()) return;
              onPatchJourneys([...exp.journeys, createJourney(draft)]);
              setDraft("");
            }}
          >
            +
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {exp.journeys.length === 0 && (
          <p className="px-1 py-3 text-center text-[11px] leading-relaxed text-[#A39B8E]">
            No journeys yet - name the walkthrough above, then add screens in order.
          </p>
        )}
        {exp.journeys.map((j, ji) => (
          <JourneyCard
            key={j.id}
            journey={j}
            index={ji}
            screensById={screensById}
            allScreenIds={exp.screens.map((s) => s.id)}
            onUpdate={(fn) => update(j.id, fn)}
            onDelete={() => onPatchJourneys(exp.journeys.filter((x) => x.id !== j.id))}
            onGotoScreen={onGotoScreen}
          />
        ))}
      </div>
    </aside>
  );
}

function JourneyCard({
  journey: j,
  index,
  screensById,
  allScreenIds,
  onUpdate,
  onDelete,
  onGotoScreen,
}: {
  journey: Journey;
  index: number;
  screensById: Map<string, { id: string; name: string }>;
  allScreenIds: string[];
  onUpdate: (fn: (j: Journey) => Journey) => void;
  onDelete: () => void;
  onGotoScreen: (screenId: string) => void;
}) {
  const [expanded, setExpanded] = useState(index === 0);
  const missing = allScreenIds.filter((id) => !j.screenIds.includes(id));

  const move = (id: string, dir: -1 | 1) => onUpdate((cur) => moveJourneyScreen(cur, id, dir));
  const toggle = (id: string) => onUpdate((cur) => toggleJourneyScreen(cur, id));

  return (
    <div className="rounded-lg border border-[#EFE9DC] p-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="min-w-0 flex-1 cursor-pointer truncate rounded px-1 py-0.5 text-left text-[12px] font-semibold text-[#27241F] hover:bg-[#F5F1E8]"
        >
          {expanded ? "▾" : "▸"} {j.name}
          <span className="ml-1 font-mono text-[10px] font-normal text-[#A39B8E]">{j.screenIds.length} steps</span>
        </button>
        <button
          type="button"
          onClick={onDelete}
          title={`Delete ${j.name}`}
          aria-label={`Delete ${j.name}`}
          className="shrink-0 rounded p-1 text-[#C9BFAE] cursor-pointer hover:bg-red-500/10 hover:text-red-700"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      {expanded && (
        <ol className="mt-1 space-y-0.5">
          {j.screenIds.map((id, i) => {
            const s = screensById.get(id);
            if (!s) return null;
            return (
              <li key={id} className="group flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => onGotoScreen(id)}
                  className="min-w-0 flex-1 cursor-pointer truncate rounded px-1.5 py-1 text-left text-[11px] text-[#27241F] hover:bg-[#F5F1E8]"
                  title={`Go to ${s.name}`}
                >
                  <span className="mr-1 font-mono text-[10px] text-[#9A7653]">{i + 1}.</span>
                  {s.name}
                </button>
                <button type="button" onClick={() => void move(id, -1)} title="Earlier" aria-label="Move earlier" className="rounded px-1 text-[11px] text-[#A39B8E] cursor-pointer hover:bg-[#F5F1E8] hover:text-[#27241F]">↑</button>
                <button type="button" onClick={() => void move(id, 1)} title="Later" aria-label="Move later" className="rounded px-1 text-[11px] text-[#A39B8E] cursor-pointer hover:bg-[#F5F1E8] hover:text-[#27241F]">↓</button>
                <button type="button" onClick={() => void toggle(id)} title="Remove step" aria-label="Remove step" className="rounded px-1 text-[11px] text-[#C9BFAE] cursor-pointer hover:bg-red-500/10 hover:text-red-700">×</button>
              </li>
            );
          })}
          {missing.length > 0 && (
            <li className="pt-1">
              <p className="mb-0.5 px-1 font-mono text-[9px] uppercase tracking-[1.5px] text-[#A39B8E]">Add step</p>
              <div className="flex flex-wrap gap-1">
                {missing.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => void toggle(id)}
                    className="cursor-pointer truncate rounded-md border border-[#E8E2D8] px-1.5 py-0.5 text-[10px] text-[#777168] hover:border-[#C9A86A] hover:text-[#27241F]"
                  >
                    + {screensById.get(id)?.name ?? id}
                  </button>
                ))}
              </div>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
