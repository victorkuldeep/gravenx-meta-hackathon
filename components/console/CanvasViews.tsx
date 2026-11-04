"use client";

import { CONSOLE_STATUS_LABELS, consoleLinkHref, groupCanvasViews } from "@/lib/console/model";
import type { CanvasLinkView } from "@/lib/console/sync";
import { fmtDate } from "./TaskDetail";

const SURFACE_LABELS: Record<string, string> = {
  system: "System",
  schema: "Schema",
  notes: "Notes",
};

/**
 * Canvas browser: every live canvas item (TODOs plus whole-record notes)
 * grouped by owning canvas, reachable without opening a task first. Open
 * jumps to the studio tab; + Task starts a tracked Console task from it.
 */
export function CanvasViews({
  views,
  query,
  onNewTask,
}: {
  views: CanvasLinkView[];
  query: string;
  onNewTask: (item: CanvasLinkView) => void;
}) {
  const q = query.trim().toLowerCase();
  const visible = q
    ? views.filter((v) => `${v.title} ${v.recordName}`.toLowerCase().includes(q))
    : views;
  const groups = groupCanvasViews(visible);

  if (views.length === 0) {
    return (
      <div className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-8 text-center">
        <p className="text-[13px] font-semibold text-[#27241F]">No canvas items yet</p>
        <p className="mx-auto mt-1 max-w-[440px] text-[11px] leading-relaxed text-[#777168]">
          Log TODOs on a System project, notes or entries on the Schema canvas, or write in Notes —
          everything linked live appears here, grouped by canvas.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {groups.map((g) => (
        <section key={`${g.surface}-${g.recordId}`} className="overflow-hidden rounded-xl border border-[#E8E2D8] bg-white">
          <header className="flex items-center gap-2 border-b border-[#E8E2D8] bg-[#FBFAF7] px-4 py-2">
            <span className="rounded-md bg-[#27241F] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-[#F5F1E8]">
              {SURFACE_LABELS[g.surface] ?? g.surface}
            </span>
            <a
              href={consoleLinkHref({ surface: g.surface as CanvasLinkView["surface"], recordId: g.recordId })}
              title={`Open ${g.recordName}`}
              className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#27241F] hover:text-[#8A6A2F] hover:underline"
            >
              {g.recordName}
            </a>
            <span className="shrink-0 font-mono text-[10px] text-[#A39B8E]">
              {g.items.length} item{g.items.length === 1 ? "" : "s"}
            </span>
          </header>
          <ul>
            {g.items.map((v) => (
              <li
                key={`${v.surface}-${v.recordId}-${v.todoId ?? "notes"}`}
                className="flex items-center gap-2 border-b border-[#F0EBE0] px-4 py-2 last:border-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-[#27241F]">
                    {v.title}
                    {!v.todoId && (
                      <span className="ml-1.5 rounded border border-[#DCC99A] bg-[#F5EEDF] px-1 py-px align-middle font-mono text-[9px] font-bold uppercase text-[#8A6A2F]">
                        note
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-[#A39B8E]">
                    {v.kind ?? "task"} · {v.status ? CONSOLE_STATUS_LABELS[v.status] : "Note"}
                    {v.owner ? ` · ${v.owner}` : ""}
                    {v.dueDate ? ` · due ${v.dueDate}` : ""} · {fmtDate(v.updatedAt)}
                  </span>
                  {v.excerpt && <span className="mt-0.5 block truncate text-[11px] text-[#777168]">{v.excerpt}</span>}
                </span>
                <a
                  href={consoleLinkHref({ surface: v.surface, recordId: v.recordId })}
                  title="Open on its canvas"
                  className="shrink-0 cursor-pointer rounded-lg border border-[#E8E2D8] px-2 py-1 text-[11px] font-semibold text-[#27241F] transition-colors hover:border-[#C9A86A]"
                >
                  Open
                </a>
                <button
                  type="button"
                  onClick={() => onNewTask(v)}
                  title="Track this as a Console task"
                  className="shrink-0 cursor-pointer rounded-lg bg-[#27241F] px-2 py-1 text-[11px] font-semibold text-[#F5F1E8] transition-colors hover:bg-[#3A352D]"
                >
                  + Task
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {groups.length === 0 && (
        <p className="rounded-xl border border-[#E8E2D8] bg-white px-4 py-6 text-center text-[12px] text-[#A39B8E]">
          Nothing matches this search.
        </p>
      )}
    </div>
  );
}
