"use client";

import { useState } from "react";
import Button from "../ui/Button";
import { logChange } from "@/lib/experience/migrate";
import type { StudioProject } from "@/lib/studio/types";
import type { UserJourney } from "@/lib/experience/types";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const inputCls =
  "rounded-lg border border-[#E8E2D8] bg-white px-2 py-1.5 text-[12px] focus:border-[#A98450] focus:outline-none";

/** Lightweight journey builder: ordered screen sequences + transitions. */
export function JourneyPanel({
  project,
  onMutate,
  onOpenScreen,
}: {
  project: StudioProject;
  onMutate: (fn: (p: StudioProject) => StudioProject) => void;
  onOpenScreen: (screenId: string) => void;
}) {
  const exp = project.experience!;
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const mutateExp = (fn: (e: NonNullable<StudioProject["experience"]>) => NonNullable<StudioProject["experience"]>, summary: string, entityId: string) => {
    onMutate((p) => {
      if (!p.experience) return p;
      const now = new Date().toISOString();
      const next = { ...p, experience: { ...fn(p.experience), updatedAt: now }, updatedAt: now };
      logChange(next, "journey", entityId, "updated", summary, now);
      return next;
    });
  };

  const create = () => {
    if (!name.trim()) return;
    const j: UserJourney = { id: uid("jrn"), name: name.trim(), screenIds: [], transitionIds: [], status: "draft" };
    mutateExp((e) => ({ ...e, journeys: [...e.journeys, j] }), `Journey "${j.name}" created.`, j.id);
    setName("");
    setShowAdd(false);
    setOpenId(j.id);
  };

  return (
    <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
          Journeys · {exp.journeys.length}
        </p>
        <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? "Cancel" : "Add journey"}
        </Button>
      </div>
      {showAdd && (
        <div className="mb-2 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Journey name (e.g. Place an order)" aria-label="Journey name" className={`${inputCls} flex-1`} />
          <Button size="sm" disabled={!name.trim()} onClick={create}>
            Create
          </Button>
        </div>
      )}
      <ul className="space-y-2">
        {exp.journeys.map((j) => {
          const open = openId === j.id;
          return (
            <li key={j.id} className="rounded-xl border border-[#F0EBE0] px-3 py-2">
              <span className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setOpenId(open ? null : j.id)} aria-pressed={open} className="min-w-0 flex-1 cursor-pointer text-left">
                  <span className="block truncate text-[12px] font-semibold text-[#27241F]">{j.name}</span>
                  <span className="block font-mono text-[10px] text-[#A39B8E]">{j.screenIds.length} steps · {j.status}</span>
                </button>
                <select value={j.status} onChange={(e) => mutateExp((ex) => ({ ...ex, journeys: ex.journeys.map((x) => (x.id === j.id ? { ...x, status: e.target.value as UserJourney["status"] } : x)) }), `Journey "${j.name}" → ${e.target.value}.`, j.id)} aria-label="Journey status" className="cursor-pointer rounded-md border border-[#E8E2D8] bg-white px-1 py-0.5 font-mono text-[10px]">
                  <option value="draft">draft</option>
                  <option value="in-review">in-review</option>
                  <option value="confirmed">confirmed</option>
                </select>
                <button
                  type="button"
                  onClick={() =>
                    onMutate((p) => {
                      if (!p.experience) return p;
                      const tids = new Set(p.experience.transitions.filter((t) => t.journeyId === j.id).map((t) => t.id));
                      return {
                        ...p,
                        experience: {
                          ...p.experience,
                          journeys: p.experience.journeys.filter((x) => x.id !== j.id),
                          transitions: p.experience.transitions.filter((t) => !tids.has(t.id)),
                        },
                      };
                    })
                  }
                  aria-label={`Delete journey ${j.name}`}
                  className="rounded px-1 text-[11px] text-[#B3261E] hover:bg-[#F9E8E6] cursor-pointer"
                >
                  delete
                </button>
              </span>
              {open && (
                <JourneySteps
                  project={project}
                  journey={j}
                  onMutate={onMutate}
                  onOpenScreen={(id) => {
                    onOpenScreen(id);
                  }}
                />
              )}
            </li>
          );
        })}
        {exp.journeys.length === 0 && <li className="text-[12px] text-[#A39B8E]">No journeys - order screens into a user flow.</li>}
      </ul>
    </div>
  );
}

