"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

/** Neutral stroke glyphs per system iconKey - no vendor artwork. */
export function SystemGlyph({ iconKey }: { iconKey: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    "aria-hidden": true,
  } as const;
  switch (iconKey) {
    case "cloud":
      return (
        <svg {...common}><path d="M7 18a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18.3 10 3.8 3.8 0 0 1 17.5 18H7Z" /></svg>
      );
    case "lifering":
      return (
        <svg {...common}><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.5" /><path d="M6 6l3 3m6 6 3 3M18 6l-3 3M6 18l3-3" /></svg>
      );
    case "exchange":
      return (
        <svg {...common}><path d="M4 8h13l-3-3M20 16H7l3 3" /></svg>
      );
    case "code":
      return (
        <svg {...common}><path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" /></svg>
      );
    case "bolt":
      return (
        <svg {...common}><path d="M13 3 5 13.5h5L11 21l8-10.5h-5L13 3Z" /></svg>
      );
    case "diamond":
      return (
        <svg {...common}><path d="M12 3l2.5 7.5L22 13l-7.5 2.5L12 23l-2.5-7.5L2 13l7.5-2.5L12 3Z" /></svg>
      );
    case "cylinder":
      return (
        <svg {...common}><ellipse cx="12" cy="6" rx="7" ry="2.8" /><path d="M5 6v12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V6" /><path d="M5 12c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8" /></svg>
      );
    case "layers":
      return (
        <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>
      );
    case "grid":
      return (
        <svg {...common}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></svg>
      );
    case "server":
      return (
        <svg {...common}><rect x="4" y="4" width="16" height="7" rx="1.5" /><rect x="4" y="13" width="16" height="7" rx="1.5" /><path d="M7.5 7.5h.01M7.5 16.5h.01" /></svg>
      );
    case "activity":
      return (
        <svg {...common}><path d="M3 12h4l2.5-6 4 12L16 12h5" /></svg>
      );
    case "globe":
      return (
        <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c-4.5 4.5-4.5 12.5 0 17M12 3.5c4.5 4.5 4.5 12.5 0 17" /></svg>
      );
    case "doc":
      return (
        <svg {...common}><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></svg>
      );
    case "briefcase":
      return (
        <svg {...common}><rect x="3.5" y="8" width="17" height="12" rx="2" /><path d="M9 8V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3.5 13h17" /></svg>
      );
    case "card":
      return (
        <svg {...common}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10.5h18M7 15h4" /></svg>
      );
    case "shield":
      return (
        <svg {...common}><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /><path d="m9.5 12 2 2 3.5-4" /></svg>
      );
    case "bank":
      return (
        <svg {...common}><path d="m3 9 9-5 9 5M4.5 9.5V18M9.5 9.5V18M14.5 9.5V18M19.5 9.5V18M3 18.5h18M3 21h18" /></svg>
      );
    case "bell":
      return (
        <svg {...common}><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15L6 16Z" /><path d="M10 21a2.2 2.2 0 0 0 4 0" /></svg>
      );
    default:
      return (
        <svg {...common}><path d="M12 5v14M5 12h14" /></svg>
      );
  }
}

export interface SystemNodeData extends Record<string, unknown> {
  name: string;
  systemType: string;
  iconKey: string;
  /** Slice 1: every connection is draft - amber dot, never executable. */
  draft: boolean;
}

function SystemNodeInner({ data, selected }: NodeProps<Node<SystemNodeData>>) {
  return (
    <div
      className={`w-max max-w-[300px] rounded-xl border-2 bg-[var(--color-surface)] shadow-[0_8px_28px_-10px_rgba(24,20,12,0.35)] transition-colors ${
        selected ? "border-bronze-500" : "border-[var(--color-line)]"
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        title="Drop a connection here"
        style={{ width: 12, height: 12, background: "#fff", border: "2px solid #A98450" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        title="Drag from here to another node to connect"
        style={{ width: 12, height: 12, background: "#fff", border: "2px solid #A98450" }}
      />
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bronze-100 text-bronze-700">
          <SystemGlyph iconKey={data.iconKey} />
        </span>
        <span className="min-w-0 flex-1">
          <span title={data.name} className="block break-words text-[13px] font-bold leading-snug text-ivory-950">{data.name}</span>
          <span className="block truncate font-mono text-[10px] uppercase tracking-wider text-ivory-500">
            {data.systemType}
          </span>
        </span>
        <span
          title={data.draft ? "Draft - not executable until an operation is bound (Phase 2)" : ""}
          aria-label={data.draft ? "Draft system" : "System"}
          className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
        />
      </div>
    </div>
  );
}

export const SystemNodeView = memo(SystemNodeInner);
