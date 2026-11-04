"use client";

import { useMemo, useState } from "react";
import type { ExecutionModel, Finding } from "@/lib/log-decomposer/model";
import { aggregateHotspots } from "@/lib/log-decomposer/hotspots";

const SEV_STYLE: Record<string, { dot: string; text: string; ring: string }> = {
  CRITICAL: { dot: "bg-red-600", text: "text-red-700", ring: "ring-red-300" },
  HIGH: { dot: "bg-orange-500", text: "text-orange-700", ring: "ring-orange-200" },
  MEDIUM: { dot: "bg-amber-500", text: "text-amber-700", ring: "ring-amber-200" },
  LOW: { dot: "bg-sky-500", text: "text-sky-700", ring: "ring-sky-200" },
  INFO: { dot: "bg-ivory-300", text: "text-ivory-600", ring: "ring-ivory-200" },
};

const TYPE_LABEL: Record<string, string> = {
  EXCEPTION: "Exception",
  GOVERNOR_LIMIT: "Governor limit",
  PERFORMANCE: "Performance",
  CALLOUT: "Callout",
  ANOMALY: "Anomaly",
};

export function DiagnosePanel({
  findings,
  execution,
  onJump,
}: {
  findings: Finding[];
  execution: ExecutionModel | null;
  onJump: (nodeId: string | null, line: number | null) => void;
}) {
  const hotspots = useMemo(() => (execution ? aggregateHotspots(execution) : []), [execution]);
  const [typeFilter, setTypeFilter] = useState("ALL");
  const types = useMemo(() => ["ALL", ...[...new Set(findings.map((f) => f.type))].sort()], [findings]);
  const visible = useMemo(
    () => (typeFilter === "ALL" ? findings : findings.filter((f) => f.type === typeFilter)),
    [findings, typeFilter]
  );
  const groups = useMemo(() => {
    const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
    const by: Record<string, Finding[]> = {};
    for (const f of visible) (by[f.severity] ??= []).push(f);
    return order.filter((s) => by[s]).map((s) => ({ severity: s, items: by[s] }));
  }, [visible]);

  if (findings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-line)] px-4 py-10 text-center">
        <p className="text-[13px] font-bold text-ivory-950">No findings yet</p>
        <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-ivory-500">
          Pull a log and the deterministic rules check exceptions, governor limits, slow operations, callouts and structural anomalies - before any AI is involved.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
      {hotspots.length > 0 && (
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
          <h3 className="text-[13px] font-bold text-ivory-950">Hotspots · where the time went</h3>
          <p className="mt-0.5 text-[11px] text-ivory-500">
            Repeated operations folded by signature (literals become ?) with self-time - own duration minus children.
          </p>
          <ul className="mt-2 space-y-1">
            {hotspots.map((h) => (
              <li key={h.key}>
                <button
                  type="button"
                  onClick={() => onJump(h.nodeIds[0] ?? null, null)}
                  title={`${h.calls} calls · self ${h.selfMs}ms · open first occurrence in Explore`}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-[var(--color-line)] bg-white px-2.5 py-2 text-left hover:border-bronze-600"
                >
                  <span className="shrink-0 rounded-full bg-ivory-200 px-1.5 py-px text-[10px] font-bold text-ivory-700">{h.kind}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ivory-950" title={h.label}>
                    {h.label}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-ivory-500">×{h.calls}</span>
                  <span className="shrink-0 font-mono text-[11px] font-bold text-ivory-950">{h.totalMs}ms</span>
                  <span className="shrink-0 font-mono text-[11px] text-ivory-500">self {h.selfMs}ms</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {types.length > 2 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter findings by type">
          {types.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              aria-pressed={typeFilter === t}
              className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                typeFilter === t
                  ? "border-[#722F37] bg-[#722F37] text-white"
                  : "border-[var(--color-line)] bg-white text-ivory-600 hover:border-bronze-600"
              }`}
            >
              {t === "ALL" ? "All" : (TYPE_LABEL[t] ?? t)}
            </button>
          ))}
        </div>
      )}
      {groups.map((g) => {
        const style = SEV_STYLE[g.severity] ?? SEV_STYLE.INFO;
        return (
          <section key={g.severity}>
            <h3 className={`flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide ${style.text}`}>
              <span className={`h-2 w-2 rounded-full ${style.dot}`} />
              {g.severity} · {g.items.length}
            </h3>
            <ul className="mt-1.5 space-y-1.5">
              {g.items.map((f) => (
                <li key={f.id} className={`rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 ring-1 ${style.ring}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-ivory-200 px-1.5 py-px text-[10px] font-bold text-ivory-700">{TYPE_LABEL[f.type] ?? f.type}</span>
                    <p className="min-w-0 flex-1 truncate text-[12px] font-bold text-ivory-950" title={f.title}>
                      {f.title}
                    </p>
                  </div>
                  <p className="mt-1 font-mono text-[11px] leading-relaxed text-ivory-600">{f.summary}</p>
                  {f.evidence.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {f.evidence.slice(0, 8).map((ev, i) => (
                        <button
                          key={`${ev.kind}:${ev.ref}:${i}`}
                          type="button"
                          onClick={() => {
                            const nodeRef = ev.kind === "node" ? ev.ref : (f.relatedNodeIds[0] ?? null);
                            onJump(nodeRef, ev.lineStart ?? ev.lineEnd ?? null);
                          }}
                          title={ev.label ?? ev.ref}
                          className="cursor-pointer rounded-full border border-[var(--color-line)] bg-white px-2 py-0.5 font-mono text-[10px] text-ivory-700 hover:border-bronze-600"
                        >
                          {ev.kind === "raw-range" ? `L${(ev.lineStart ?? 0) + 1}–${(ev.lineEnd ?? 0) + 1}` : ev.label ?? ev.ref}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