function JourneySteps({
  project,
  journey,
  onMutate,
  onOpenScreen,
}: {
  project: StudioProject;
  journey: UserJourney;
  onMutate: (fn: (p: StudioProject) => StudioProject) => void;
  onOpenScreen: (screenId: string) => void;
}) {
  const exp = project.experience!;
  const [addId, setAddId] = useState("");
  const available = exp.screens.filter((s) => !journey.screenIds.includes(s.id));

  const setSteps = (screenIds: string[]) => {
    onMutate((p) => {
      if (!p.experience) return p;
      const now = new Date().toISOString();
      // Rebuild transitions as an ordered chain between consecutive screens.
      const transitions = p.experience.transitions.filter((t) => t.journeyId !== journey.id);
      for (let i = 0; i + 1 < screenIds.length; i++) {
        transitions.push({
          id: uid("tr"),
          journeyId: journey.id,
          fromScreenId: screenIds[i],
          toScreenId: screenIds[i + 1],
          status: "proposed" as const,
        });
      }
      return {
        ...p,
        experience: {
          ...p.experience,
          journeys: p.experience.journeys.map((j) =>
            j.id === journey.id ? { ...j, screenIds, transitionIds: transitions.filter((t) => t.journeyId === journey.id).map((t) => t.id) } : j
          ),
          transitions,
          updatedAt: now,
        },
        updatedAt: now,
      };
    });
  };

  const move = (i: number, dir: -1 | 1) => {
    const next = [...journey.screenIds];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next);
  };

  return (
    <div className="mt-2 border-t border-[#F0EBE0] pt-2">
      <ol className="space-y-1">
        {journey.screenIds.map((sid, i) => {
          const s = exp.screens.find((x) => x.id === sid);
          return (
            <li key={`${sid}-${i}`} className="flex items-center gap-1.5 rounded-lg border border-[#F0EBE0] px-2 py-1">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#211F1B] font-mono text-[10px] text-white">{i + 1}</span>
              {s ? (
                <button type="button" onClick={() => onOpenScreen(s.id)} className="min-w-0 flex-1 cursor-pointer truncate text-left text-[12px] text-[#27241F] hover:underline">
                  {s.name}
                </button>
              ) : (
                <span className="flex-1 text-[12px] text-[#B3261E]">missing screen</span>
              )}
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move step up" className="rounded px-1 text-[#A39B8E] hover:text-[#27241F] disabled:opacity-30 cursor-pointer">
                ↑
              </button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === journey.screenIds.length - 1} aria-label="Move step down" className="rounded px-1 text-[#A39B8E] hover:text-[#27241F] disabled:opacity-30 cursor-pointer">
                ↓
              </button>
              <button type="button" onClick={() => setSteps(journey.screenIds.filter((_, k) => k !== i))} aria-label="Remove step" className="rounded px-1 text-[#B3261E] hover:bg-[#F9E8E6] cursor-pointer">
                ✕
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-1.5 flex gap-2">
        <select value={addId} onChange={(e) => setAddId(e.target.value)} aria-label="Add screen to journey" className={`${inputCls} flex-1 cursor-pointer`}>
          <option value="">append screen…</option>
          {available.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Button size="sm" variant="ghost" disabled={!addId} onClick={() => { setSteps([...journey.screenIds, addId]); setAddId(""); }}>
          Add
        </Button>
      </div>
    </div>
  );
}
