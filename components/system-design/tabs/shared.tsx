"use client";

/** Shared bits for the System Design workbench tabs. */

import type { SystemProject } from "@/lib/system-design/model";

export type Mutate = (fn: (p: SystemProject) => SystemProject) => void;

export const METHOD_STYLES: Record<string, string> = {
  GET: "bg-green-700/10 text-green-800",
  POST: "bg-bronze-500/10 text-bronze-700",
  PUT: "bg-amber-600/10 text-amber-800",
  PATCH: "bg-amber-600/10 text-amber-800",
  DELETE: "bg-red-700/10 text-red-700",
  EVENT: "bg-ivory-500/10 text-ivory-700",
  QUERY: "bg-ivory-500/10 text-ivory-700",
};

export const methodBadge = (method: string): string =>
  `shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${METHOD_STYLES[method] ?? METHOD_STYLES.QUERY}`;

export const panelShell =
  "min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4";

export const fieldLabel =
  "mb-1 block text-[10px] font-semibold uppercase tracking-wider text-ivory-600";

export const textInput =
  "w-full rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 text-xs text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none";

export const monoInput =
  "w-full rounded-lg border border-[var(--color-line)] bg-white px-2 py-1.5 font-mono text-[11px] text-ivory-800 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none";

export const edgeLabel = (
  project: Pick<SystemProject, "connections" | "systems">,
  edgeId: string
): string => {
  const c = project.connections.find((e) => e.id === edgeId);
  if (!c) return edgeId;
  const name = (id: string) => project.systems.find((s) => s.id === id)?.name ?? id;
  return `${name(c.sourceId)} → ${name(c.targetId)}${c.label ? ` · ${c.label}` : ""}`;
};
