"use client";

import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { ErdFieldRow, ErdNodeData } from "@/lib/erd/graph";
import { formatWalkValue } from "@/lib/erd/recordWalk";
import { serializeDraftValue } from "@/lib/erd/recordWalk";
import { fieldFlags, fieldTypeDetail } from "@/lib/erd/fieldDetail";
import { FieldInput } from "./RecordPopover";
import { ERD_MAX_ROWS, ERD_HEADER_H, ERD_FOOTER_H, parentExitHandleId, childEntryHandleId, loopOutHandleId, loopInHandleId, OBJECT_KIND_LABEL } from "@/lib/erd/graph";

function KeyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className="shrink-0 text-bronze-600">
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9m-4 4 3 3" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className="shrink-0 text-bronze-500">
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning?: boolean }) {
  if (spinning) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3" />
      <path d="M18 4v4h-4M6 20v-4h4" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true" className="text-green-600">
      <path d="m4 12.5 5 5L20 6.5" />
    </svg>
  );
}

function PeekIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** Connection docks: invisible + inert in Explore, bronze grips in Author mode. */
function dockStyle(author: boolean | undefined, base: CSSProperties): CSSProperties {
  if (!author) return { ...base, opacity: 0, width: 2, height: 2, pointerEvents: "none" };
  return {
    ...base,
    opacity: 1,
    width: 12,
    height: 12,
    pointerEvents: "auto",
    background: "#9A7653",
    border: "2px solid #FAF8F2",
    borderRadius: 9999,
  };
}

