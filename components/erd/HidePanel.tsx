"use client";

import { useEffect, useState } from "react";
import Button from "../ui/Button";
import Input from "../ui/Input";

export interface HideSystemRow {
  apiName: string;
  label: string;
  reason: string;
  custom: boolean;
}

export interface HideGraphNode {
  apiName: string;
  label: string;
  visible: boolean;
}

export interface HideLink {
  id: string;
  from: string;
  to: string;
  via: string;
}

/**
 * Unified Hide panel. Tab 1 (System): the metadata sweep with per-item
 * allow-list - also honored by Neural. Tab 2 (Graph): every entity on the
 * graph with manual hide; anything removed from the graph (bubbles or links)
 * waits here for restore. One UI for all hiding.
 */
export function HidePanel({
  initialTab,
  systemRows,
  initialAllow,
  hideSystemActive,
  graphNodes,
  hiddenLinks,
  onClose,
  onApplySystem,
  onTurnOffSystem,
  onToggleNode,
  onRestoreLink,
  onRestoreAll,
}: {
  initialTab: "system" | "graph";
  systemRows: HideSystemRow[];
  initialAllow: Set<string>;
  hideSystemActive: boolean;
  graphNodes: HideGraphNode[];
  hiddenLinks: HideLink[];
  onClose: () => void;
  onApplySystem: (allow: Set<string>) => void;
  onTurnOffSystem: () => void;
  onToggleNode: (apiName: string, visible: boolean) => void;
  onRestoreLink: (id: string) => void;
  onRestoreAll: () => void;
}) {
  const [tab, setTab] = useState<"system" | "graph">(initialTab);
  const [allow, setAllow] = useState<Set<string>>(initialAllow);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = filter.toLowerCase().trim();
  const sysVisible = q
    ? systemRows.filter((r) => r.apiName.toLowerCase().includes(q) || r.label.toLowerCase().includes(q))
    : systemRows;
  const sysGroups = new Map<string, HideSystemRow[]>();
  for (const r of sysVisible) {
    if (!sysGroups.has(r.reason)) sysGroups.set(r.reason, []);
    sysGroups.get(r.reason)!.push(r);
  }
  const sysHidden = systemRows.filter((r) => !allow.has(r.apiName)).length;

  const graphVisible = q
    ? graphNodes.filter((n) => n.apiName.toLowerCase().includes(q) || n.label.toLowerCase().includes(q))
    : graphNodes;
  const graphHiddenCount = graphNodes.filter((n) => !n.visible).length + hiddenLinks.length;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Hide panel"
      onClick={onClose}
      style={{ paddingTop: "10vh" }}
    >
      <div className="modal-card max-w-lg flex flex-col" style={{ maxHeight: "76vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-3 border-b border-[var(--color-line-soft)] shrink-0">
          <div className="flex rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-0.5" role="tablist" aria-label="Hide sections">
            {(
              [
                ["system", `System · ${sysHidden}`],
                ["graph", `Graph · ${graphHiddenCount} hidden`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`flex-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                  tab === id ? "bg-[var(--color-surface)] text-ivory-950 shadow-sm" : "text-ivory-500 hover:text-ivory-950"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <Input placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter hidden items" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {tab === "system" && (
            <div className="space-y-3">
              <p className="text-xs text-ivory-600">Checked stays hidden. Uncheck to force-show - Neural honors the same list.</p>
              {[...sysGroups.entries()].map(([reason, list]) => (
                <div key={reason}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[1.6px] text-ivory-600">{reason} · {list.length}</p>
                  <div className="rounded-lg border border-[var(--color-line)] divide-y divide-[var(--color-line-soft)] overflow-hidden">
                    {list.map((r) => {
                      const hidden = !allow.has(r.apiName);
                      return (
                        <label key={r.apiName} className={`flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-ivory-300 ${hidden ? "" : "bg-ivory-200"}`}>
                          <input
                            type="checkbox"
                            checked={hidden}
                            onChange={() =>
                              setAllow((prev) => {
                                const next = new Set(prev);
                                if (next.has(r.apiName)) next.delete(r.apiName);
                                else next.add(r.apiName);
                                return next;
                              })
                            }
                            className="h-4 w-4 shrink-0 rounded border-ivory-400 bg-white text-bronze-600 focus:ring-bronze-500"
                            aria-label={`${hidden ? "Keep hidden" : "Force-show"} ${r.label}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-ivory-950">{r.label}</span>
                            <span className="block truncate font-mono text-[11px] text-ivory-600">{r.apiName}</span>
                          </span>
                          {r.custom && <span className="shrink-0 font-mono text-[9px] text-bronze-600">custom</span>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
              {sysVisible.length === 0 && <p className="py-6 text-center text-xs text-ivory-600">Nothing hidden - full neighborhood showing.</p>}
            </div>
          )}

          {tab === "graph" && (
            <div className="space-y-3">
              {hiddenLinks.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-[1.6px] text-ivory-600">Hidden links · {hiddenLinks.length}</p>
                  <ul className="space-y-1">
                    {hiddenLinks.map((l) => (
                      <li key={l.id} className="flex items-center gap-2 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-2.5 py-1.5">
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ivory-800">
                          {l.from} → {l.to} <span className="text-ivory-500">via {l.via}</span>
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => onRestoreLink(l.id)}>
                          Restore
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-[1.6px] text-ivory-600">Graph entities · {graphVisible.length}</p>
                <div className="rounded-lg border border-[var(--color-line)] divide-y divide-[var(--color-line-soft)] overflow-hidden">
                  {graphVisible.map((n) => (
                    <label key={n.apiName} className={`flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-ivory-300 ${n.visible ? "" : "bg-ivory-200"}`}>
                      <input
                        type="checkbox"
                        checked={n.visible}
                        onChange={() => onToggleNode(n.apiName, !n.visible)}
                        className="h-4 w-4 shrink-0 rounded border-ivory-400 bg-white text-bronze-600 focus:ring-bronze-500"
                        aria-label={`${n.visible ? "Hide" : "Show"} ${n.label}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-ivory-950">{n.label}</span>
                        <span className="block truncate font-mono text-[11px] text-ivory-600">{n.apiName}</span>
                      </span>
                      {!n.visible && (
                        <span className="shrink-0 rounded border border-[#E0C491] bg-[#F3EADB] px-1 py-px text-[9px] font-semibold text-[#9A5B13]">
                          hidden
                        </span>
                      )}
                    </label>
                  ))}
                  {graphVisible.length === 0 && <p className="px-3 py-3 text-center text-xs text-ivory-600">No matches.</p>}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-3.5 border-t border-[var(--color-line-soft)] bg-[var(--color-canvas)] flex items-center gap-2 shrink-0">
          {tab === "system" && hideSystemActive && (
            <Button variant="ghost" onClick={onTurnOffSystem}>
              Turn off
            </Button>
          )}
          {tab === "graph" && (
            <Button variant="ghost" onClick={onRestoreAll} disabled={graphHiddenCount === 0}>
              Restore all
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {tab === "system" && (
            <Button onClick={() => { onApplySystem(allow); onClose(); }}>
              {hideSystemActive ? "Done" : `Hide ${sysHidden}`}
            </Button>
          )}
          {tab === "graph" && (
            <Button onClick={onClose}>Done</Button>
          )}
        </div>
      </div>
    </div>
  );
}