function ErdTableNodeInner({ data, selected }: NodeProps<Node<ErdNodeData>>) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [tableCopied, setTableCopied] = useState(false);
  const [dataCopied, setDataCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [sortAZ, setSortAZ] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [peek, setPeek] = useState<{
    field: string; x: number; y: number;
    editId: string | null;
    editMeta: { name: string; label: string; type: string; updateable: boolean; picklistValues?: { label: string; value: string }[] } | null;
  } | null>(null);
  const [copiedValue, setCopiedValue] = useState(false);
  const [peekEditing, setPeekEditing] = useState(false);
  const [peekDraft, setPeekDraft] = useState<string | boolean | undefined>(undefined);
  const [peekSaving, setPeekSaving] = useState(false);
  const [peekSaveError, setPeekSaveError] = useState<string | null>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  // Hover datatype tooltip (label · type · flags · description). Delayed so
  // scanning rows stays quiet; portal because the node clips overflow.
  const [tip, setTip] = useState<{ label: string; api: string; detail: string; flags: string[]; desc: string | null; x: number; y: number } | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideTip = () => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = null;
    setTip(null);
  };
  const armTip = (r: ErdFieldRow, anchor: HTMLElement) => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = setTimeout(() => {
      const rect = anchor.getBoundingClientRect();
      setTip({ label: r.label, api: r.name, detail: fieldTypeDetail(r), flags: fieldFlags(r), desc: r.description, x: rect.right + 8, y: rect.top });
    }, 400);
  };
  // One peek panel for BOTH field kinds: reference jumps land here when they
  // carry a resolved label + Id; plain fields open it directly. Header (with
  // close), body (value), footer (context) - same chrome everywhere.
  const openPeek = (field: string, value: string, context: string, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const edit = data.getPeekEdit?.(field) ?? null;
    hideTip();
    setPeek({ field, x: rect.right + 8, y: rect.top, editId: edit?.id ?? null, editMeta: edit && edit.meta.updateable ? edit.meta : null });
    setPeekValue(value);
    setPeekContext(context);
    setCopiedValue(false);
    setPeekEditing(false);
    setPeekDraft(undefined);
    setPeekSaveError(null);
  };
  const [peekValue, setPeekValue] = useState("");
  const [peekContext, setPeekContext] = useState("");

  // Peek-at events from panel-level resolvers (lookup jumps): same chrome,
  // opened by the row that asked. Detail: { nodeApi, field, value, context,
  // x, y } - ignored when it names another node.
  useEffect(() => {
    const onPeekAt = (e: Event) => {
      const d = (e as CustomEvent).detail as
        | { nodeApi?: string; field?: string; value?: string; context?: string; x?: number; y?: number }
        | undefined;
      if (!d || typeof d.field !== "string") return;
      if (typeof d.nodeApi === "string" && d.nodeApi !== data.apiName) return;
      setPeek({ field: d.field, x: typeof d.x === "number" ? d.x : window.innerWidth / 2 - 120, y: typeof d.y === "number" ? d.y : 120, editId: null, editMeta: null });
      setPeekValue(typeof d.value === "string" ? d.value : "");
      setPeekContext(typeof d.context === "string" ? d.context : "");
      setCopiedValue(false);
      setPeekEditing(false);
      setPeekDraft(undefined);
      setPeekSaveError(null);
    };
    window.addEventListener("erd-peek-at", onPeekAt);
    return () => window.removeEventListener("erd-peek-at", onPeekAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.apiName]);

  // Peek panel dismiss: outside pointer + Escape.
  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPeek(null);
        hideTip();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (peekRef.current && !peekRef.current.contains(e.target as globalThis.Node)) setPeek(null);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peek]);

  // Hover tooltip is position-pinned: any scroll, zoom-wheel or canvas
  // pointerdown retires it (hover again to reshow).
  useEffect(() => {
    if (!tip) return;
    const hide = () => hideTip();
    window.addEventListener("wheel", hide, true);
    document.addEventListener("pointerdown", hide, true);
    return () => {
      window.removeEventListener("wheel", hide, true);
      document.removeEventListener("pointerdown", hide, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tip]);

  // Pending hover timer never fires after unmount.
  useEffect(
    () => () => {
      if (tipTimer.current) clearTimeout(tipTimer.current);
    },
    []
  );

  const liveValues = data.recordValues ?? null;
  const peekLabel = (field: string): string => {
    const raw = liveValues?.[field];
    if (raw !== undefined) return formatWalkValue(raw);
    // Not in the loaded row: the jump panel shows the honest state
    // (raw Id, error, or resolving) - same chrome, never silent.
    return "Not in the loaded row - click the field name to fetch its target.";
  };
  const rowIcons = (r: { name: string }) => (
    <>
      <span
        role="button"
        tabIndex={0}
        title={`Copy ${r.name}`}
        aria-label={`Copy API name ${r.name}`}
        onClick={(e) => copyField(e, r.name)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") copyField(e, r.name);
        }}
        className="shrink-0 rounded p-0.5 text-ivory-400 hover:text-bronze-600 hover:bg-ivory-200 transition-colors cursor-pointer"
      >
        {copiedField === r.name ? <CheckIcon /> : <CopyIcon />}
      </span>
      {liveValues && (
        <span
          role="button"
          tabIndex={0}
          title={r.name in liveValues ? `Show ${r.name} value for this record` : `${r.name} is not in the loaded row`}
          aria-label={`Show ${r.name} value`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            openPeek(r.name, peekLabel(r.name), data.recordId ? `${data.apiName} Id · ${data.recordId}` : data.apiName, e.currentTarget as HTMLElement);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              openPeek(r.name, peekLabel(r.name), data.recordId ? `${data.apiName} Id · ${data.recordId}` : data.apiName, e.currentTarget as HTMLElement);
            }
          }}
          className="shrink-0 rounded p-0.5 text-ivory-400 hover:text-bronze-600 hover:bg-ivory-200 transition-colors cursor-pointer"
        >
          <PeekIcon />
        </span>
      )}
    </>
  );

  const q = query.trim().toLowerCase();
  const searched = q
    ? data.rows.filter(
        (r) => r.name.toLowerCase().includes(q) || r.type.toLowerCase().includes(q)
      )
    : null;
  const MATCH_CAP = 100;
  const capped = searched && searched.length > MATCH_CAP;
  let visibleRows = searched
    ? searched.slice(0, MATCH_CAP)
    : expanded
      ? data.rows
      : data.rows.slice(0, ERD_MAX_ROWS);
  if (sortAZ) {
    visibleRows = [...visibleRows].sort((a, b) => a.name.localeCompare(b.name));
  }
  const collapsedHidden = !q && !expanded ? data.rows.length - visibleRows.length : 0;

  const copyField = (e: React.SyntheticEvent, name: string) => {
    e.stopPropagation();
    e.preventDefault();
    void (async () => {
      try {
        await navigator.clipboard.writeText(name);
        setCopiedField(name);
        window.setTimeout(() => setCopiedField((cur) => (cur === name ? null : cur)), 1200);
      } catch {
        /* clipboard unavailable */
      }
    })();
  };

  const copyApiName = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(data.apiName);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div
      style={data.tags.length > 0 ? { borderColor: data.tags[0].color, borderWidth: 3 } : undefined}
      className={`group relative w-[300px] rounded-xl border-2 bg-[var(--color-surface)] shadow-[0_8px_28px_-10px_rgba(24,20,12,0.35)] overflow-hidden transition-all ${
        data.linked || data.linkFocus
          ? "border-[#722F37] shadow-[0_0_0_3px_rgba(114,47,55,0.38),0_8px_28px_-10px_rgba(24,20,12,0.35)]"
          : data.spotlight
            ? "border-bronze-500 shadow-[0_0_0_4px_rgba(154,118,83,0.35),0_8px_28px_-10px_rgba(24,20,12,0.35)]"
            : selected
            ? "border-bronze-500"
            : data.isRoot
              ? "border-ivory-950"
              : "border-[var(--color-line)]"
      } ${(data.linked || data.linkFocus) ? "erd-link-glow" : ""} ${data.dimmed ? "opacity-40" : ""}`}
    >
      {!data.isRoot && data.onRemoveClick && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            data.onRemoveClick?.(data.apiName);
          }}
          title={`Remove ${data.apiName} from the canvas (X)`}
          aria-label={`Remove ${data.apiName} from the canvas`}
          className="nodrag absolute right-1.5 top-1.5 z-10 cursor-pointer rounded-full border border-[var(--color-line)] bg-white p-1 text-ivory-500 opacity-0 shadow-sm transition-all hover:border-red-300 hover:text-red-600 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
      {/* Side-edge docks: exits at header height, entries at footer height */}
      <Handle type="source" id={parentExitHandleId} position={Position.Right} style={dockStyle(data.authorMode, { top: ERD_HEADER_H / 2 })} />
      <Handle type="target" id={childEntryHandleId} position={Position.Left} style={dockStyle(data.authorMode, { top: `calc(100% - ${ERD_FOOTER_H / 2}px)` })} />
      <Handle type="source" id={loopOutHandleId} position={Position.Left} style={dockStyle(data.authorMode, { top: ERD_HEADER_H / 2 })} />
      <Handle type="target" id={loopInHandleId} position={Position.Left} style={dockStyle(data.authorMode, { top: `calc(100% - ${ERD_FOOTER_H / 2}px)` })} />
      {/* Header: label owns the full top row (centered), badges + actions
          sit on their own second row so long labels never trim under them */}
      <div className={`flex flex-col justify-center gap-0.5 px-3 border-b ${data.isRoot ? "bg-ivory-950 text-ivory-100" : "bg-[var(--color-surface-soft)]"}`} style={{ height: ERD_HEADER_H }}>
        <p className={`text-center text-[13px] font-bold leading-tight break-all line-clamp-2 ${data.isRoot ? "text-ivory-100" : "text-ivory-950"}`} title={data.label}>
          {data.label}
        </p>
        <div className="flex items-center justify-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onNoteClick?.(data.apiName);
            }}
            title={data.hasNote ? "Open design note for this object" : "Attach a design note / TODO to this object"}
            aria-label={data.hasNote ? `Open design note for ${data.apiName}` : `Attach a design note to ${data.apiName}`}
            className={`nodrag relative shrink-0 rounded p-1 transition-colors cursor-pointer ${data.isRoot ? "text-ivory-300 hover:text-white hover:bg-ivory-800" : "text-ivory-950 hover:text-bronze-600 hover:bg-ivory-200"}`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
              <path d="m13.5 6.5 3 3" />
            </svg>
            {data.hasNote && (
              <span className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${data.hasTodo ? "bg-red-500" : "bg-bronze-500"}`} aria-hidden="true" />
            )}
          </button>
            {data.onAutomationClick && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  data.onAutomationClick?.(data.apiName);
                }}
                title="Automation on this object - triggers, flows, queues, validation, approvals"
                aria-label={`Show automation on ${data.apiName}`}
                className={`nodrag relative shrink-0 rounded p-1 transition-colors cursor-pointer ${data.isRoot ? "text-ivory-300 hover:text-white hover:bg-ivory-800" : "text-ivory-950 hover:text-bronze-600 hover:bg-ivory-200"}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z" strokeLinejoin="round" />
                </svg>
                {typeof data.automationTotal === "number" && (
                  <span className="absolute -top-1.5 -right-1.5 rounded-full bg-ivory-950 px-1 text-[8px] font-bold leading-tight text-ivory-100" aria-hidden="true">
                    {data.automationTotal}
                  </span>
                )}
              </button>
            )}
          {data.authorPending && (
            <span className="shrink-0 rounded border border-amber-300 bg-amber-100 px-1 py-px text-[9px] font-bold text-amber-800" title="Deploying to the org - not live yet">
              DEPLOYING
            </span>
          )}
          {data.authorMode && data.onAddField && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                data.onAddField?.(data.apiName);
              }}
              title={`New custom field on ${data.apiName}`}
              aria-label={`New custom field on ${data.apiName}`}
              className="nodrag shrink-0 rounded border border-bronze-300 bg-bronze-100 px-1.5 py-px text-[10px] font-bold text-bronze-700 hover:bg-bronze-200 transition-colors cursor-pointer"
            >
              + Field
            </button>
          )}
          {!data.isRoot && data.onMakeRoot && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                data.onMakeRoot?.(data.apiName);
              }}
              title={`Make ${data.apiName} the canvas root (Graph + ERD follow)`}
              aria-label={`Make ${data.apiName} the canvas root`}
              className="nodrag shrink-0 rounded p-1 transition-colors cursor-pointer text-ivory-950 hover:text-bronze-600 hover:bg-ivory-200"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <circle cx="12" cy="12" r="8.5" />
                <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={copyApiName}
            title={`Copy API name (${data.apiName})`}
            aria-label={`Copy API name ${data.apiName}`}
            className={`nodrag shrink-0 rounded p-1 transition-colors cursor-pointer ${data.isRoot ? "text-ivory-300 hover:text-white hover:bg-ivory-800" : "text-ivory-950 hover:text-bronze-600 hover:bg-ivory-200"}`}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
          {data.onPullCustomParents && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                data.onPullCustomParents?.(data.apiName);
              }}
              title={`Choose parents of ${data.apiName} to pull - ${data.customParentCount ?? 0} custom · ${data.standardParentCount ?? 0} standard`}
              aria-label={`Pull parents of ${data.apiName}`}
              className={`nodrag shrink-0 rounded p-1 transition-colors cursor-pointer ${data.isRoot ? "text-ivory-300 hover:text-white hover:bg-ivory-800" : "text-ivory-950 hover:text-bronze-600 hover:bg-ivory-200"}`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M12 15V4m0 0 4 4m-4-4L8 8" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
            </button>
          )}
          {data.onPullCustomChildren && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                data.onPullCustomChildren?.(data.apiName);
              }}
              title={`Choose children of ${data.apiName} to pull - ${data.customChildCount ?? 0} custom · ${data.standardChildCount ?? 0} standard`}
              aria-label={`Pull children of ${data.apiName}`}
              className={`nodrag shrink-0 rounded p-1 transition-colors cursor-pointer ${data.isRoot ? "text-ivory-300 hover:text-white hover:bg-ivory-800" : "text-ivory-950 hover:text-bronze-600 hover:bg-ivory-200"}`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M12 4v11m0 0 4-4m-4 4-4-4" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
            </button>
          )}
          {data.onCopyFieldTable && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void (async () => {
                  const ok = await data.onCopyFieldTable?.(data.apiName);
                  if (ok) {
                    setTableCopied(true);
                    window.setTimeout(() => setTableCopied(false), 1500);
                  }
                })();
              }}
              title={tableCopied ? "Table copied - paste into Teams" : `Copy all ${data.totalFields} fields as a table - label, API name, type, description, required`}
              aria-label={tableCopied ? "Field table copied" : `Copy all fields of ${data.apiName} as a table`}
              className={`nodrag shrink-0 rounded p-1 transition-colors cursor-pointer ${data.isRoot ? "text-ivory-300 hover:text-white hover:bg-ivory-800" : "text-ivory-950 hover:text-bronze-600 hover:bg-ivory-200"}`}
            >
              {tableCopied ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                  <path d="m4 12.5 5 5L20 6.5" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M3 10h18M9 10v10M15 10v10" />
                </svg>
              )}
            </button>
          )}
          {data.onCopyFieldDataTable && data.recordState === "live" && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void (async () => {
                  const ok = await data.onCopyFieldDataTable?.(data.apiName);
                  if (ok) {
                    setDataCopied(true);
                    window.setTimeout(() => setDataCopied(false), 1500);
                  }
                })();
              }}
              title={dataCopied ? "Record table copied - paste into Teams" : `Copy all ${data.totalFields} fields + live record values as a Label | API Name | Value table`}
              aria-label={dataCopied ? "Field data table copied" : `Copy all fields of ${data.apiName} with record values as a table`}
              className={`nodrag shrink-0 rounded p-1 transition-colors cursor-pointer ${data.isRoot ? "text-ivory-300 hover:text-white hover:bg-ivory-800" : "text-ivory-950 hover:text-bronze-600 hover:bg-ivory-200"}`}
            >
              {dataCopied ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                  <path d="m4 12.5 5 5L20 6.5" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <ellipse cx="12" cy="5" rx="8" ry="3" />
                  <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
                  <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
                </svg>
              )}
            </button>
          )}
          {data.onRecordClick && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                data.onRecordClick?.(data.apiName, {
                  x: rect.right + 8,
                  y: rect.top,
                  width: rect.width,
                  height: rect.height,
                });
              }}
              title={
                data.recordState === "live"
                  ? `Record aboard for ${data.apiName} - click to inspect and edit`
                  : data.recordState === "locked"
                    ? (data.recordHint ?? "Load a connected record first")
                    : `Pull ${data.apiName} silently - the entity box carries it`
              }
              aria-label={
                data.recordState === "live"
                  ? `Inspect live record data for ${data.apiName}`
                  : `Pull live record data for ${data.apiName}`
              }
              className={`nodrag relative shrink-0 rounded p-1 transition-colors cursor-pointer ${
                data.recordState === "locked" ? "opacity-40" : ""
              } ${
                data.isRoot ? "text-ivory-300 hover:text-white hover:bg-ivory-800" : "text-ivory-950 hover:text-bronze-600 hover:bg-ivory-200"
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              {data.recordState === "live" && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-bronze-500" aria-hidden="true" />
              )}
            </button>
          )}
          {data.onRefreshNode && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                data.onRefreshNode?.(data.apiName);
              }}
              title={data.refreshing ? "Refreshing metadata…" : `Refresh ${data.apiName} metadata`}
              aria-label={data.refreshing ? `Refreshing ${data.apiName}` : `Refresh ${data.apiName} metadata`}
              className={`nodrag shrink-0 rounded p-1 transition-colors cursor-pointer ${
                data.refreshing
                  ? "text-bronze-600"
                  : data.isRoot
                    ? "text-white/85 hover:text-white hover:bg-ivory-800"
                    : "text-ivory-700 hover:text-ivory-950 hover:bg-ivory-200"
              }`}
            >
              <RefreshIcon spinning={data.refreshing} />
            </button>
          )}
        </div>
        <p className={`truncate text-center font-mono text-[10px] ${data.isRoot ? "text-ivory-300" : "text-ivory-600"}`}>
          {data.apiName} · {data.totalFields} fields · {data.totalChildren} children
        </p>
      </div>
      {/* Rows - scrollable in-node, expandable to all fields.
          Search results scroll inside a fixed box so the node never outgrows
          its dagre-planned footprint. */}
      <div
        className="nodrag nowheel overflow-y-auto py-1"
        style={q || expanded ? { maxHeight: 300 } : undefined}
      >
        {visibleRows.map((r) => {
          const pickable = r.pickValues.length > 0 && data.onPicklistClick;
          const shortType = r.type === "reference" ? "ref" : r.type;
          const inner = (
              <>
              {(r.isId || r.isName) && <KeyIcon />}
              {!(r.isId || r.isName) && r.refs.length > 0 && <LinkIcon />}
              {!(r.isId || r.isName) && r.refs.length === 0 && <span className="w-[11px] shrink-0" aria-hidden="true" />}
              {r.refs.length > 0 ? (
                <button
                  type="button"
                  data-lookup-jump
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    data.onLookupClick?.(data.apiName, r.name, {
                      x: rect.right + 8,
                      y: rect.top,
                      width: rect.width,
                      height: rect.height,
                    });
                  }}
                  title={`Fetch ${r.refs.join(" / ")} target${r.refs.length === 1 ? "" : "s"} for this record`}
                  aria-label={`Fetch ${r.name} target record`}
                  className={`min-w-0 flex-1 cursor-pointer truncate rounded border border-transparent px-1 py-px text-left font-mono text-[11px] font-bold underline decoration-dotted underline-offset-2 transition-colors ${
                    data.recordValues
                      ? "border-bronze-300 bg-bronze-100 text-bronze-800 hover:bg-bronze-200"
                      : "border-[var(--color-line-soft)] bg-[var(--color-canvas)] text-bronze-700 hover:border-bronze-400 hover:text-bronze-800"
                  }`}
                >
                  {r.name}
                  {r.required && <span className="text-red-600"> *</span>}
                </button>
              ) : (
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ivory-950" title={r.name}>
                  {r.name}
                  {r.required && <span className="text-red-600"> *</span>}
                </span>
              )}
              {(data.refLabels?.[r.name] ?? (r.refLabel != null && r.refLabel !== "" ? r.refLabel : null)) && (
                <span
                  className="min-w-0 max-w-[110px] truncate text-[10px] text-bronze-700"
                  title={`Target: ${data.refLabels?.[r.name] ?? r.refLabel}`}
                >
                  → {data.refLabels?.[r.name] ?? r.refLabel}
                </span>
              )}
              {pickable ? (
                <span
                  className="shrink-0 rounded-full border border-bronze-300 bg-bronze-100 px-1.5 py-px text-[9px] font-bold text-bronze-700"
                  title={`${r.pickValues.length} picklist values - click the row to view`}
                >
                  {r.pickValues.length}
                </span>
              ) : (
                <span className="shrink-0 text-[10px] text-ivory-500" title={r.type}>{shortType}</span>
              )}
              {r.pending && (
                <span className="shrink-0 rounded border border-amber-300 bg-amber-100 px-1 py-px font-mono text-[9px] font-bold text-amber-800" title="Deploying to the org - not live yet">
                  new
                </span>
              )}
              {rowIcons(r)}
            </>
          );
          return pickable ? (
            <button
              key={r.name}
              type="button"
              onClick={(e) => {
                // Icon clicks + lookup-label jumps own their handlers;
                // the row itself opens picklist values.
                const t = e.target as HTMLElement;
                if (t.closest('[role="button"]') || t.closest('[data-lookup-jump]')) return;
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                data.onPicklistClick?.(data.apiName, r.name, {
                  x: rect.right + 8,
                  y: rect.top,
                  width: rect.width,
                  height: rect.height,
                });
              }}
              onMouseEnter={(e) => armTip(r, e.currentTarget)}
              onMouseLeave={hideTip}
              onFocus={(e) => armTip(r, e.currentTarget)}
              onBlur={hideTip}
              title={`${r.name} - click to view ${r.pickValues.length} picklist values`}
              className={`nodrag group flex w-full cursor-pointer items-center gap-1.5 px-3 py-[3px] text-left transition-colors ${r.pending ? "bg-amber-50" : "hover:bg-bronze-100"}`}
            >
              {inner}
            </button>
          ) : (
            <div
              key={r.name}
              onMouseEnter={(e) => armTip(r, e.currentTarget)}
              onMouseLeave={hideTip}
              className={`group flex items-center gap-1.5 px-3 py-[3px] ${r.pending ? "bg-amber-50" : "hover:bg-ivory-200"}`}
            >
              {inner}
            </div>
          );
        })}
        {(!expanded && collapsedHidden > 0) || expanded ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="nodrag block w-full px-3 py-1 text-left text-[10px] font-semibold text-bronze-600 hover:text-bronze-700 hover:bg-ivory-200 cursor-pointer"
          >
            {expanded ? "Show less" : `+${collapsedHidden} more fields`}
          </button>
        ) : null}
      </div>
      {/* Footer - field search + sort on top, meta landing zone below */}
      <div
        className="nodrag nowheel border-t border-[var(--color-line-soft)] bg-[var(--color-surface-soft)] px-2.5 py-1.5 space-y-1"
        style={{ height: ERD_FOOTER_H }}
      >
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true" className="absolute left-1.5 top-1/2 -translate-y-1/2 text-ivory-500">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter fields…"
              aria-label={`Filter ${data.apiName} fields`}
              spellCheck={false}
              autoComplete="off"
              className="h-6 w-full rounded-md border border-ivory-300 bg-white pl-6 pr-5 font-mono text-[10px] text-ivory-950 placeholder-ivory-500 focus:border-bronze-500 focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear field filter"
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-ivory-500 hover:text-ivory-950 cursor-pointer"
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSortAZ((v) => !v)}
            aria-pressed={sortAZ}
            title={sortAZ ? "Reset to default field order" : "Sort fields A-Z"}
            aria-label={sortAZ ? "Reset to default field order" : "Sort fields A-Z"}
            className={`h-6 w-7 shrink-0 rounded-md border font-mono text-[10px] font-bold transition-colors cursor-pointer ${
              sortAZ
                ? "bg-bronze-600 border-bronze-600 text-white"
                : "border-ivory-300 bg-white text-ivory-600 hover:text-ivory-950 hover:border-ivory-500"
            }`}
          >
            A-Z
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onTagsClick?.(data.apiName);
            }}
            title={data.tags.length > 0 ? `Tags: ${data.tags.map((t) => t.name).join(", ")} - click to edit (T)` : "Tag this object (T)"}
            aria-label={`Edit tags for ${data.apiName}`}
            className="nodrag flex h-6 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-ivory-300 bg-white text-ivory-600 transition-colors hover:text-ivory-950 hover:border-ivory-500"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
              <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>
        <div className="relative flex items-center justify-between gap-2">
          <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
            <span
              title={`${data.apiName} · ${OBJECT_KIND_LABEL[data.objectKind]}`}
              className="shrink-0 text-[10px] font-bold text-ivory-700"
            >
              {OBJECT_KIND_LABEL[data.objectKind]}
            </span>
            {data.isJunction && (
              <span
                title="Junction object - joins two or more parents (two required lookups, or a master-detail leg plus another lookup)"
                className="shrink-0 rounded border border-bronze-300 bg-bronze-100 px-1 py-px text-[9px] font-bold text-bronze-700"
              >
                JUNCTION
              </span>
            )}
            {data.recordId && (
              <span className="min-w-0 truncate font-mono text-[10px] text-ivory-600" title={`Visualizing ${data.recordId}`}>
                {data.recordId.slice(0, 8)}…
              </span>
            )}
          </span>
          {data.tags.length > 0 && (
            <span className="pointer-events-none absolute left-1/2 top-1/2 flex max-w-[70%] -translate-x-1/2 -translate-y-1/2 items-center justify-center gap-1">
              {data.tags.slice(0, 2).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    data.onTagsClick?.(data.apiName);
                  }}
                  title={`Tag: ${t.name} - click to edit tags (T)`}
                  className="nodrag pointer-events-auto flex max-w-[76px] shrink-0 cursor-pointer items-center gap-1 truncate rounded-full border px-1.5 py-px text-[9px] font-bold"
                  style={{ borderColor: t.color, color: t.color, backgroundColor: `${t.color}14` }}
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className="shrink-0">
                    <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
                    <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
                  </svg>
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
              {data.tags.length > 2 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    data.onTagsClick?.(data.apiName);
                  }}
                  title={`${data.tags.length - 2} more tags - click to edit (T)`}
                  className="nodrag pointer-events-auto shrink-0 cursor-pointer rounded-full bg-ivory-200 px-1.5 py-px text-[9px] font-bold text-ivory-700"
                >
                  +{data.tags.length - 2}
                </button>
              )}
            </span>
          )}
          {q ? (
            <span className="shrink-0 text-[10px] font-medium text-ivory-600">
              {`${searched!.length} match${searched!.length === 1 ? "" : "es"}${capped ? " (top 100)" : ""}`}
            </span>
          ) : (data.recordTypes?.length ?? 0) > 0 ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const r = e.currentTarget.getBoundingClientRect();
                data.onRecordTypesClick?.(data.apiName, { x: r.right + 8, y: r.top, width: r.width, height: r.height });
              }}
              title={`${data.recordTypes.length} record types - click to view ids`}
              aria-label={`${data.recordTypes.length} record types on ${data.apiName}`}
              className="nodrag shrink-0 cursor-pointer bg-transparent p-0 text-[10px] font-semibold text-bronze-700 underline decoration-bronze-300 underline-offset-2 transition-colors hover:text-bronze-800 hover:decoration-bronze-600"
            >
              RT · {data.recordTypes.length}
            </button>
          ) : null}
        </div>
      </div>
      {peek && createPortal(
        <div
          ref={peekRef}
          role="dialog"
          aria-label={`${peek.field} value`}
          className="fixed z-[90] w-[240px] rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5 shadow-[0_16px_48px_-12px_rgba(24,20,12,0.4)]"
          style={{
            left: Math.min(Math.max(8, peek.x), Math.max(8, window.innerWidth - 248)),
            top: Math.min(Math.max(8, peek.y), Math.max(8, window.innerHeight - 160)),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-1.5">
            <p className="min-w-0 flex-1 truncate font-mono text-[10px] font-bold uppercase tracking-wider text-ivory-600" title={peek.field}>
              {peek.field}
            </p>
            {peek.editId && peek.editMeta && !peekEditing && (
              <button
                type="button"
                onClick={() => {
                  const raw = liveValues?.[peek.field];
                  setPeekDraft(typeof raw === "boolean" ? raw : String(raw ?? ""));
                  setPeekSaveError(null);
                  setPeekEditing(true);
                }}
                title={`Edit ${peek.field} on this record`}
                aria-label={`Edit ${peek.field}`}
                className="shrink-0 rounded p-0.5 text-ivory-400 hover:text-bronze-600 hover:bg-ivory-200 transition-colors cursor-pointer"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
                  <path d="m13.5 6.5 3 3" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(peekValue);
                    setCopiedValue(true);
                    window.setTimeout(() => setCopiedValue(false), 1200);
                  } catch {
                    /* clipboard unavailable */
                  }
                })();
              }}
              title={copiedValue ? "Copied" : `Copy ${peek.field} value`}
              aria-label={copiedValue ? "Copied" : `Copy ${peek.field} value`}
              className="shrink-0 rounded p-0.5 text-ivory-400 hover:text-bronze-600 hover:bg-ivory-200 transition-colors cursor-pointer"
            >
              {copiedValue ? <CheckIcon /> : <CopyIcon />}
            </button>
            <button
              type="button"
              onClick={() => setPeek(null)}
              title="Close value panel"
              aria-label="Close value panel"
              className="shrink-0 rounded p-0.5 text-ivory-400 hover:text-ivory-950 hover:bg-ivory-200 transition-colors cursor-pointer"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
          <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-ivory-950">
            {peekValue}
          </p>
          {peekEditing && peek.editId && peek.editMeta && (
            <div className="mt-1.5 space-y-1.5">
              <div className="w-[180px]">
                <FieldInput
                  meta={peek.editMeta}
                  value={peekDraft ?? ""}
                  onChange={(nv) => setPeekDraft(nv)}
                />
              </div>
              {peekSaveError && (
                <p className="rounded-md border border-red-300 bg-red-50 px-1.5 py-1 text-[10px] text-red-700" role="alert">
                  {peekSaveError}
                </p>
              )}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={peekSaving}
                  onClick={() => {
                    const editId = peek.editId;
                    const meta = peek.editMeta;
                    if (!editId || !meta || !data.onSavePeekField) return;
                    const raw = liveValues?.[peek.field];
                    const origStr = typeof raw === "boolean" ? raw : String(raw ?? "");
                    const v = peekDraft;
                    if (v === undefined || v === origStr || (v === "" && (raw === null || raw === undefined || raw === ""))) {
                      setPeek(null);
                      return;
                    }
                    const serialized = serializeDraftValue(meta.type, v);
                    if (serialized === undefined) {
                      setPeek(null);
                      return;
                    }
                    setPeekSaving(true);
                    setPeekSaveError(null);
                    void data
                      .onSavePeekField(data.apiName, editId, { [peek.field]: serialized })
                      .then(() => setPeek(null))
                      .catch((err: unknown) => {
                        setPeekSaveError(err instanceof Error ? err.message : "Save failed.");
                        setPeekSaving(false);
                      });
                  }}
                  className="flex-1 rounded-md bg-ivory-950 px-2 py-1 text-[11px] font-semibold text-ivory-100 hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                >
                  {peekSaving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  disabled={peekSaving}
                  onClick={() => {
                    setPeekEditing(false);
                    setPeekDraft(undefined);
                    setPeekSaveError(null);
                  }}
                  className="rounded-md px-2 py-1 text-[11px] font-semibold text-ivory-600 hover:text-ivory-950 hover:bg-ivory-200 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <p className="mt-1 truncate font-mono text-[10px] text-ivory-500" title={peekContext}>
            {peekContext}
          </p>
        </div>,
        document.body
      )}
      {tip && createPortal(
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[95] w-[250px] rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5 shadow-[0_16px_48px_-12px_rgba(24,20,12,0.4)]"
          style={{
            left: Math.min(Math.max(8, tip.x), Math.max(8, window.innerWidth - 258)),
            top: Math.min(Math.max(8, tip.y), Math.max(8, window.innerHeight - 180)),
          }}
        >
          <p className="truncate text-[11px] font-bold text-ivory-950" title={tip.label}>
            {tip.label}
          </p>
          <p className="truncate font-mono text-[10px] text-ivory-500" title={tip.api}>
            {tip.api}
          </p>
          <p className="mt-1 font-mono text-[11px] font-bold text-bronze-700">
            {tip.detail}
          </p>
          {tip.flags.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1">
              {tip.flags.map((f) => (
                <span key={f} className="rounded-full border border-bronze-300 bg-bronze-100 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-bronze-700">
                  {f}
                </span>
              ))}
            </p>
          )}
          {tip.desc && (
            <p className="mt-1 line-clamp-4 text-[10px] italic leading-relaxed text-ivory-600" title={tip.desc}>
              {tip.desc}
            </p>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

export const ErdTableNode = memo(ErdTableNodeInner);
