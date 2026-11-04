"use client";

import { useState, useMemo, useCallback, useRef, useEffect, memo } from "react";
import type { Node, Edge } from "@xyflow/react";
import type {
  SalesforceObject,
  SalesforceDescribeResult,
} from "@/lib/salesforce/types";
import { buildErdElements, buildGraphElements, rootNeighbors, systemReason, isEffectivelyHidden, isSystemObject, AUDIT_REFERENCE_FIELDS, parentExitHandleId, childEntryHandleId, customParentTargets, customChildTargets, customParentLinks, customChildLinks, standardParentTargets, standardChildTargets, standardParentLinks, standardChildLinks, type ErdNodeData, type ErdFieldRow, type ErdEdgeData, type GraphNeighbor } from "@/lib/erd/graph";
import { rankObjects } from "@/lib/search/rank";
import { getPreferences } from "@/lib/setup/preferences";
import { cleanTagName, createTag, nodeMatchesTagFilter, snapTagColor, type ErdTag } from "@/lib/erd/tags";
import { buildFieldCopyTable, buildFieldDataCopyTable, isMasterRecordType, parseAvailability, recordTypeListQuery, toolingQueryPath, uiApiAvailabilityPath, type RecordTypeSummary } from "@/lib/salesforce/picklistValues";
import { downloadFieldDictionary } from "@/lib/salesforce/fieldDictionary";
import { downloadPicklistMatrix, type MatrixField, type MatrixRt } from "@/lib/salesforce/picklistMatrix";
import { isSessionExpiredMessage } from "@/lib/salesforce/client";
import { apiFetch } from "@/lib/api";
import { ErdCanvas, type ErdCanvasHandle } from "./erd/ErdCanvas";
import { ConfirmRemoveDialog, TagCreator, TagManagerDialog, TagPickerDialog } from "./erd/TagDialogs";
import { AddPicklistValuesDialog } from "./erd/AddPicklistValuesDialog";
import { AuthorFieldDialog } from "./erd/AuthorFieldDialog";
import { AuthorObjectDialog } from "./erd/AuthorObjectDialog";
import { buildCustomFieldBody, buildCustomObjectBody, describeTypeFor, looksLikeSandbox, newAuthorId, parseToolingResult, syntheticDescribeForObject, toolingCreatePath, type AuthorChange, type DesignFieldType, type FieldDraft, type ObjectDraft } from "@/lib/salesforce/design";
import { logArchActivity, type ArchAction, type ArchActor } from "@/lib/erd-activity";
import { DiscoverPicker, type DiscoverCandidate } from "./erd/DiscoverPicker";
import { HidePanel } from "./erd/HidePanel";
import { PicklistPopover, type PicklistPopoverData } from "./erd/PicklistPopover";
import { RecordTypePopover, type RecordTypePopoverData } from "./erd/RecordTypePopover";
import { AutomationModal } from "./erd/AutomationModal";
import { EntityLogModal } from "./erd/EntityLogModal";
import {
  listSnapshotsByOrg,
  saveSnapshot as persistSnapshot,
  deleteSnapshot as deleteSnapshotFromDb,
  renameSnapshot as renameSnapshotInDb,
  snapshotNotesToNote,
  noteToSnapshotNotes,
  type ErdSnapshot,
} from "@/lib/erd/snapshotDb";
import { newItemId } from "@/lib/collection/types";
import { loadAutosave, queueAutosave, clearAutosave } from "@/lib/workspace/autosave";
import { renderMarkdownLite, toggleTaskLine } from "./erd/notesMd";
import { NoteEditor } from "./notes/NoteEditor";
import {
  appendNoteLine,
  commitNoteBody,
  emptyNoteBody,
  entryBodyVacant,
  noteBodyFromMd,
  noteBodyEmpty,
  type NoteBody,
  type NoteFormat,
} from "@/lib/notes/notebody";
import { RecordPopover, type RecordPopData, type RecordFieldMeta } from "./erd/RecordPopover";
import { RecordEditModal } from "./erd/RecordEditModal";
import { registerBridgeHandler, unregisterBridgeHandler } from "@/lib/bridge/registry";
import { buildErdBridgeHandlers, ERD_BRIDGE_KINDS, type ErdBridgeContext } from "@/lib/bridge/erd";
import type { LookupHit } from "./erd/LookupPickerModal";
import { parseLayouts, type ObjectLayout } from "@/lib/salesforce/layouts";
import {
  isValidRecordId,
  displayFieldNames,
  queryableFieldNames,
  chunkSelect,
  buildRootQuery,
  buildChildrenQuery,
  labelFromRow,
  queueLabelFromRow,
  targetApiForId,
  kindForId,
  keyFieldFor,
  buildLookupSearchQuery,
  buildLabelQuery,
  escapeSoqlString,
  resolveTarget,
  nodeRecordState,
  selectedRecordId,
  knownIdsFor,
  rowsForApi,
  resolveChildPlans,
  emptyLoadedState,
  childPageKey,
  RECORD_ROW_LIMIT,
  type LoadedState,
  type ResolveContext,
} from "@/lib/erd/recordWalk";
import { ShareDialog } from "./erd/ShareDialog";
import { validateShareStructure, type ShareStructure } from "@/lib/erd/shareLink";
import { validateSharePayload, shareFileName, ERD_SHARE_KIND, ERD_SHARE_VERSION, type ErdSharePayload } from "@/lib/erd/share";
import { ArchitectureInbox } from "./inbox/ArchitectureInbox";
import { normalizeLiveNotes, normalizeSnapshotNotes, resolveStale, countInbox } from "@/lib/inbox/normalize";
import { fingerprintEntity, fingerprintField, diffFieldFacts, diffEntityFacts, type EntityFacts, type FieldFacts } from "@/lib/inbox/schemaReview";
import type { AnchorFacts, ArchitectureInboxItem, CanvasTodo, InboxAnchor, InboxFingerprint, InboxHistoryEntry, InboxItemKind, InboxMeta } from "@/lib/inbox/types";
import { CANVAS_LOG_API, migrateEntityLogValue, noteToTodoBody, shareRowsToEntries, todoBodyToNote } from "@/lib/inbox/types";
import { EmptyState } from "./EmptyState";
import Button from "./ui/Button";
import Input from "./ui/Input";
import Badge from "./ui/Badge";
import { ConfirmDialog } from "./ui/ConfirmDialog";

/**
 * Cross-tab navigation request: some other tab's inbox asked to land here
 * and open something. The owning panel applies it, then consumes it.
 */
export interface SchemaNavRequest {
  tabId: string;
  /** Restore this snapshot first (owning-tab snapshot notes). */
  snapshotId?: string;
  /** Open the log modal on this entity bucket + entry. */
  api?: string;
  entryId?: string | null;
  /** Open the canvas log modal (whole-canvas TODOs). */
  openCanvasLog?: boolean;
}

interface SchemaPanelProps {
  objects: SalesforceObject[];
  instanceUrl: string;
  apiVersion: string;
  /** Autosave org key (null until the session resolves it) - canvas persists per org. */
  orgKey: string | null;
  /** Schema tab identity - each tab owns its slices, memory and restore. */
  tabId: string;
  tabName: string;
  /** Inbound collaboration share (?share=) - consumed once per id. */
  shareId: string | null;
  onShareConsumed: () => void;
  /** Cross-tab navigation: applied when nav.tabId is this tab, then consumed. */
  pendingNav: SchemaNavRequest | null;
  onNavConsumed: () => void;
  /** Ask the page to switch to another canvas tab, carrying a nav request. */
  onRequestTab: (targetTabId: string, nav: Omit<SchemaNavRequest, "tabId">, fromTabId: string) => void;
  getToken: () => string;
  onSessionExpired?: () => void;
}

const MAX_NODES = 60;
const MAX_NEW_PER_ACTION = 25;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = await Promise.all(items.slice(i, i + limit).map(fn));
    out.push(...chunk);
  }
  return out;
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Arch Activity mapping: an AuthorChange kind becomes an auditable action. */
function authorActivityAction(kind: string): ArchAction {
  if (kind === "object") return "create-object";
  if (kind === "relationship") return "create-relationship";
  return "create-field";
}

/**
 * Arch Activity target: field/relationship labels already carry the dotted
 * name ("Account.Tier__c (Picklist)"); objects log their api name.
 */
function authorActivityTarget(kind: string, label: string, targetApi: string): string {
  if (kind === "object") return targetApi;
  const dotted = label.split(" ")[0];
  return dotted || targetApi;
}

type GraphDetail =
  | {
      kind: "loaded";
      d: SalesforceDescribeResult;
      parents: string[];
      kids: string[];
    }
  | {
      kind: "lite";
      n: {
        apiName: string;
        label: string;
        custom: boolean;
        role: "parent" | "child";
        via: string;
        kind: "md" | "lookup";
      };
    };

/**
 * Design-mode object picker: search the FULL org catalog (not just family),
 * tick anything, Add to graph. Roles place bubbles; nothing touches ERD.
 */
/**
 * On-the-fly object pull: search the FULL org catalog (not just family),
 * tick 1-N objects, Add drops them into the graph off the root with true
 * roles where related. No ERD round-trip, no mode to enter.
 */
function AddObjectModal({
  objects,
  drawn,
  busy,
  onAdd,
  onClose,
}: {
  objects: { name: string; label: string }[];
  drawn: Set<string>;
  busy: boolean;
  onAdd: (names: string[]) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const query = q.trim().toLowerCase();
  const matches = query
    ? objects
        .filter((o) => o.name.toLowerCase().includes(query) || o.label.toLowerCase().includes(query))
        .slice(0, 50)
    : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fresh = [...picked].filter((n) => !drawn.has(n));

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Add objects to graph"
      onClick={onClose}
      style={{ paddingTop: "12vh" }}
    >
      <div className="modal-card max-w-md flex flex-col" style={{ maxHeight: "70vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-5 pb-3 border-b border-[var(--color-line-soft)] shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
            Add to graph · on the fly
          </p>
          <h2 className="mt-1 text-lg font-bold text-ivory-950">Pull any sObject</h2>
          <div className="mt-3">
            <Input
              placeholder="Search name or label…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search objects"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {query === "" ? (
            <p className="py-6 text-center text-xs text-ivory-600">Type to search {objects.length} objects.</p>
          ) : matches.length === 0 ? (
            <p className="py-6 text-center text-xs text-ivory-600">No matches.</p>
          ) : (
            <ul className="space-y-px rounded-lg border border-[var(--color-line)] divide-y divide-[var(--color-line-soft)] overflow-hidden">
              {matches.map((o) => {
                const already = drawn.has(o.name);
                const checked = picked.has(o.name);
                return (
                  <label
                    key={o.name}
                    className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 hover:bg-ivory-300 ${checked ? "bg-ivory-200" : ""} ${already ? "opacity-60" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={already || checked}
                      disabled={already}
                      onChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (next.has(o.name)) next.delete(o.name);
                          else next.add(o.name);
                          return next;
                        })
                      }
                      className="h-4 w-4 shrink-0 rounded border-ivory-400 bg-white text-bronze-600 focus:ring-bronze-500 disabled:opacity-60"
                      aria-label={already ? `${o.label} (already on graph)` : `Add ${o.label}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-ivory-950">{o.label}</span>
                      <span className="block truncate font-mono text-[11px] text-ivory-600">{o.name}</span>
                    </span>
                    {already && (
                      <span className="shrink-0 rounded border border-bronze-300 bg-bronze-100 px-1 py-px text-[9px] font-semibold text-bronze-700">
                        On graph
                      </span>
                    )}
                  </label>
                );
              })}
            </ul>
          )}
        </div>
        <div className="px-6 py-3.5 border-t border-[var(--color-line-soft)] bg-[var(--color-canvas)] flex items-center gap-2 shrink-0">
          <p className="flex-1 font-mono text-[11px] text-ivory-600">
            {picked.size > 0 ? `${fresh.length} to add` : "Tick 1 or more"}
          </p>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={fresh.length === 0 || busy} onClick={() => { onAdd(fresh); onClose(); }}>
            Add{fresh.length > 0 ? ` (${fresh.length})` : ""}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DesignPicker({
  catalog,
  exclude,
  onAdd,
}: {
  catalog: { name: string; label: string }[];
  exclude: string;
  onAdd: (names: string[]) => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const query = q.trim().toLowerCase();
  const matches = query
    ? catalog
        .filter(
          (o) =>
            o.name !== exclude &&
            (o.name.toLowerCase().includes(query) || o.label.toLowerCase().includes(query))
        )
        .slice(0, 8)
    : [];
  return (
    <div className="rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-canvas)] p-2">
      <details>
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[1.6px] text-ivory-600">
          How design works
        </summary>
        <p className="mt-1 text-[11px] leading-relaxed text-ivory-700">
          Sketch topology only - nothing touches ERD until + ERD.
          Search below or Discover any bubble; roles place parents left, children right.
        </p>
      </details>
      <p className="mb-1 mt-2 text-[10px] font-semibold uppercase tracking-[1.6px] text-ivory-600">
        Add any object
      </p>
      <Input
        placeholder="Search all objects…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search all objects to add"
      />
      {matches.length > 0 && (
        <ul className="mt-1 max-h-40 space-y-px overflow-y-auto rounded-md border border-[var(--color-line-soft)] bg-white">
          {matches.map((o) => {
            const checked = picked.has(o.name);
            return (
              <label
                key={o.name}
                className={`flex cursor-pointer items-center gap-2 px-2 py-1 text-[11px] hover:bg-ivory-300 ${checked ? "bg-ivory-200" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(o.name)) next.delete(o.name);
                      else next.add(o.name);
                      return next;
                    })
                  }
                  className="h-3.5 w-3.5 shrink-0 rounded border-ivory-400 bg-white text-bronze-600 focus:ring-bronze-500"
                  aria-label={`Add ${o.label} to graph`}
                />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-ivory-950">{o.label}</span>{" "}
                  <span className="font-mono text-[10px] text-ivory-500">({o.name})</span>
                </span>
              </label>
            );
          })}
        </ul>
      )}
      {picked.size > 0 && (
        <Button
          size="sm"
          className="mt-1.5 w-full"
          onClick={() => {
            onAdd([...picked]);
            setPicked(new Set());
            setQ("");
          }}
        >
          Add {picked.size} to graph
        </Button>
      )}
    </div>
  );
}

function GraphDetailCardInner({  detail,
  labels,
  erdCount,
  family,
  familyBusy,
  dismissed,
  onClose,
  onOpenInErd,
  onMakeRoot,
  onLoad,
  onDismiss,
  onDiscoverFamily,
  onExpandFamily,
  onExpandToErd,
  onCollapseFamily,
  onVisibility,
  designMode,
  onAddToGraph,
  onNote,
  noteFlags,
  drawnHere,
  catalog,
}: {
  detail: GraphDetail;
  labels: Map<string, string>;
  /** Objects currently on the ERD canvas - the card always names the number. */
  erdCount: number;
  /** Family candidates for the selected node (null = not loaded yet). */
  family: (DiscoverCandidate & { parentCount: number; childCount: number })[] | null;
  familyBusy: boolean;
  /** True when this bubble is dismissed from the graph (still on ERD). */
  dismissed: boolean;
  onClose: () => void;
  onOpenInErd: () => void;
  onMakeRoot: () => void;
  onLoad: () => void;
  /** Quick remove / restore for THIS bubble - graph only, ERD untouched. */
  onDismiss: () => void;
  onDiscoverFamily: () => void;
  /** Grow one generation deeper under a family row - graph only. */
  onExpandFamily: (names: string[]) => void;
  /** Describe checked family names onto the ERD canvas. */
  onExpandToErd: (names: string[]) => void;
  onCollapseFamily: () => void;
  /** Live graph visibility toggle from a family checkbox. */
  onVisibility: (apiName: string, visible: boolean) => void;
  designMode: boolean;
  /** Design mode: add checked names to the graph sketch (roles place them). */
  onAddToGraph: (names: string[]) => void;
  /** Open the entity note / TODO editor for this bubble. */
  onNote: (apiName: string) => void;
  /** Note presence flags for this bubble (dot state on the button). */
  noteFlags: { hasNote: boolean; hasTodo: boolean } | null;
  /** ApiName -> drawn edge ids touching it, for the selected node. */
  drawnHere: Map<string, string[]>;
  /** Full org catalog for the design-mode object picker. */
  catalog: { name: string; label: string }[];
}) {
  const apiName = detail.kind === "loaded" ? detail.d.name : detail.n.apiName;
  const label = detail.kind === "loaded" ? detail.d.label : detail.n.label;
  const linkCount = detail.kind === "loaded" ? detail.parents.length + detail.kids.length : 0;
  const [familyFilter, setFamilyFilter] = useState("");
  const [familyChecked, setFamilyChecked] = useState<Set<string>>(new Set());
  // Truthful ticks: a row starts checked ONLY if its link is actually drawn
  // to this node. D&B in Account's panel starts unchecked until + draws the
  // Account→D&B edge - no phantom ticks, ever.
  useEffect(() => {
    if (family) {
      setFamilyChecked(new Set([...drawnHere.keys()].filter((api) => family.some((c) => c.apiName === api))));
    } else {
      setFamilyChecked(new Set());
    }
    setFamilyFilter("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiName, family]);
  const q = familyFilter.toLowerCase().trim();
  const visibleFamily = family && (q ? family.filter((c) => c.apiName.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)) : family);
  const [tab, setTab] = useState<"discover" | "edges">("discover");
  useEffect(() => {
    setTab("discover");
  }, [apiName]);
  const edgeCount = detail.kind === "loaded" ? detail.parents.length + detail.kids.length : 1;
  return (
    <div className="absolute right-3 top-3 bottom-3 z-30 w-[280px] overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[0_16px_48px_-12px_rgba(24,20,12,0.35)]">
      <div className="border-b border-[var(--color-line-soft)] p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[1.6px] text-[var(--color-accent-dark)]">
              {detail.kind === "loaded" ? "On canvas" : `Preview · ${detail.n.role}`}
            </p>
            <h3 className="mt-1 text-xl font-bold tracking-tight text-ivory-950">{label}</h3>
            <p className="truncate font-mono text-[11px] text-ivory-600">{apiName}</p>
            <p className="mt-1 font-mono text-[10px] text-ivory-500" title="Graph is a lens on the ERD canvas - both views share the same objects">
              graph lens · {erdCount} on ERD canvas
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="rounded-md p-1 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => onNote(apiName)}
              title={noteFlags?.hasNote ? "Open design note / TODO for this object" : "Attach a design note / TODO to this object"}
              className="relative rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-200 transition-colors cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
                <path d="m13.5 6.5 3 3" />
              </svg>
              {noteFlags?.hasNote && (
                <span className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ${noteFlags.hasTodo ? "bg-red-500" : "bg-bronze-500"}`} aria-hidden="true" />
              )}
            </button>
            {detail.kind === "loaded" ? (
              <>
                <Badge variant="default">{detail.d.fields.length} fields</Badge>
                <Badge variant="default">
                  {linkCount} links
                </Badge>
                {detail.d.custom && <Badge variant="info">Custom</Badge>}
              </>
            ) : (
              <>
                <Badge variant={detail.n.role === "parent" ? "default" : "info"}>{detail.n.role}</Badge>
                <Badge variant={detail.n.kind === "md" ? "custom" : "default"}>
                  {detail.n.kind === "md" ? "master-detail" : "lookup"}
                </Badge>
                <Badge variant="default">via {detail.n.via}</Badge>
              </>
            )}
          </div>
          {/* Tabs: Discover (search + family + actions) vs Edges (no scroll-hunt) */}
          <div className="mt-3 flex rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-0.5" role="tablist" aria-label="Detail sections">
            {(
              [
                ["discover", "Discover"],
                ["edges", `Edges (${edgeCount})`],
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
      </div>

      {tab === "discover" && detail.kind === "loaded" && (
        <div className="space-y-3 p-4">
          <div className="flex flex-col gap-1.5">
            <Button size="sm" variant="secondary" onClick={onOpenInErd}>
              Open in ERD
            </Button>
            <Button size="sm" variant="ghost" onClick={onMakeRoot}>
              Make graph root
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onDismiss}
              title={dismissed ? "Restore this bubble to the graph (ERD untouched)" : "Remove this bubble from the graph now - ERD canvas keeps it"}
            >
              {dismissed ? "Restore to graph" : "Remove from graph"}
            </Button>
          </div>
        </div>
      )}

      {tab === "edges" && detail.kind === "loaded" && (
        <div className="space-y-3 p-4">
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[1.6px] text-ivory-600">
              Connected edges ({detail.parents.length + detail.kids.length})
            </p>
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {detail.parents.map((p) => (
                <li key={`p:${p}`} className="truncate rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-2.5 py-1.5 font-mono text-[11px] text-ivory-800">
                  ↑ {labels.get(p) ?? p} <span className="text-ivory-500">({p})</span>
                </li>
              ))}
              {detail.kids.map((k) => (
                <li key={`c:${k}`} className="truncate rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-2.5 py-1.5 font-mono text-[11px] text-ivory-800">
                  ↓ {labels.get(k) ?? k} <span className="text-ivory-500">({k})</span>
                </li>
              ))}
              {detail.parents.length === 0 && detail.kids.length === 0 && (
                <li className="text-[11px] text-ivory-500">No described links yet.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {tab === "edges" && detail.kind === "lite" && (
        <div className="space-y-3 p-4">
          <p className="text-xs leading-relaxed text-ivory-700">
            Related to the root via <span className="font-mono font-semibold text-ivory-950">{detail.n.via}</span>. Fetch details for the full edge list.
          </p>
          <Button size="sm" onClick={onLoad} className="w-full">
            Fetch details
          </Button>
        </div>
      )}

      {/* Family discovery: deep expansion FROM the selected node. Works on
          root AND on any bubble - the graph grows like a family tree. */}
      {tab === "discover" && (
      <div className="space-y-2 border-t border-[var(--color-line-soft)] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[1.6px] text-ivory-600">
          Discover of {apiName}
        </p>
        {designMode && (
          <DesignPicker
            catalog={catalog}
            exclude={apiName}
            onAdd={(names) => onAddToGraph(names)}
          />
        )}
        {family === null ? (
          <Button size="sm" variant="secondary" onClick={onDiscoverFamily} disabled={familyBusy} loading={familyBusy} className="w-full">
            Discover children + parents
          </Button>
        ) : (
          <>
            <Input
              placeholder="Filter family…"
              value={familyFilter}
              onChange={(e) => setFamilyFilter(e.target.value)}
              aria-label="Filter family candidates"
            />
            <div className="max-h-56 space-y-px overflow-y-auto rounded-lg border border-[var(--color-line)] divide-y divide-[var(--color-line-soft)]">
              {(visibleFamily ?? []).map((c) => {
                const checked = familyChecked.has(c.apiName);
                return (
                  <label
                    key={`${c.group}:${c.apiName}`}
                    className={`flex cursor-pointer items-center gap-2 px-2.5 py-1.5 transition-colors hover:bg-ivory-300 ${
                      checked ? "bg-ivory-200" : ""
                    }`}
                    title={`${c.label} (${c.apiName}) - ${c.parentCount} parents, ${c.childCount} children ahead`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const next = !checked;
                        setFamilyChecked((prev) => {
                          const s = new Set(prev);
                          if (next) s.add(c.apiName);
                          else s.delete(c.apiName);
                          return s;
                        });
                        // Uncheck hides this node's drawn links live (bubbles
                        // survive); re-check restores them. Nothing deleted.
                        onVisibility(c.apiName, next);
                      }}
                      className="h-3.5 w-3.5 shrink-0 rounded border-ivory-400 bg-white text-bronze-600 focus:ring-bronze-500"
                      aria-label={`${checked ? "Deselect" : "Select"} ${c.label}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium text-ivory-950">{c.label}</span>
                      <span
                        className="block truncate font-mono text-[10px] text-ivory-600"
                        title={`${c.parentCount} parents, ${c.childCount} children ahead of ${c.apiName}`}
                      >
                        {c.group === "child" ? "↓" : "↑"} {c.apiName}
                        {(c.parentCount + c.childCount) > 0 && (
                          <span className="text-ivory-500"> · p:{c.parentCount} c:{c.childCount}</span>
                        )}
                      </span>
                    </span>
                    {c.onCanvas && (
                      <span className="shrink-0 rounded border border-bronze-300 bg-bronze-100 px-1 py-px text-[9px] font-semibold text-bronze-700">
                        On canvas
                      </span>
                    )}
                    {!c.onCanvas && (
                      <button
                        type="button"
                        onClick={() => onExpandFamily([c.apiName])}
                        title={`Grow one generation deeper under ${c.apiName} - graph only, ERD untouched`}
                        className="shrink-0 rounded-md border border-[var(--color-line)] px-1.5 py-0.5 font-mono text-[11px] font-bold text-bronze-600 hover:border-bronze-500 cursor-pointer"
                      >
                        +
                      </button>
                    )}
                  </label>
                );
              })}
              {(visibleFamily ?? []).length === 0 && (
                <p className="px-2.5 py-2 text-center text-[11px] text-ivory-500">No matches.</p>
              )}
            </div>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  // Expand all: check every visible row (links restore live).
                  const all = new Set((visibleFamily ?? []).map((c) => c.apiName));
                  setFamilyChecked(all);
                  for (const api of all) {
                    if (drawnHere.has(api)) onVisibility(api, true);
                  }
                }}
                title="Check every visible row (drawn links restore)"
              >
                Expand +
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  // Collapse all: uncheck everything; drawn links hide live,
                  // bubbles survive. Nothing is deleted.
                  for (const api of drawnHere.keys()) onVisibility(api, false);
                  setFamilyChecked(new Set());
                }}
                title="Uncheck every row (drawn links hide live, bubbles stay)"
              >
                Collapse −
              </Button>
            </div>
            <div className="flex gap-1.5">
              {designMode && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={familyChecked.size === 0}
                  onClick={() => {
                    const fresh = [...familyChecked];
                    setFamilyChecked(new Set());
                    onAddToGraph(fresh);
                  }}
                  title="Add checked to the graph sketch - parents left, children right"
                >
                  Add to graph
                </Button>
              )}
              <Button
                size="sm"
                className="flex-1"
                disabled={[...familyChecked].filter((n) => !(family ?? []).some((c) => c.apiName === n && c.onCanvas)).length === 0}
                onClick={() => {
                  const fresh = [...familyChecked].filter((n) => !(family ?? []).some((c) => c.apiName === n && c.onCanvas));
                  setFamilyChecked(new Set());
                  onExpandToErd(fresh);
                }}
                title="Describe checked rows onto the ERD canvas as solid tables"
              >
                Expand selected to ERD
              </Button>
              <Button size="sm" variant="ghost" onClick={onCollapseFamily} title="Prune this node's grown generations off the graph (ERD canvas untouched)">
                Prune
              </Button>
            </div>
            <p className="font-mono text-[10px] text-ivory-500">
              p:/c: = generations ahead. Expand grows graph bubbles only - ERD untouched until Add visible.
            </p>
          </>
        )}
      </div>
      )}

      {tab === "discover" && detail.kind === "lite" && (
        <div className="space-y-3 p-4">
          <p className="text-xs leading-relaxed text-ivory-700">
            Placed from relationship metadata - its fields are not fetched yet.
            Related to the root via <span className="font-mono font-semibold text-ivory-950">{detail.n.via}</span>.
          </p>
          <Button size="sm" onClick={onLoad} className="w-full">
            Fetch details
          </Button>
        </div>
      )}
    </div>
  );
}

// Canvas notes editor shared by the notes panel and the fullscreen zen
// overlay. `fill` stretches it to the overlay height instead of a fixed min.
function CanvasNotesField({
  note,
  onNote,
  onToggleTask,
  fill,
}: {
  note: NoteBody;
  onNote: (b: NoteBody) => void;
  onToggleTask: (lineIndex: number) => void;
  fill?: boolean;
}) {
  return (
    <NoteEditor
      draft={note}
      onDraft={onNote}
      label="Canvas notes"
      placeholder={"# Design log\n- [ ] Confirm junction on Quote_Line__c\n- 14:32 — Lead conversion mapping…"}
      textareaRows={14}
      fill={fill}
      renderPreview={(md) => renderMarkdownLite(md, onToggleTask)}
    />
  );
}

// Memo: family panel holds checkbox state - without this, every graph pan or
// canvas tick would remount the card and wipe checked rows mid-selection.
const GraphDetailCard = memo(GraphDetailCardInner);

// Entity-scoped note editor inside the notes panel: markdown-lite + TODO/Done
// + lifecycle (kind, status, owner, priority, anchor). Writes route through
// onMeta so legacy todo/done flags stay consistent.
export default function SchemaPanel({
  objects,
  instanceUrl,
  apiVersion,
  orgKey,
  tabId,
  tabName,
  shareId,
  onShareConsumed,
  pendingNav,
  onNavConsumed,
  onRequestTab,
  getToken,
  onSessionExpired,
}: SchemaPanelProps) {
  const [rootSearch, setRootSearch] = useState("");
  const [rootName, setRootName] = useState("");
  // Arch Activity actor: human submissions log as "architect"; bridge-issued
  // author calls (same choke points) scope this to "agent-bridge" instead.
  const activityActor = useRef<ArchActor>("architect");
  const [focusName, setFocusName] = useState("");
  const [describes, setDescribes] = useState<Map<string, SalesforceDescribeResult>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [spot, setSpot] = useState<{ focus: string; related: Set<string>; soft?: boolean } | null>(null);
  // Clicked ERD link: the edge stays selected through prop syncs (RF's own
  // selection flag is wiped by setEdges), so the burgundy line + linker
  // field pill survive the highlight.
  const [spotEdgeId, setSpotEdgeId] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  const [staged, setStaged] = useState<Set<string>>(new Set());
  // Refresh + popover + snapshot state
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [popover, setPopover] = useState<PicklistPopoverData | null>(null);
  const [rtPopover, setRtPopover] = useState<RecordTypePopoverData | null>(null);
  const [addValues, setAddValues] = useState<{
    objectApi: string;
    objectLabel: string;
    fieldApi: string;
    fieldLabel: string;
  } | null>(null);
  const [layoutRev, setLayoutRev] = useState(0);
  const [enforced, setEnforced] = useState<Map<string, { x: number; y: number }> | null>(null);
  // Graph drag pins live apart from ERD pins: same apiName keys, two
  // unrelated coordinate systems. Sharing one map pinned graph bubbles at
  // ERD table coordinates (first graph open looked wind-blown until Rebalance).
  const [graphEnforced, setGraphEnforced] = useState<Map<string, { x: number; y: number }> | null>(null);
  const canvasRef = useRef<ErdCanvasHandle | null>(null);
  const canvasNotesRef = useRef<HTMLDivElement>(null);

  /** Reveal the inline canvas-notes surface (used after snapshot restores). */
  const revealCanvasNotes = useCallback(() => {
    window.setTimeout(() => {
      canvasNotesRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 120);
  }, []);
  // New arrivals land off-viewport (spiral) - glide the canvas onto them
  // with a few retries while the node syncs through. No viewport steal on
  // data-only refreshes: callers invoke this only for explicit adds.
  const focusCanvasOn = useCallback((name: string) => {
    let tries = 0;
    const tick = () => {
      if (!name || canvasRef.current?.focusNode(name) || tries++ > 10) return;
      window.setTimeout(tick, 120);
    };
    window.setTimeout(tick, 60);
  }, []);
  const [snapshots, setSnapshots] = useState<ErdSnapshot[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [snapNotesId, setSnapNotesId] = useState<string | null>(null);
  const [snapNotesDraft, setSnapNotesDraft] = useState<NoteBody>(() => emptyNoteBody());
  const [renameValue, setRenameValue] = useState("");

  // Graph view + filters + detail
  const [view, setView] = useState<"erd" | "graph">("erd");
  const [filterMode, setFilterMode] = useState<"all" | "standard" | "custom" | "manual">("all");
  // Canvas tags: the registry + per-node refs persist on the canvas project
  // (per-org autosave); the tag filter + Dim/Hide mode are session-only.
  const [tagRegistry, setTagRegistry] = useState<ErdTag[]>([]);
  const [nodeTags, setNodeTags] = useState<Record<string, string[]>>({});
  const [tagFilter, setTagFilter] = useState<Set<string>>(new Set());
  const [tagMode, setTagMode] = useState<"dim" | "hide">("dim");
  const [tagPicker, setTagPicker] = useState<string | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  // Three tag surfaces: inventory (create), filter (Dim/Hide), link (nodes).
  const [tagsOpen, setTagsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkTagId, setLinkTagId] = useState<string | null>(null);
  const tagsRef = useRef<HTMLSpanElement>(null);
  const filterRef = useRef<HTMLSpanElement>(null);
  const linkRef = useRef<HTMLSpanElement>(null);
  const closeTagSurfaces = useCallback(() => {
    setTagsOpen(false);
    setFilterOpen(false);
    setLinkOpen(false);
  }, []);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const tagById = useMemo(() => new Map(tagRegistry.map((t) => [t.id, t])), [tagRegistry]);

  // Tag mutations: registry + node refs persist on the canvas project.
  const toggleNodeTag = useCallback((api: string, id: string) => {
    setNodeTags((prev) => {
      const cur = prev[api] ?? [];
      const next = cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id];
      if (next.length === 0) {
        const rest = { ...prev };
        delete rest[api];
        return rest;
      }
      return { ...prev, [api]: next };
    });
  }, []);

  const addTag = useCallback((name: string, color: string, assignTo?: string | null) => {
    const tag = createTag(name, color, tagRegistry);
    if (!tag) return null;
    setTagRegistry((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]));
    if (assignTo) {
      setNodeTags((prev) => {
        const cur = prev[assignTo] ?? [];
        return cur.includes(tag.id) ? prev : { ...prev, [assignTo]: [...cur, tag.id] };
      });
    }
    return tag;
  }, [tagRegistry]);

  const deleteTag = useCallback((id: string) => {
    setTagRegistry((prev) => prev.filter((t) => t.id !== id));
    setNodeTags((prev) => {
      const next: Record<string, string[]> = {};
      for (const [api, ids] of Object.entries(prev)) {
        const kept = ids.filter((t) => t !== id);
        if (kept.length > 0) next[api] = kept;
      }
      return next;
    });
    setTagFilter((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const renameTag = useCallback((id: string, name: string) => {
    const clean = cleanTagName(name);
    if (!clean) return;
    setTagRegistry((prev) => prev.map((t) => (t.id === id ? { ...t, name: clean } : t)));
  }, []);

  const recolorTag = useCallback((id: string, color: string) => {
    setTagRegistry((prev) => prev.map((t) => (t.id === id ? { ...t, color: snapTagColor(color) } : t)));
  }, []);

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const ids of Object.values(nodeTags)) for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
    return counts;
  }, [nodeTags]);

  // Meeting-fast canvas keys (ERD view): T tags the focused node, X removes it
  // behind the confirm modal, Esc closes tag surfaces. Ignored while typing,
  // with modifiers held, or inside any dialog/popover.
  useEffect(() => {
    if (view !== "erd" || !rootName) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "escape") {
        if (confirmRemove) setConfirmRemove(null);
        else if (tagPicker) setTagPicker(null);
        else if (tagManagerOpen) setTagManagerOpen(false);
        else if (tagsOpen || filterOpen || linkOpen) closeTagSurfaces();
        return;
      }
      if (confirmRemove || tagPicker || tagManagerOpen || tagsOpen || filterOpen || linkOpen) return;
      if (typeof document !== "undefined" && document.querySelector('[role="dialog"]')) return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (k === "x") {
        if (focusName && focusName !== rootName && describes.has(focusName)) {
          e.preventDefault();
          setConfirmRemove(focusName);
        }
      } else if (k === "t") {
        if (focusName && describes.has(focusName)) {
          e.preventDefault();
          setTagPicker(focusName);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, rootName, focusName, describes, confirmRemove, tagPicker, tagManagerOpen, tagsOpen, filterOpen, linkOpen, closeTagSurfaces]);

  // Tag surfaces: outside click closes (Esc handled by the canvas key effect).
  useEffect(() => {
    if (!tagsOpen && !filterOpen && !linkOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as unknown as globalThis.Node;
      if (tagsRef.current?.contains(t) || filterRef.current?.contains(t) || linkRef.current?.contains(t)) return;
      closeTagSurfaces();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [tagsOpen, filterOpen, linkOpen, closeTagSurfaces]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [manageChecked, setManageChecked] = useState<Set<string>>(new Set());
  const [hideSystem, setHideSystem] = useState(() => getPreferences().erdHideSystem);
  // Allow-list from the Hide-system review modal: explicitly force-shown
  // names survive both the graph/ERD filter AND Neural sweeps.
  const [systemAllow, setSystemAllow] = useState<Set<string>>(new Set());
  const [hidePanel, setHidePanel] = useState<null | "system" | "graph">(null);
  // Hide-system core: the modal allow-list always wins, in graph, ERD and
  // Neural alike. Whatever the modal hides, sweeps automatically honor.
  // Defined up here so graphElements, the review list and Neural share it.
  const systemHidden = useCallback((n: { apiName: string; role: "parent" | "child"; via: string; custom?: boolean }) => {
    if (systemAllow.has(n.apiName)) return false;
    return systemReason({ apiName: n.apiName, role: n.role, via: n.via, custom: n.custom }) !== null;
  }, [systemAllow]);
  const [graphSelected, setGraphSelected] = useState<string | null>(null);
  // removedIds: hard-removed from the ERD canvas (tombstones) - graph never
  // resurrects them as lite previews until re-added. dismissedIds: hidden
  // from GRAPH ONLY (quick remove, family uncheck) - ERD canvas untouched.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  // Mesh (default): one bubble per object, every attach path draws its edge.
  // Linear: same object duplicated under each parent for independent trees.
  const [familyMode, setFamilyMode] = useState<"mesh" | "linear">("mesh");
  // Design mode (graph only): start from the root bubble alone and add
  // objects one by one - parents land left, children right. The graph becomes
  // the object-model sketch; ERD stays the field-detail view until commit.
  const [designMode, setDesignMode] = useState(false);
  const [designIds, setDesignIds] = useState<Set<string>>(new Set());
  const [nodeSearch, setNodeSearch] = useState("");
  // Per-view viewport memory: zoom/pan survives view switches and growth.
  const viewports = useRef<{ erd: { x: number; y: number; zoom: number } | null; graph: { x: number; y: number; zoom: number } | null }>({ erd: null, graph: null });
  // Drag-only lock (top toolbar button): node positions freeze, pan/zoom and
  // selection stay alive. Mutually exclusive with the built-in OOB lock below:
  // custom applies only while OOB is unlocked (oobLocked reported upward).
  const [nodesLocked, setNodesLocked] = useState(false);
  // Schema authoring (Author mode, ERD): deploy custom fields, custom
  // objects, and canvas-drawn relationships via the Tooling API.
  const [authorMode, setAuthorMode] = useState(false);
  const [authorQueue, setAuthorQueue] = useState<AuthorChange[]>([]);
  const [authorDialog, setAuthorDialog] = useState<
    | { kind: "field"; objectApi: string }
    | { kind: "object" }
    | { kind: "relationship"; childApi: string; parentApi: string }
    | null
  >(null);
  const [oobLocked, setOobLocked] = useState(false);
  const [picker, setPicker] = useState<{
    mode: "children" | "parents" | "custom-parents" | "custom-children" | "custom-sweep";
    standardCandidates?: DiscoverCandidate[];
    standardEmptyMessage?: string;
    /** Entity the discovery fans out from (focus node or a box icon). */
    target: string;
    title: string;
    subtitle: string;
    candidates: DiscoverCandidate[];
    /** Shown with empty-state art when there is nothing to list. */
    emptyMessage?: string;
  } | null>(null);
  // Family-tree expansion: per-node deep discovery. Keys are "fromApi->toApi"
  // so the same object can appear under several parents (Lead>Account and
  // Opportunity>Account coexist). expandedFrom records which nodes the user
  // opened; the graph layout extends generations outward from each.
  const [expanded, setExpanded] = useState<Map<string, GraphNeighbor[]>>(new Map());
  const [familyFor, setFamilyFor] = useState<string | null>(null);
  const [family, setFamily] = useState<(DiscoverCandidate & { parentCount: number; childCount: number })[] | null>(null);
  const [familyBusy, setFamilyBusy] = useState(false);

  // Org hostname for per-org snapshot scoping. Lives up here so notes +
  // inbox writers below can persist against it.
  const orgDomain = useMemo(() => {
    try {
      return new URL(instanceUrl).hostname;
    } catch {
      return "";
    }
  }, [instanceUrl]);

  useEffect(() => {
    if (!orgDomain) {
      setSnapshots([]);
      return;
    }
    listSnapshotsByOrg(orgDomain)
      .then(setSnapshots)
      .catch(() => setSnapshots([]));
  }, [orgDomain]);

  // ── Design notes (per org, autosaved): canvas-level markdown shared by ERD
  // + Graph, plus per-entity notes with TODO flags. Snapshots capture notes.
  // Lives up here so the element memos below can inject note flags.
  interface CanvasNotesData {
    text: string;
    textFormat?: NoteFormat;
    textHtml?: string;
    updatedAt: number;
    /** Per-entity log rows - legacy single notes migrate on load. */
    entities: Record<string, CanvasTodo[]>;
  }
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesZen, setNotesZen] = useState(false);
  const [noteExporting, setNoteExporting] = useState(false);
  const exportCanvasNote = async () => {
    if (noteExporting || noteBodyEmpty(canvasNote)) return;
    setNoteExporting(true);
    try {
      const { noteToDocxBlob, noteDocxFilename } = await import("@/lib/notes/docxExport");
      const blob = await noteToDocxBlob("Design Notes", [
        `Canvas prose · auto-saved ${notesSavedAt ? timeAgo(notesSavedAt) : "per org"}`,
      ], canvasNote);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = noteDocxFilename("design-notes");
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setNoteExporting(false);
    }
  };
  const [canvasNote, setCanvasNote] = useState<NoteBody>(() => emptyNoteBody());
  const [notesSavedAt, setNotesSavedAt] = useState<number | null>(null);
  /** Per-entity log: many entries (note/task/question/decision) under one object. */
  const [entityLog, setEntityLog] = useState<Record<string, CanvasTodo[]>>({});
  const [noteEntryId, setNoteEntryId] = useState<string | null>(null);
  const [noteEntity, setNoteEntity] = useState<string | null>(null);
  /** Entity log lives in one large modal - no side-panel editing surface. */
  const [logModalOpen, setLogModalOpen] = useState(false);
  /** Open-items compiled list in the notes panel (icon + count when shut). */
  const [openItemsOpen, setOpenItemsOpen] = useState(false);
  /** Automation footprint modal (Tooling API) + per-object totals for node badges. */
  const [automationApi, setAutomationApi] = useState<string | null>(null);
  const [automationTotals, setAutomationTotals] = useState<Record<string, number>>({});
  const openAutomation = useCallback((apiName: string) => setAutomationApi(apiName), []);
  const recordAutomationTotal = useCallback(
    (apiName: string, total: number) =>
      setAutomationTotals((prev) => (prev[apiName] === total ? prev : { ...prev, [apiName]: total })),
    []
  );
  const notesRestoredRef = useRef<string | null>(null);

  useEffect(() => {
    if (!orgKey || notesRestoredRef.current !== orgKey) return;
    // Always persist once restored - including the empty state, so deleting
    // the last note truly wipes the record instead of resurrecting it.
    queueAutosave(orgKey, "notes", {
      text: canvasNote.md,
      textFormat: canvasNote.format === "rich" ? "rich" : undefined,
      textHtml: canvasNote.html || undefined,
      updatedAt: notesSavedAt ?? Date.now(),
      entities: entityLog,
    } satisfies CanvasNotesData, tabId);
  }, [orgKey, tabId, canvasNote, notesSavedAt, entityLog]);

  useEffect(() => {
    if (!orgKey || notesRestoredRef.current === orgKey) return;
    notesRestoredRef.current = orgKey;
    void (async () => {
      const snap = await loadAutosave<CanvasNotesData>(orgKey, "notes", tabId);
      const d = snap?.data;
      if (!d) return;
      if (d.text) {
        setCanvasNote(
          d.textFormat === "rich" && d.textHtml?.trim()
            ? { format: "rich", md: d.text, html: d.textHtml }
            : noteBodyFromMd(d.text),
        );
        setNotesSavedAt(d.updatedAt ?? snap.savedAt);
      }
      // Legacy single notes migrate into one-row logs on load.
      const logs: Record<string, CanvasTodo[]> = {};
      if (d.entities && typeof d.entities === "object") {
        for (const [api, value] of Object.entries(d.entities)) {
          const rows = migrateEntityLogValue(api, value as unknown);
          if (rows.length > 0) logs[api] = rows;
        }
      }
      setEntityLog(logs);
    })();
  }, [orgKey, tabId]);

  const touchNotes = useCallback(() => setNotesSavedAt(Date.now()), []);

  // Open the log scoped to one entity (from ERD header icon or graph card)
  // straight in the large log modal - the only editing surface for entries.
  const openEntityNote = useCallback((apiName: string) => {
    setNoteEntity(apiName);
    const rows = entityLog[apiName] ?? [];
    setNoteEntryId(rows.length > 0 ? rows.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0].id : null);
    setLogModalOpen(true);
  }, [entityLog]);



  const labels = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of objects) m.set(o.name, o.label);
    for (const d of describes.values()) m.set(d.name, d.label);
    return m;
  }, [objects, describes]);

  // ── Record Walk (session-only live data): root auto-loads from a Record Id,
  // every other node pulls on demand via reachability. Nothing persists -
  // the store dies with the tab and never enters autosave/share/export.
  const [recordRoot, setRecordRoot] = useState<{ apiName: string; id: string } | null>(null);
  const [recordStore, setRecordStore] = useState<LoadedState>(() => emptyLoadedState());
  const [recordBusy, setRecordBusy] = useState<string | null>(null);
  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [recordInput, setRecordInput] = useState("");
  const [recordError, setRecordError] = useState<string | null>(null);
  const [recordPop, setRecordPop] = useState<{ apiName: string; x: number; y: number; mode: "picker" | "record" | "lookup" } | null>(null);
  const [recordPopError, setRecordPopError] = useState<string | null>(null);
  /** Full-screen edit modal target (any aboard record, any object). */
  const [editModal, setEditModal] = useState<{ apiName: string; id: string } | null>(null);
  /** Page-layout cache per object + fetch status for the open modal. */
  const layoutCacheRef = useRef(new Map<string, ObjectLayout[]>());
  const [layoutState, setLayoutState] = useState<{ key: string; loading: boolean; error: string | null }>({
    key: "",
    loading: false,
    error: null,
  });
  const [recordMoreBusy, setRecordMoreBusy] = useState<string | null>(null);
  /** Explicit per-node visualized record. Absent = first child row, else first single. */
  const [recordSel, setRecordSel] = useState<Record<string, string>>({});
  /** Pending lookup-jump context for the popover's lookup mode. */
  const [recordLookup, setRecordLookup] = useState<{
    sourceApi: string;
    fieldName: string;
    targetApi: string;
    targetId: string;
    targetLabel: string;
    keyField: string | null;
    kind: string | null;
  } | null>(null);
  const recordSelRef = useRef(recordSel);
  recordSelRef.current = recordSel;

  const recordCtx = useMemo((): ResolveContext => {
    const canvasApis = [...describes.keys()];
    return {
      rootApi: recordRoot?.apiName ?? null,
      rootId: recordRoot?.id ?? null,
      canvasApis,
      getDescribe: (api) => {
        const d = describes.get(api);
        if (!d) return undefined;
        return {
          fields: d.fields.map((f) => ({ name: f.name, type: f.type, referenceTo: f.referenceTo ?? [], nameField: f.nameField })),
          childRelationships: (d.childRelationships ?? []).map((r) => ({ childSObject: r.childSObject, relationshipName: r.relationshipName ?? null })),
        };
      },
      labelOf: (api) => labels.get(api) ?? api,
    };
  }, [recordRoot, describes, labels]);

  const runRecordQuery = useCallback(async (soql: string): Promise<Record<string, unknown>[]> => {
    const token = getToken();
    if (!token) throw new Error("Session token unavailable. Please reconnect.");
    const response = await apiFetch("/api/salesforce/soql", { instanceUrl, token, apiVersion, soql });
    const data = (await response.json()) as { records?: Record<string, unknown>[]; error?: string; success?: boolean };
    if (!response.ok || data.success === false) {
      const message = typeof data.error === "string" ? data.error : "Query failed";
      if (isSessionExpiredMessage(message)) onSessionExpired?.();
      throw new Error(message);
    }
    return data.records ?? [];
  }, [instanceUrl, apiVersion, getToken, onSessionExpired]);

  const fetchRootRecord = useCallback(async (id: string) => {
    const clean = id.trim();
    if (!isValidRecordId(clean)) throw new Error("Enter a 15- or 18-character Salesforce record Id.");
    if (!rootName) throw new Error("Pick a root object first.");
    const d = describes.get(rootName);
    if (!d) throw new Error(`Describe ${rootName} first - add it to the canvas.`);
    const { select } = displayFieldNames(
      d.fields.map((f) => ({ name: f.name, type: f.type, referenceTo: f.referenceTo ?? [], nameField: f.nameField }))
    );
    const names = queryableFieldNames(
      d.fields.map((f) => ({ name: f.name, type: f.type, referenceTo: f.referenceTo ?? [] }))
    );
    const chunks = chunkSelect(names);
    // Full row in one pass (chunked): the slim root select carries Id + name
    // + lookups only, but entity peeks must never show "—" for fields that
    // exist (e.g. CreatedDate). Validate + type-check first, then pull full.
    const rows = await runRecordQuery(buildRootQuery(rootName, select, clean));
    const rec = rows[0] as ({ attributes?: { type?: string } } & Record<string, unknown>) | undefined;
    if (!rec) throw new Error("No record found with that Id (or access denied).");
    const actual = rec.attributes?.type;
    if (actual && actual !== rootName) {
      throw new Error(`That Id belongs to ${actual}, not ${rootName}. Switch root or use a ${rootName} Id.`);
    }
    try {
      const settled = await Promise.all(
        chunks.map(async (sel) => (await runRecordQuery(buildRootQuery(rootName, sel, clean)))[0] as Record<string, unknown> | undefined)
      );
      const merged: Record<string, unknown> = {};
      for (const row of settled) {
        if (!row) continue;
        const { attributes: _a, ...fields } = row as { attributes?: unknown } & Record<string, unknown>;
        void _a;
        Object.assign(merged, fields);
      }
      if (Object.keys(merged).length > 0) {
        setRecordRoot({ apiName: rootName, id: clean });
        setRecordStore((prev) => {
          const next = new Map(prev.singles);
          const per = new Map(next.get(rootName) ?? []);
          per.set(clean, { id: clean, fields: merged });
          next.set(rootName, per);
          return { singles: next, children: prev.children };
        });
        return;
      }
    } catch {
      // Fall through to the slim row when the full pull fails (e.g. FLS).
    }
    const { attributes: _attrs, ...fields } = rec;
    void _attrs;
    setRecordRoot({ apiName: rootName, id: clean });
    setRecordStore((prev) => {
      const next = new Map(prev.singles);
      next.set(rootName, new Map([[clean, { id: clean, fields }]]));
      return { singles: next, children: prev.children };
    });
  }, [rootName, describes, runRecordQuery]);

  const childSelectFor = useCallback((apiName: string, lookupField: string): string[] => {
    const d = describes.get(apiName);
    const nameField = d?.fields.find((f) => f.nameField)?.name ?? (d?.fields.some((f) => f.name === "Name") ? "Name" : null);
    return [...new Set(["Id", ...(nameField && nameField !== "Id" ? [nameField] : []), lookupField])];
  }, [describes]);



  /** Pull one record by id and store it (fresh truth, replaces cached).
   * Full row: every queryable field, chunked into parallel SOQL calls so
   * huge objects stay under the query-length cap. */
  const pullSingle = useCallback(async (apiName: string, id: string): Promise<Record<string, unknown>> => {
    const d = describes.get(apiName);
    if (!d) throw new Error(`${apiName} is not on canvas - add it first.`);
    const names = queryableFieldNames(
      d.fields.map((f) => ({ name: f.name, type: f.type, referenceTo: f.referenceTo ?? [] }))
    );
    const chunks = chunkSelect(names);
    const settled = await Promise.all(
      chunks.map(async (select) => {
        const rows = await runRecordQuery(buildRootQuery(apiName, select, id));
        return rows[0] as Record<string, unknown> | undefined;
      })
    );
    const merged: Record<string, unknown> = {};
    for (const row of settled) {
      if (!row) continue;
      const { attributes: _a, ...fields } = row as { attributes?: unknown } & Record<string, unknown>;
      void _a;
      Object.assign(merged, fields);
    }
    if (Object.keys(merged).length === 0) throw new Error("No record found (or access denied).");
    setRecordStore((prev) => {
      const next = new Map(prev.singles);
      const per = new Map(next.get(apiName) ?? []);
      per.set(id, { id, fields: merged });
      next.set(apiName, per);
      return { singles: next, children: prev.children };
    });
    return merged;
  }, [describes, runRecordQuery]);

  /** Pull one children page; append=false replaces (refresh), true appends (load-more).
   * Returns the fetched rows so callers can chain (default-first selection). */
  const pullChildPage = useCallback(async (
    childApi: string,
    lookupField: string,
    parentApi: string,
    parentId: string,
    offset: number,
    append: boolean
  ): Promise<Record<string, unknown>[]> => {
    const rows = await runRecordQuery(
      buildChildrenQuery(childApi, lookupField, parentId, childSelectFor(childApi, lookupField), offset)
    );
    const key = childPageKey(childApi, lookupField, parentId);
    setRecordStore((prev) => {
      const next = new Map(prev.children);
      const cur = next.get(key);
      const base = append && cur ? cur.rows : [];
      next.set(key, {
        childApi, lookupField, parentApi, parentId,
        rows: [...base, ...rows],
        offset: (append && cur ? cur.offset : 0) + rows.length,
        exhausted: rows.length < RECORD_ROW_LIMIT,
      });
      return { singles: prev.singles, children: next };
    });
    return rows;
  }, [runRecordQuery, childSelectFor]);

  /** Pull first pages for parent plans that have none yet (a parent loaded
   * after the first pull). One denied parent never blocks the eye - whatever
   * is aboard still opens. */
  const pullMissingPlans = useCallback(async (apiName: string): Promise<void> => {
    const store = recordStoreRef.current;
    const plans = resolveChildPlans(apiName, store, recordCtxRef.current);
    for (const p of plans) {
      if (store.children.has(childPageKey(p.childApi, p.lookupField, p.parentId))) continue;
      try {
        await pullChildPage(p.childApi, p.lookupField, p.parentApi, p.parentId, 0, false);
      } catch {
        // Swallowed per plan: the eye opens with whatever is aboard.
      }
    }
  }, [pullChildPage]);

  /** Lookup jump: from one loaded row's reference field, fetch the target's
   * key field (Name, else OrderNumber-style, else raw Id) with one deliberate
   * query. Targets off-canvas resolve without touching the canvas; targets
   * already aboard reuse the cached row. Never throws into the row UI -
   * failures land as "raw Id" with a hint. */
  const openLookupTarget = useCallback(async (
    sourceApi: string,
    fieldName: string,
    anchor: { x: number; y: number; width: number; height: number }
  ) => {
    setRecordPopError(null);
    const selId = selectedRecordId(sourceApi, recordStoreRef.current, recordSelRef.current[sourceApi] ?? null);
    const singles = selId ? recordStoreRef.current.singles.get(sourceApi)?.get(selId)?.fields : undefined;
    let targetId: string | null = null;
    if (singles && typeof singles[fieldName] === "string" && singles[fieldName]) {
      targetId = singles[fieldName] as string;
    } else {
      for (const page of recordStoreRef.current.children.values()) {
        if (page.childApi !== sourceApi) continue;
        const row = page.rows.find((r) => r.Id === selId);
        const v = row?.[fieldName];
        if (typeof v === "string" && v) {
          targetId = v;
          break;
        }
      }
    }
    if (!targetId) {
      setRecordPopError(`No ${fieldName} value on the visualized ${sourceApi} record.`);
      setRecordPop({ apiName: sourceApi, x: anchor.x, y: anchor.y, mode: "picker" });
      return;
    }
    // Which object? Id prefix first (005 = User, 00G = Group/queue -
    // covers polymorphic OwnerId/CreatedById without a fetch), then first
    // on-canvas describe, else the edge's own first declared target.
    const holderDesc = describes.get(sourceApi);
    const declared = holderDesc?.fields.find((f) => f.name === fieldName)?.referenceTo ?? [];
    const byPrefix = targetApiForId(declared, targetId);
    const candidates = declared.filter((t) => describes.has(t));
    const targetApi = byPrefix ?? candidates[0] ?? declared[0] ?? null;
    if (!targetApi) {
      setRecordPopError(`${fieldName} has no described lookup target on ${sourceApi}.`);
      setRecordPop({ apiName: sourceApi, x: anchor.x, y: anchor.y, mode: "picker" });
      return;
    }
    const kind = kindForId(targetApi);
    // Land in the row's peek panel (same chrome as plain fields): dispatch
    // first with the resolving state so the panel never opens empty, then
    // replace with the resolved label (or raw-Id fallback) when it lands.
    const fire = (value: string, context: string) => {
      window.dispatchEvent(new CustomEvent("erd-peek-at", {
        detail: { nodeApi: sourceApi, field: fieldName, value, context, x: anchor.x, y: anchor.y },
      }));
    };
    fire("Resolving…", `${sourceApi} · ${fieldName} · ${targetId}`);
    // Target aboard? Reuse its row label without a query.
    const aboard = recordStoreRef.current.singles.get(targetApi)?.get(targetId)?.fields;
    // Off-canvas targets: fetch the describe live (cached after first use),
    // so User/Group resolve even when only Account is on canvas.
    let targetDesc = describes.get(targetApi);
    if (!targetDesc) {
      try {
        const token = getToken();
        if (!token) throw new Error("Session token unavailable. Please reconnect.");
        const response = await apiFetch("/api/salesforce/describe", { instanceUrl, token, apiVersion, objectName: targetApi });
        const data = (await response.json()) as { error?: string; name?: string; fields?: { name: string; type: string; referenceTo?: string[]; nameField?: boolean }[] };
        if (response.ok && data.name) {
          targetDesc = data as unknown as typeof targetDesc;
        }
      } catch {
        targetDesc = undefined;
      }
    }
    const keyField = targetDesc
      ? keyFieldFor(targetDesc.fields.map((f) => ({ name: f.name, type: f.type, referenceTo: f.referenceTo ?? [], nameField: f.nameField })))
      : null;
    const aboardLabel = targetApi === "Group"
      ? queueLabelFromRow(aboard as Record<string, unknown> | undefined)
      : keyField
        ? labelFromRow(aboard as Record<string, unknown> | undefined, keyField)
        : null;
    if (aboardLabel) {
      const badge = kind ? ` · ${kind}` : "";
      const via = targetApi === "Group" ? "Name" : keyField;
      fire(aboardLabel, `${sourceApi} · ${fieldName}${badge}${via ? ` · via ${via}` : ""} · ${targetId}`);
      return;
    }
    if (!targetDesc || (!keyField && targetApi !== "Group")) {
      // No text key on the target (or undescribed): show the raw Id honestly.
      fire(targetId, `${sourceApi} · ${fieldName}${kind ? ` · ${kind}` : ""} · ${targetId}`);
      return;
    }
    if (recordBusyRef.current) return;
    setRecordBusy(targetApi);
    recordBusyRef.current = targetApi;
    try {
      // Queues need Type alongside Name for the "(queue)" suffix.
      const select = targetApi === "Group" ? "Id, Name, Type" : `Id, ${keyField}`;
      const rows = await runRecordQuery(`SELECT ${select} FROM ${targetApi} WHERE Id = '${targetId.trim().replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' LIMIT 1`);
      const hit = targetApi === "Group" ? queueLabelFromRow(rows[0]) : labelFromRow(rows[0], keyField!);
      const badge = kind ? ` · ${kind}` : "";
      if (hit) {
        const via = targetApi === "Group" ? "Name" : keyField;
        fire(hit, `${sourceApi} · ${fieldName}${badge} · via ${via} · ${targetId}`);
      } else {
        fire(targetId, `${sourceApi} · ${fieldName}${badge} · ${targetId} (no display name)`);
      }
    } catch (err) {
      // FLS/denied: raw Id + hint, never a dead click.
      fire(targetId, `${sourceApi} · ${fieldName} · ${targetId} (${err instanceof Error ? err.message : "pull failed"})`);
    } finally {
      recordBusyRef.current = null;
      setRecordBusy(null);
    }
  }, [describes, instanceUrl, apiVersion, getToken, runRecordQuery]);

  const openNodeRecord = useCallback(async (
    apiName: string,
    anchor: { x: number; y: number; width: number; height: number }
  ) => {
    setRecordPopError(null);
    // Live already? Converge first: parents loaded after the last pull get
    // their first page now, so every on-canvas parent is represented. The
    // eye always lands on the list (even for one record) - the entity box
    // carries the visualized row while the eye offers list + Inspect.
    if (knownIdsFor(recordStoreRef.current, apiName).length > 0) {
      if (recordBusyRef.current) return;
      setRecordBusy(apiName);
      recordBusyRef.current = apiName;
      try {
        await pullMissingPlans(apiName);
      } finally {
        recordBusyRef.current = null;
        setRecordBusy(null);
      }
      setRecordPop({ apiName, x: anchor.x, y: anchor.y, mode: "picker" });
      return;
    }
    const plan = resolveTarget(apiName, recordStoreRef.current, recordCtxRef.current);
    // Unreachable? The popover shows the hint + shortcut.
    if (plan.kind === "blocked") {
      setRecordPop({ apiName, x: anchor.x, y: anchor.y, mode: "picker" });
      return;
    }
    if (recordBusyRef.current) return;
    setRecordBusy(apiName);
    recordBusyRef.current = apiName;
    try {
      const pulled: { api: string; fields: Record<string, unknown> }[] = [];
      if (plan.kind === "single") {
        // One record: pull silently, entity box + field peeks carry it.
        pulled.push({ api: apiName, fields: await pullSingle(apiName, plan.id) });
      } else {
        // Fan out: one first-page per loaded parent, so multi-parent
        // children (Task, junctions) never skip a parent's rows. One denied
        // parent fails into the banner without sinking the others.
        const plans = resolveChildPlans(apiName, recordStoreRef.current, recordCtxRef.current);
        let firstId: string | null = null;
        for (const p of plans) {
          let rows: Record<string, unknown>[] = [];
          try {
            rows = await pullChildPage(p.childApi, p.lookupField, p.parentApi, p.parentId, 0, false);
          } catch (err) {
            setRecordPopError(err instanceof Error ? err.message : "Record pull failed.");
            continue;
          }
          if (!firstId) {
            const fid = rows[0]?.Id;
            if (typeof fid === "string" && fid) firstId = fid;
          }
        }
        // First row visualizes by default (full row, not the list subset).
        if (firstId) {
          pulled.push({ api: apiName, fields: await pullSingle(apiName, firstId) });
        }
        // Always land on the list - even one row gets list + Inspect, so the
        // eye never strands the architect without a way back.
        setRecordPop({ apiName, x: anchor.x, y: anchor.y, mode: "picker" });
      }
      for (const p of pulled) void prefetchRefLabelsRef.current(p.api, p.fields);
    } catch (err) {
      setRecordPopError(err instanceof Error ? err.message : "Record pull failed.");
      setRecordPop({ apiName, x: anchor.x, y: anchor.y, mode: "picker" });
    } finally {
      recordBusyRef.current = null;
      setRecordBusy(null);
    }
  }, [pullSingle, pullChildPage, pullMissingPlans]);

  const recordStoreRef = useRef(recordStore);
  recordStoreRef.current = recordStore;
  const recordCtxRef = useRef(recordCtx);
  recordCtxRef.current = recordCtx;
  const recordBusyRef = useRef<string | null>(null);

  const loadMoreRecords = useCallback(async (sectionKey: string) => {
    const page = recordStoreRef.current.children.get(sectionKey);
    if (!page || page.exhausted || recordMoreBusy) return;
    setRecordMoreBusy(sectionKey);
    setRecordPopError(null);
    try {
      await pullChildPage(page.childApi, page.lookupField, page.parentApi, page.parentId, page.offset, true);
    } catch (err) {
      setRecordPopError(err instanceof Error ? err.message : "Load-more failed.");
    } finally {
      setRecordMoreBusy(null);
    }
  }, [pullChildPage, recordMoreBusy]);

  /** Re-pull everything aboard (root + singles + first pages) - latest truth from the server. */
  const refreshAllRecords = useCallback(async () => {
    const store = recordStoreRef.current;
    const failures: string[] = [];
    let refreshed = 0;
    setRecordBusy("__all__");
    try {
      for (const [api, per] of store.singles) {
        for (const id of per.keys()) {
          try {
            await pullSingle(api, id);
            refreshed++;
          } catch {
            failures.push(api);
          }
        }
      }
      for (const page of store.children.values()) {
        try {
          await pullChildPage(page.childApi, page.lookupField, page.parentApi, page.parentId, 0, false);
          refreshed++;
        } catch {
          failures.push(page.childApi);
        }
      }
    } finally {
      setRecordBusy(null);
    }
    if (refreshed === 0 && failures.length > 0) {
      setRecordPopError(`Refresh failed: ${[...new Set(failures)].join(", ")}`);
    } else {
      setNotice(
        `Record data refreshed (${refreshed} pull${refreshed === 1 ? "" : "s"})` +
          (failures.length > 0 ? ` - failed: ${[...new Set(failures)].join(", ")}` : ".")
      );
    }
  }, [pullSingle, pullChildPage]);

  /** PATCH one record, then re-pull it so the box shows server truth. */
  const saveRecordEdit = useCallback(async (
    apiName: string,
    id: string,
    changes: Record<string, unknown>
  ): Promise<void> => {
    const token = getToken();
    if (!token) throw new Error("Session token unavailable. Please reconnect.");
    const ver = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
    const response = await apiFetch("/api/salesforce/rest", {
      instanceUrl,
      token,
      scope: "org",
      method: "PATCH",
      path: `/services/data/${ver}/sobjects/${apiName}/${id}`,
      body: JSON.stringify(changes),
      auth: { type: "bearer", token },
    });
    const data = (await response.json()) as {
      success?: boolean;
      status?: number;
      statusText?: string;
      body?: unknown;
      error?: string;
    };
    if (!response.ok || !data.success) {
      let message =
        typeof data.error === "string" ? data.error : `Save failed (HTTP ${data.status ?? response.status})`;
      const issues = data.body as { message?: string; fields?: string[] }[] | undefined;
      if (Array.isArray(issues) && issues.length > 0 && issues[0]?.message) {
        message = issues.map((i) => i.message).join("; ");
      }
      if (isSessionExpiredMessage(message)) onSessionExpired?.();
      void logArchActivity({
        actor: activityActor.current,
        surface: "erd",
        view,
        root: rootName || undefined,
        category: "data",
        action: "update-record",
        target: `${apiName}/${id}`,
        ok: false,
        message: `${apiName} save failed - ${message}`.slice(0, 500),
      });
      throw new Error(message);
    }
    await pullSingle(apiName, id);
    setNotice(`${apiName} saved - box refreshed from the server.`);
    void logArchActivity({
      actor: activityActor.current,
      surface: "erd",
      view,
      root: rootName || undefined,
      category: "data",
      action: "update-record",
      target: `${apiName}/${id}`,
      ok: true,
      message: `${apiName} record saved.`,
    });
  }, [instanceUrl, apiVersion, getToken, onSessionExpired, pullSingle, view, rootName]);

  /** Raw (typed) fields for any aboard record: full singles first, then child pages. */
  const editRawFields = useCallback((apiName: string, id: string): Record<string, unknown> | null => {
    const single = recordStore.singles.get(apiName)?.get(id)?.fields;
    if (single) return single;
    for (const page of recordStore.children.values()) {
      if (page.childApi !== apiName) continue;
      const row = page.rows.find((r) => r.Id === id);
      if (row) return row;
    }
    return null;
  }, [recordStore]);

  /** Human name for the modal header: Name/Subject/… cascade, else the Id. */
  const editRecordName = useCallback((apiName: string, id: string): string => {
    const fields = editRawFields(apiName, id);
    if (fields) {
      for (const k of ["Name", "Subject", "DeveloperName", "Title", "Label"]) {
        const v = fields[k];
        if (typeof v === "string" && v) return v;
      }
    }
    return id;
  }, [editRawFields]);

  /** Open the full-screen edit modal and warm its page-layout tabs. */
  const openEditModal = useCallback((apiName: string, id: string) => {
    setEditModal({ apiName, id });
    if (layoutCacheRef.current.has(apiName)) return;
    setLayoutState({ key: apiName, loading: true, error: null });
    const token = getToken();
    if (!token) {
      setLayoutState({ key: apiName, loading: false, error: "Session token unavailable." });
      return;
    }
    const ver = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
    void apiFetch("/api/salesforce/rest", {
      instanceUrl, token, scope: "org", method: "GET",
      path: `/services/data/${ver}/sobjects/${apiName}/describe/layouts`,
      auth: { type: "bearer", token },
    })
      .then(async (response) => {
        const data = (await response.json()) as { success?: boolean; status?: number; body?: unknown; error?: string };
        if (!response.ok || data.success === false) {
          throw new Error(typeof data.error === "string" && data.error ? data.error : `Layouts failed (${data.status ?? response.status}).`);
        }
        layoutCacheRef.current.set(apiName, parseLayouts(data.body).layouts);
        setLayoutState((prev) => (prev.key === apiName ? { key: apiName, loading: false, error: null } : prev));
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Layouts failed.";
        if (isSessionExpiredMessage(message)) onSessionExpired?.();
        setLayoutState((prev) => (prev.key === apiName ? { key: apiName, loading: false, error: message } : prev));
      });
  }, [instanceUrl, apiVersion, getToken, onSessionExpired]);

  const recordFieldMeta = useCallback((apiName: string): RecordFieldMeta[] | null => {
    const d = describes.get(apiName);
    if (!d) return null;
    return d.fields.map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      updateable: f.updateable,
      required: !f.nillable,
      refs: f.referenceTo ?? [],
      picklistValues: (f.picklistValues ?? []).map((p) => ({ label: p.label ?? p.value, value: p.value })),
    }));
  }, [describes]);

  const refreshNodeRecord = useCallback(async (apiName: string) => {
    setRecordPopError(null);
    setRecordBusy(apiName);
    try {
      const store = recordStoreRef.current;
      const singles = store.singles.get(apiName);
      if (singles) {
        for (const id of singles.keys()) {
          await pullSingle(apiName, id);
        }
      }
      for (const page of store.children.values()) {
        if (page.childApi !== apiName) continue;
        await pullChildPage(page.childApi, page.lookupField, page.parentApi, page.parentId, 0, false);
      }
      setNotice(`${apiName} record data refreshed from the server.`);
    } catch (err) {
      setRecordPopError(err instanceof Error ? err.message : "Refresh failed.");
    } finally {
      setRecordBusy(null);
    }
  }, [pullSingle, pullChildPage]);

  /** Resolved lookup display labels: `${sourceApi}::${targetId}` -> label.
   * Cached across pulls (Id keys never change); cleared with record data.
   * OFF until lookup jumps prove out - refs render as plain on-demand links
   * (one query per click), no prefetch storms. Wiring stays for later. */
  const [refLabels, setRefLabels] = useState<Record<string, string>>({});
  const refLabelsRef = useRef(refLabels);
  refLabelsRef.current = refLabels;

  /** Prefetch stub: lookup jumps resolve on click (one query each), so
   * rows stay plain links until the jump panel proves out. Kept as the
   * seam for batched labels later. */
  const prefetchRefLabels = useCallback(async (_sourceApi: string, _values: Record<string, unknown>) => {
    void _sourceApi;
    void _values;
  }, []);

  /** Row ref labels for one visualized record: field -> "label".
   * Currently always empty (prefetch off) - the row keeps its plain
   * on-demand link. Returns the cached map when prefetch returns. */
  const refLabelsFor = useCallback((_sourceApi: string, _values: Record<string, unknown> | null): Record<string, string> => {
    void _sourceApi;
    void _values;
    return {};
  }, []);

  // Late-bound ref so early callbacks (openNodeRecord/select) can prefetch
  // without a declaration-order cycle.
  const prefetchRefLabelsRef = useRef(prefetchRefLabels);
  prefetchRefLabelsRef.current = prefetchRefLabels;
  const selectNodeRecord = useCallback(async (apiName: string, id: string) => {
    setRecordSel((prev) => ({ ...prev, [apiName]: id }));
    setRecordPopError(null);
    const aboard = recordStoreRef.current.singles.get(apiName)?.get(id)?.fields;
    if (aboard) {
      void prefetchRefLabelsRef.current(apiName, aboard);
      return;
    }
    if (recordBusyRef.current) return;
    setRecordBusy(apiName);
    recordBusyRef.current = apiName;
    try {
      const fields = await pullSingle(apiName, id);
      void prefetchRefLabelsRef.current(apiName, fields);
    } catch (err) {
      setRecordPopError(err instanceof Error ? err.message : "Record pull failed.");
    } finally {
      recordBusyRef.current = null;
      setRecordBusy(null);
    }
  }, [pullSingle]);

  /** Drop one node's data (singles, child pages, selection) - the root Id
   * and its input stay put; only the root modal clears those. */
  const clearNodeRecordData = useCallback((apiName: string) => {
    setRecordSel((prev) => {
      if (!(apiName in prev)) return prev;
      const next = { ...prev };
      delete next[apiName];
      return next;
    });
    setRecordStore((prev) => {
      const singles = new Map(prev.singles);
      singles.delete(apiName);
      const children = new Map(prev.children);
      for (const [key, page] of children) {
        if (page.childApi === apiName) children.delete(key);
      }
      return { singles, children };
    });
    // Drop cached labels minted from this source + labels pointing AT it.
    setRefLabels((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (k.startsWith(`${apiName}::`)) continue;
        next[k] = v;
      }
      return next;
    });
    setRecordPop(null);
    setRecordPopError(null);
  }, []);

  /** Global reset from the root modal: everything goes, including the root. */
  const clearRecordData = useCallback(() => {
    setRecordRoot(null);
    setRecordStore(emptyLoadedState());
    setRecordSel({});
    setRefLabels({});
    setRecordLookup(null);
    setRecordPop(null);
    setRecordPopError(null);
    setRecordInput("");
    setRecordError(null);
    setRecordModalOpen(false);
  }, []);

  const recordNodeData = useCallback((apiName: string) => {
    const { state, hint } = nodeRecordState(apiName, recordStore, recordCtx);
    // Visualized record: explicit pick, else first child row, else first single.
    const selId = selectedRecordId(apiName, recordStore, recordSel[apiName] ?? null);
    let values: Record<string, unknown> | null = null;
    if (selId) {
      const full = recordStore.singles.get(apiName)?.get(selId)?.fields;
      if (full) {
        values = full;
      } else {
        for (const page of recordStore.children.values()) {
          if (page.childApi !== apiName) continue;
          const row = page.rows.find((r) => r.Id === selId);
          if (row) {
            values = row;
            break;
          }
        }
      }
    }
    return {
      recordState: state as "live" | "reachable" | "locked",
      recordHint: hint ?? undefined,
      recordValues: values,
      recordId: selId,
      recordCount: knownIdsFor(recordStore, apiName).length,
      refLabels: refLabelsFor(apiName, values),
      onRecordClick: (
        api: string,
        anchor: { x: number; y: number; width: number; height: number }
      ) => {
        void openNodeRecord(api, anchor);
      },
      getPeekEdit: (fieldName: string) => {
        if (!selId || fieldName === "Id") return null;
        const meta = recordFieldMeta(apiName)?.find((m) => m.name === fieldName);
        if (!meta || !meta.updateable) return null;
        return { id: selId, meta };
      },
      onSavePeekField: (api: string, id: string, changes: Record<string, unknown>) => saveRecordEdit(api, id, changes),
      onLookupClick: (
        sourceApi: string,
        fieldName: string,
        anchor: { x: number; y: number; width: number; height: number }
      ) => {
        void openLookupTarget(sourceApi, fieldName, anchor);
      },
    };
  }, [recordStore, recordSel, recordCtx, openNodeRecord, openLookupTarget, refLabelsFor, recordFieldMeta, saveRecordEdit]);

  const buildRecordPop = useCallback((apiName: string, x: number, y: number): RecordPopData => {
    const label = labels.get(apiName) ?? apiName;
    const loading = recordBusy === apiName || recordBusy === "__all__";
    const popMode: RecordPopData["mode"] = recordPop?.apiName === apiName ? recordPop.mode : "picker";
    // Lookup mode is target-scoped, not node-scoped: show the jump context
    // even when the target object has nothing aboard yet.
    if (popMode === "lookup" && recordLookup) {
      const targetLabel = labels.get(recordLookup.targetApi) ?? recordLookup.targetApi;
      return {
        apiName: recordLookup.targetApi,
        nodeLabel: targetLabel,
        single: null,
        singleId: null,
        sections: [],
        loading,
        error: recordPopError,
        x,
        y,
        blockedHint: null,
        blockedApi: null,
        mode: "lookup",
        candidates: [],
        tableRows: [],
        candidateGroups: [],
        tableGroups: [],
        requiredFields: [],
        selectedId: null,
        lookup: {
          sourceApi: recordLookup.sourceApi,
          sourceName: labels.get(recordLookup.sourceApi) ?? recordLookup.sourceApi,
          fieldName: recordLookup.fieldName,
          targetLabel: recordLookup.targetLabel,
          targetId: recordLookup.targetId,
          keyField: recordLookup.keyField,
          kind: recordLookup.kind,
        },
      };
    }
    const singles = [...(recordStore.singles.get(apiName)?.values() ?? [])];
    const sections: RecordPopData["sections"] = [];
    for (const [key, page] of recordStore.children) {
      if (page.childApi !== apiName) continue;
      sections.push({
        key,
        childApi: page.childApi,
        viaLabel: `${labels.get(page.parentApi) ?? page.parentApi} · ${page.lookupField}`,
        rows: page.rows,
        exhausted: page.exhausted,
        loadingMore: recordMoreBusy === key,
      });
    }
    // Picker candidates: every aboard id with a human name when one exists.
    const NAME_KEYS = ["Name", "Subject", "DeveloperName", "Title", "Label"];
    const nameOf = (id: string): string => {
      const single = recordStore.singles.get(apiName)?.get(id)?.fields;
      const pools: (Record<string, unknown> | undefined)[] = [single];
      for (const page of recordStore.children.values()) {
        if (page.childApi !== apiName) continue;
        pools.push(page.rows.find((r) => r.Id === id));
      }
      for (const pool of pools) {
        if (!pool) continue;
        for (const k of NAME_KEYS) {
          const v = pool[k];
          if (typeof v === "string" && v) return v;
        }
      }
      return id;
    };
    const tableRows = rowsForApi(recordStore, apiName);
    const candidates = knownIdsFor(recordStore, apiName).map((id) => ({ id, name: nameOf(id) }));
    // Per-parent slices for the tabbed picker + grid: one group per loaded
    // parent page with rows. A merged row belongs to a parent when its
    // lookup value equals that parent's id (slim and full rows alike).
    const candidateGroups: RecordPopData["candidateGroups"] = [];
    const tableGroups: RecordPopData["tableGroups"] = [];
    for (const [key, page] of recordStore.children) {
      if (page.childApi !== apiName) continue;
      const label = `${labels.get(page.parentApi) ?? page.parentApi} · ${page.lookupField}`;
      const ids = page.rows
        .map((r) => (typeof r.Id === "string" ? r.Id : null))
        .filter((id): id is string => !!id)
        .map((id) => ({ id, name: nameOf(id) }));
      if (ids.length > 0) candidateGroups.push({ key, label, ids });
      const grows = tableRows.filter((r) => r[page.lookupField] === page.parentId);
      if (grows.length > 0) tableGroups.push({ key, label, rows: grows });
    }
    const selectedId = selectedRecordId(apiName, recordStore, recordSel[apiName] ?? null);
    const resolvedMode = recordPop?.apiName === apiName ? recordPop.mode : "picker";
    if (singles.length === 0 && sections.length === 0 && !loading) {
      const plan = resolveTarget(apiName, recordStore, recordCtx);
      if (plan.kind === "blocked") {
        return {
          apiName, nodeLabel: label, single: null, singleId: null, sections, loading, error: recordPopError, x, y,
          blockedHint: plan.missingApi === apiName
            ? "No lookup path from a loaded record reaches this object yet."
            : `Nothing loaded connects here yet.`,
          blockedApi: plan.missingApi === apiName ? null : plan.missingApi,
          mode: "picker", candidates, selectedId, tableRows: [],
          candidateGroups: [], tableGroups: [], requiredFields: [],
        };
      }
    }
    // Record mode dumps the SELECTED record (the entity box shows the same one).
    const first = (selectedId ? singles.find((s) => s.id === selectedId) : undefined) ?? singles[0];
    return {
      apiName,
      nodeLabel: label,
      single: first
        ? Object.entries(first.fields)
            .filter(([, v]) => v === null || v === undefined || typeof v !== "object")
            .map(([k, v]) => ({ label: k, value: v === null || v === undefined ? "—" : String(v) }))
        : null,
      singleId: first?.id ?? null,
      sections,
      loading,
      error: recordPopError,
      x,
      y,
      blockedHint: null,
      blockedApi: null,
      mode: resolvedMode, candidates, selectedId, tableRows,
      candidateGroups, tableGroups,
      requiredFields: (describes.get(apiName)?.fields ?? [])
        .filter((f) => !f.nillable && f.name !== "Id")
        .map((f) => f.name),
    };
  }, [labels, recordStore, recordSel, recordBusy, recordMoreBusy, recordPopError, recordCtx, recordPop, recordLookup, describes]);

  // ── Inbox lifecycle writers (Phase 2): meta merges onto the canonical
  // entity/snapshot records with history entries. Legacy todo/done flags
  // stay meaningful: kind task ↔ todo, done ↔ resolved.
  const appendHistory = (h: InboxHistoryEntry[] | undefined, what: string): InboxHistoryEntry[] =>
    [...(h ?? []), { at: Date.now(), what }].slice(-50);

  /** Current baseline for an anchor against live describes (null = unresolvable). */
  const baselineFor = useCallback((api: string, anchor?: InboxAnchor): { fingerprint: InboxFingerprint; anchorFacts: AnchorFacts } | null => {
    const a = anchor ?? { type: "entity" as const, id: api };
    if (a.type === "field" || a.type === "relationship") {
      const dot = a.id.indexOf(".");
      const d = dot > 0 ? describes.get(a.id.slice(0, dot)) : undefined;
      const field = d?.fields.find((f) => f.name === (dot > 0 ? a.id.slice(dot + 1) : a.id));
      if (!field) return null;
      const facts = {
        kind: "field" as const,
        type: field.type,
        required: !field.nillable && !field.defaultedOnCreate,
        referenceTo: [...(field.referenceTo ?? [])].sort(),
        label: field.label,
      };
      return { fingerprint: { value: fingerprintField({ name: field.name, ...facts }), at: Date.now() }, anchorFacts: facts };
    }
    const d = describes.get(a.id);
    if (!d) return null;
    const facts = {
      kind: "entity" as const,
      fieldNames: [...d.fields.map((f) => f.name)].sort(),
      childNames: [...new Set((d.childRelationships ?? []).map((r) => r.childSObject).filter(Boolean))].sort(),
    };
    return { fingerprint: { value: fingerprintEntity({ apiName: a.id, fieldCount: d.fields.length, fieldNames: facts.fieldNames, childNames: facts.childNames }), at: Date.now() }, anchorFacts: facts };
  }, [describes]);

  /** Locate one entry across every log scope (entities + canvas). */
  const locateEntry = useCallback(
    (entryId: string): { scope: "log"; api: string; entry: CanvasTodo } | null => {
      for (const [api, rows] of Object.entries(entityLog)) {
        const entry = rows.find((x) => x.id === entryId);
        if (entry) return { scope: "log", api, entry };
      }
      return null;
    },
    [entityLog]
  );

  /** Patch one log row, appending history when noted. */
  const patchEntryById = useCallback((entryId: string, patch: Partial<CanvasTodo>, what?: string) => {
    const stamp = Date.now();
    const apply = (e: CanvasTodo): CanvasTodo => ({
      ...e,
      ...patch,
      ...(what ? { history: appendHistory(e.history, what) } : {}),
      updatedAt: stamp,
    });
    setEntityLog((prev) => {
      const next = { ...prev };
      for (const api of Object.keys(next)) next[api] = next[api].map((r) => (r.id === entryId ? apply(r) : r));
      return next;
    });
    touchNotes();
  }, [touchNotes]);

  const deleteEntryById = useCallback((entryId: string) => {
    setEntityLog((prev) => {
      const next: Record<string, CanvasTodo[]> = {};
      for (const [api, rows] of Object.entries(prev)) {
        const kept = rows.filter((r) => r.id !== entryId);
        if (kept.length > 0) next[api] = kept;
      }
      return next;
    });
    setNoteEntryId((cur) => (cur === entryId ? null : cur));
    touchNotes();
  }, [touchNotes]);

  /** UI patch path for log rows: CanvasTodo-shaped patch in, single write,
   * baseline fingerprint ensured like the old meta writer. */
  const patchLogEntry = useCallback((id: string, patch: Partial<CanvasTodo>, what: string) => {
    const found = locateEntry(id);
    if (!found || found.scope !== "log") {
      patchEntryById(id, patch, what);
      return;
    }
    const next = { ...patch };
    const anchor = next.anchor ?? found.entry.anchor;
    if (!found.entry.fingerprint || next.anchor) {
      const base = anchor && anchor.type !== "canvas" ? anchor : { type: "entity" as const, id: found.api };
      const baseline = baselineFor(found.api, base);
      if (baseline) {
        next.fingerprint = baseline.fingerprint;
        next.anchorFacts = baseline.anchorFacts;
      }
    }
    patchEntryById(id, next, what);
  }, [locateEntry, baselineFor, patchEntryById]);

  /** Replace one entry body triple; empties (no title, no text) drop the row. */
  const setEntryBodyById = useCallback((entryId: string, b: NoteBody) => {
    const found = locateEntry(entryId);
    if (!found) return;
    if (entryBodyVacant(found.entry.title, b)) {
      deleteEntryById(entryId);
      return;
    }
    patchEntryById(entryId, noteToTodoBody(b));
  }, [locateEntry, deleteEntryById, patchEntryById]);

  /** Log a fresh entry under one scope (entity or canvas) and select it. */
  const addEntityEntry = useCallback((api: string, kind: InboxItemKind) => {
    const now = Date.now();
    const id = `ent-${api}-${now.toString(36)}`;
    const row: CanvasTodo = {
      id,
      title: "",
      kind,
      status: "open",
      priority: "normal",
      entityApi: api,
      // Canvas scope stays unanchored - there is no Salesforce object here.
      anchor: api === CANVAS_LOG_API ? undefined : { type: "entity", id: api, labelAtCreation: labels.get(api) },
      createdAt: now,
      updatedAt: now,
    };
    setEntityLog((prev) => ({ ...prev, [api]: [...(prev[api] ?? []), row] }));
    setNoteEntryId(id);
    touchNotes();
    return id;
  }, [labels, touchNotes]);

  /** Lifecycle/anchor metadata onto one entry (Inbox-shaped patch in). */
  const setEntryMetaById = useCallback((entryId: string, patch: Partial<InboxMeta>, what: string) => {
    const found = locateEntry(entryId);
    if (!found) return;
    const { entry } = found;
    const api = found.scope === "log" ? found.api : entry.entityApi;
    let anchor = entry.anchor;
    let fingerprint = entry.fingerprint;
    let anchorFacts = entry.anchorFacts;
    if (patch.anchor && patch.anchor.type !== "canvas" && api) {
      anchor = patch.anchor;
      const baseline = baselineFor(api, patch.anchor);
      if (baseline) {
        fingerprint = baseline.fingerprint;
        anchorFacts = baseline.anchorFacts;
      }
    } else if (patch.anchor) {
      anchor = patch.anchor;
    }
    if (found.scope === "log" && !fingerprint && api) {
      const baseAnchor = anchor && anchor.type !== "canvas" ? anchor : { type: "entity" as const, id: api };
      const baseline = baselineFor(api, baseAnchor);
      if (baseline) {
        fingerprint = baseline.fingerprint;
        anchorFacts = baseline.anchorFacts;
      }
    }
    const next: Partial<CanvasTodo> = {
      ...(patch.kind ? { kind: patch.kind } : {}),
      ...(patch.status ? { status: patch.status === "resolved" ? ("done" as const) : patch.status } : {}),
      ...(patch.owner !== undefined ? { owner: patch.owner, assignee: patch.owner } : {}),
      ...(patch.team !== undefined ? { team: patch.team } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
      ...(patch.resolution !== undefined ? { resolution: patch.resolution } : {}),
      ...(patch.decisionState !== undefined ? { decisionState: patch.decisionState } : {}),
      ...(anchor ? { anchor } : {}),
      ...(fingerprint ? { fingerprint } : {}),
      ...(anchorFacts ? { anchorFacts } : {}),
    };
    patchEntryById(entryId, next, what);
  }, [locateEntry, baselineFor, patchEntryById]);


  const setSnapshotNoteMeta = useCallback((snapshotId: string, patch: Partial<InboxMeta>, what: string) => {
    const target = snapshots.find((s) => s.id === snapshotId);
    if (!target) return;
    const baseline = patch.anchor ? baselineFor(target.root, patch.anchor) : null;
    const meta: InboxMeta = { ...(target.noteMeta ?? {}), ...patch };
    if (baseline) {
      meta.fingerprint = baseline.fingerprint;
      meta.anchorFacts = baseline.anchorFacts;
    }
    meta.history = appendHistory(meta.history, what);
    void (async () => {
      try {
        await persistSnapshot({ ...target, noteMeta: meta });
        setSnapshots(await listSnapshotsByOrg(orgDomain));
      } catch {
        setError("Couldn't save metadata (IndexedDB unavailable).");
      }
    })();
  }, [snapshots, orgDomain, baselineFor]);

  /** Compare stored baseline facts with live schema for the review UI. */
  const getAnchorReview = useCallback((item: ArchitectureInboxItem): { diffs: string[]; liveAvailable: boolean } | null => {
    const a = item.anchor;
    if (a.type !== "entity" && a.type !== "field" && a.type !== "relationship") return null;
    const facts = item.anchorFacts;
    if (!facts) return { diffs: [], liveAvailable: false };
    if (facts.kind === "field") {
      const dot = a.id.indexOf(".");
      const d = dot > 0 ? describes.get(a.id.slice(0, dot)) : undefined;
      const field = d?.fields.find((f) => f.name === (dot > 0 ? a.id.slice(dot + 1) : a.id));
      if (!field) return { diffs: ["Anchor target no longer exists in the live schema."], liveAvailable: false };
      return {
        liveAvailable: true,
        diffs: diffFieldFacts(facts, {
          name: field.name, type: field.type,
          required: !field.nillable && !field.defaultedOnCreate,
          referenceTo: field.referenceTo ?? [], label: field.label,
        }),
      };
    }
    const d = describes.get(a.id);
    if (!d) return { diffs: ["Anchor target no longer exists in the live schema."], liveAvailable: false };
    return {
      liveAvailable: true,
      diffs: diffEntityFacts(facts, {
        apiName: a.id, fieldCount: d.fields.length,
        fieldNames: d.fields.map((f) => f.name),
        childNames: [...new Set((d.childRelationships ?? []).map((r) => r.childSObject).filter(Boolean))],
      }),
    };
  }, [describes]);

  /** Accept the live schema as the new baseline (explicit architect action). */
  const acceptAnchorReview = useCallback((id: string) => {
    const baselineOf = (api: string, anchor: InboxAnchor) => baselineFor(api, anchor);
    if (id === "live-canvas") return;
    if (id.startsWith("live-entry-")) {
      const found = locateEntry(id.slice("live-entry-".length));
      if (!found || found.scope !== "log") return;
      const anchor = found.entry.anchor ?? { type: "entity" as const, id: found.api };
      const baseline = baselineOf(found.api, anchor);
      if (!baseline) return;
      setEntryMetaById(found.entry.id, { fingerprint: baseline.fingerprint, anchorFacts: baseline.anchorFacts }, "Anchor reviewed - new baseline accepted");
      return;
    }
    if (id.startsWith("snap-")) {
      const s = snapshots.find((x) => x.id === id.slice(5));
      if (!s) return;
      const anchor = s.noteMeta?.anchor ?? { type: "canvas" as const, id: s.id };
      if (anchor.type === "canvas") return;
      const baseline = baselineOf(s.root, anchor);
      if (!baseline) return;
      setSnapshotNoteMeta(s.id, { fingerprint: baseline.fingerprint, anchorFacts: baseline.anchorFacts }, "Anchor reviewed - new baseline accepted");
    }
  }, [locateEntry, snapshots, baselineFor, setEntryMetaById, setSnapshotNoteMeta]);

  // Every open row everywhere (any kind, every scope): the one count
  // behind the panel badge, the pencil dots and the header indicator.
  const openTodos = useMemo(
    () =>
      Object.entries(entityLog)
        .flatMap(([api, rows]) =>
          rows.filter((r) => r.status !== "done").map((entry) => ({ api, entry }) as const)
        )
        .sort((a, b) => b.entry.updatedAt - a.entry.updatedAt),
    [entityLog]
  );
  const openTodoCount = openTodos.length;

  const customSet = useMemo(() => {
    const s = new Set<string>();
    for (const o of objects) if (o.custom) s.add(o.name);
    return s;
  }, [objects]);

  const isCustomName = useCallback(
    (apiName: string) => customSet.has(apiName) || apiName.endsWith("__c"),
    [customSet]
  );

  // Visible describes: filters hide without deleting (manual eyes, std/custom, system)
  // Hide-system honors the modal allow-list: explicitly allowed names stay.
  const visibleDescribes = useMemo(() => {
    const out = new Map<string, SalesforceDescribeResult>();
    for (const [name, d] of describes) {
      if (name === rootName) {
        out.set(name, d);
        continue;
      }
      if (hideSystem && isEffectivelyHidden(name, d.custom, systemAllow)) continue;
      if (filterMode === "standard" && isCustomName(name)) continue;
      if (filterMode === "custom" && !isCustomName(name)) continue;
      if (filterMode === "manual" && hiddenIds.has(name)) continue;
      // Session-only tag filter in Hide mode drops non-matching nodes so the
      // layout rebalances; Dim mode keeps every node and dims instead (below).
      if (tagMode === "hide" && !nodeMatchesTagFilter(nodeTags[name] ?? [], tagFilter)) continue;
      out.set(name, d);
    }
    return out;
  }, [describes, rootName, hideSystem, systemAllow, filterMode, hiddenIds, isCustomName, tagMode, tagFilter, nodeTags]);

  // Popover values come from live describes - drop it if metadata changes underneath
  useEffect(() => {
    setPopover(null);
  }, [describes]);

  const filteredObjects = useMemo(
    () => rankObjects(objects, rootSearch, 80),
    [objects, rootSearch]
  );

  // Clean re-root (shared by Graph + ERD): the new root shows ITS full
  // neighborhood like day one - stale expansions, dismissals, design set
  // and family state from the old root do not leak across. rootName is one
  // shared state, so re-rooting either view re-roots both. Lives up here so
  // the element memos below can inject it.
  const makeRoot = useCallback((apiName: string) => {
    if (!describes.has(apiName) || apiName === rootName) return;
    setRootName(apiName);
    setFocusName(apiName);
    setSpot(null);
    setGraphSelected(apiName);
    setExpanded(new Map());
    setDismissedIds(new Set());
    setDesignIds(new Set());
    setFamilyFor(null);
    setFamily(null);
    setNotice(`${apiName} is now the root - showing its full neighborhood in Graph + ERD.`);
  }, [describes, rootName]);

  const openRecordTypes = useCallback(
    (
      nodeId: string,
      anchor: { x: number; y: number; width: number; height: number }
    ) => {
      const d = describes.get(nodeId);
      if (!d) return;
      setRtPopover({
        apiName: nodeId,
        nodeLabel: d.label ?? nodeId,
        recordTypes: d.recordTypeInfos ?? [],
        x: anchor.x,
        y: anchor.y,
      });
    },
    [describes]
  );

  // Per-entity pull (ERD box icons): opens the discovery picker scoped to
  // THAT entity's parents or direct children, tabbed Custom vs Standard.
  // The architect ticks one, some, or all across both tabs; links draw
  // automatically where both ends land. Always opens - even empty or
  // fully-pulled families read as a directory, with on-canvas rows
  // hopping the viewport on ⌖ click.
  const showCustomPull = useCallback((api: string, dir: "parents" | "children") => {
    if (busy) return;
    const d = describes.get(api);
    if (!d) return;
    const toCandidates = (links: { target: string; via: string; kind: "lookup" | "md" }[]): DiscoverCandidate[] =>
      links.map((l) => ({
        apiName: l.target,
        label: labels.get(l.target) ?? l.target,
        custom: isCustomName(l.target),
        group: dir === "parents" ? "parent" : "child",
        via: l.via,
        kind: l.kind,
        onCanvas: describes.has(l.target),
        system: isSystemObject(l.target, isCustomName(l.target)),
      }));
    const custom = toCandidates(dir === "parents" ? customParentLinks(d) : customChildLinks(d));
    const standard = toCandidates(dir === "parents" ? standardParentLinks(d) : standardChildLinks(d));
    const noun = dir === "parents" ? "lookups" : "children";
    setPicker({
      mode: dir === "parents" ? "custom-parents" : "custom-children",
      target: api,
      title: `Pull ${dir} of ${api}`,
      subtitle: `${custom.length} custom · ${standard.length} standard ${noun} - tick one, some, or all`,
      candidates: custom,
      standardCandidates: standard,
      emptyMessage: `No custom ${dir} linked with ${api} - only custom (__c) lookup fields qualify.`,
      standardEmptyMessage: `No standard ${dir} linked with ${api} - audit lookups and platform plumbing never qualify.`,
    });
  }, [busy, describes, labels, isCustomName]);

  // ERD box table icon: every field of THAT entity as a DB-level table
  // (Label | API Name | Data Type | Description | Required Y/N) - HTML for
  // Teams/Docs, TSV fallback. Resolves true so the box can flash its check.
  const copyFieldTable = useCallback(async (api: string): Promise<boolean> => {
    const d = describes.get(api);
    if (!d || d.fields.length === 0) {
      setNotice(`${api} has no fields to copy.`);
      return false;
    }
    const { html, text } = buildFieldCopyTable(
      d.fields.map((f) => ({
        label: f.label,
        name: f.name,
        type: f.type,
        description: f.inlineHelpText ?? "",
        required: !f.nillable && !f.defaultedOnCreate,
      })),
    );
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
    } catch {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return false;
      }
    }
    setNotice(`${d.fields.length} ${d.label} fields copied as a Label | API Name | Type | Description | Required table - paste into Teams.`);
    return true;
  }, [describes]);

  // Sibling icon, live-data only: every field PLUS the visualized record's
  // values as a Label | API Name | Value table. Refuses with a notice when
  // no record is aboard, so the node only offers it at recordState live.
  const copyFieldDataTable = useCallback(async (api: string): Promise<boolean> => {
    const d = describes.get(api);
    if (!d || d.fields.length === 0) {
      setNotice(`${api} has no fields to copy.`);
      return false;
    }
    const values = recordNodeData(api).recordValues;
    if (!values) {
      setNotice(`${api} has no record data aboard - walk a record first.`);
      return false;
    }
    const { html, text } = buildFieldDataCopyTable(d.fields.map((f) => ({ label: f.label, name: f.name, value: values[f.name] })));
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
    } catch {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        return false;
      }
    }
    setNotice(`${d.fields.length} ${d.label} fields + record values copied as a Label | API Name | Value table - paste into Teams.`);
    return true;
  }, [describes, recordNodeData]);

  // ERD toolbar: the whole canvas as a client-ready field dictionary -
  // one sheet per object plus every relationship on a single sheet.
  const exportDictionary = useCallback(async () => {
    if (describes.size === 0) {
      setNotice("Nothing on canvas to export yet.");
      return;
    }
    try {
      const org = (orgDomain ?? "").replace(/^https?:\/\//, "").split(".")[0] || "org";
      await downloadFieldDictionary(describes.values(), `${org}-field-dictionary.xlsx`, { org: orgDomain ?? undefined });
      setNotice(`Field dictionary downloaded - ${describes.size} objects.`);
    } catch {
      setNotice("Dictionary export failed - try again.");
    }
  }, [describes, orgDomain]);

  // Record-type popover: picklist x record-type availability matrix.
  // Tooling lists the record types, UI API resolves per-RT values per
  // field; unreachable record types are skipped and named, never blank.
  const exportPicklistMatrix = useCallback(async (api: string) => {
    const d = describes.get(api);
    if (!d) return;
    const fields = d.fields.filter(
      (f) => (f.type === "picklist" || f.type === "multipicklist") && f.picklistValues.length > 0,
    );
    if (fields.length === 0) {
      setNotice(`${api} has no picklist fields.`);
      return;
    }
    const token = getToken();
    if (!token) {
      setNotice("Session token unavailable. Please reconnect.");
      return;
    }
    const get = async <T,>(path: string): Promise<T> => {
      const response = await apiFetch("/api/salesforce/rest", {
        instanceUrl, token, scope: "org", method: "GET", path, auth: { type: "bearer", token },
      });
      const data = (await response.json()) as { success?: boolean; status?: number; body?: unknown; error?: string };
      if (!response.ok || data.success === false) {
        throw new Error(typeof data.error === "string" && data.error ? data.error : `Request failed (${data.status ?? response.status}).`);
      }
      return data.body as T;
    };
    try {
      const rtRows = await get<{ records?: RecordTypeSummary[] }>(toolingQueryPath(apiVersion, recordTypeListQuery(api)));
      const summaries = (rtRows.records ?? []).filter((r) => r && typeof r.id === "string" && r.id);
      if (summaries.length === 0) {
        setNotice(`${api} has no record types.`);
        return;
      }
      const rts: MatrixRt[] = [];
      const skipped: string[] = [];
      await Promise.all(
        summaries.map(async (rt) => {
          if (isMasterRecordType(rt.id)) {
            rts.push({ id: rt.id, name: rt.name, developerName: rt.developerName, master: true, available: new Map() });
            return;
          }
          try {
            const payload = await get<unknown>(uiApiAvailabilityPath(apiVersion, api, rt.id));
            rts.push({
              id: rt.id, name: rt.name, developerName: rt.developerName, master: false,
              available: new Map(fields.map((f) => [f.name.toLowerCase(), parseAvailability(payload, f.name)])),
            });
          } catch {
            skipped.push(rt.name);
          }
        }),
      );
      // Master first, then alphabetical - stable column order.
      rts.sort((a, b) => Number(b.master) - Number(a.master) || a.name.localeCompare(b.name));
      if (rts.length === 0) {
        setNotice("Record type availability is unreachable right now.");
        return;
      }
      const matrixFields: MatrixField[] = fields.map((f) => ({
        label: f.label,
        apiName: f.name,
        values: f.picklistValues.filter((p) => p.active).map((p) => ({ label: p.label, value: p.value })),
      }));
      await downloadPicklistMatrix(d.label || api, matrixFields, rts, `${api.toLowerCase()}-picklist-matrix.xlsx`);
      setNotice(
        skipped.length > 0
          ? `Matrix downloaded - skipped ${skipped.length} unreachable record type${skipped.length === 1 ? "" : "s"} (${skipped.join(", ")}).`
          : `Picklist matrix downloaded for ${api}.`,
      );
    } catch {
      setNotice("Matrix export failed - try again.");
    }
  }, [describes, getToken, instanceUrl, apiVersion]);

  const baseElements: { nodes: Node<ErdNodeData>[]; edges: Edge[] } = useMemo(() => {    if (visibleDescribes.size === 0 || !rootName) return { nodes: [], edges: [] };
    // Tag Hide mode rebalances: drop saved pins so dagre re-plans the survivors.
    const tagHideActive = tagMode === "hide" && tagFilter.size > 0;
    const built = buildErdElements(visibleDescribes, labels, rootName, spot, tagHideActive ? undefined : enforced);
    const describedSet = new Set(visibleDescribes.keys());
    return {
      edges: built.edges,
      nodes: built.nodes.map((n) => {
        const d = describes.get(n.id);
        const shown = (d?.childRelationships ?? []).filter(
          (r) => r.relationshipName && describedSet.has(r.childSObject)
        ).length;
        const rows = entityLog[n.id] ?? [];
        const ids = nodeTags[n.id] ?? [];
        return {
          ...n,
          data: {
            ...n.data,
            shownChildren: shown,
            // Resolved user tags (persisted refs) + session-only Dim filtering.
            tags: ids.map((id) => tagById.get(id)).filter((t): t is ErdTag => !!t),
            dimmed: n.data.dimmed || (tagMode === "dim" && !nodeMatchesTagFilter(ids, tagFilter)),
            onTagsClick: (api: string) => setTagPicker(api),
            onRemoveClick: (api: string) => setConfirmRemove(api),
            // Any logged row lights the pencil - title-only tasks count,
            // red when an open task waits, bronze for notes/decisions.
            hasNote: rows.length > 0,
            hasTodo: rows.some((r) => (r.kind ?? "task") === "task" && r.status !== "done"),
            onNoteClick: openEntityNote,
            onAutomationClick: openAutomation,
            automationTotal: automationTotals[n.id] ?? null,
            onMakeRoot: makeRoot,
            onRecordTypesClick: openRecordTypes,
            customParentCount: d ? customParentTargets(d).length : 0,
            customChildCount: d ? customChildTargets(d).length : 0,
            standardParentCount: d ? standardParentTargets(d).length : 0,
            standardChildCount: d ? standardChildTargets(d).length : 0,
            onPullCustomParents: (target: string) => showCustomPull(target, "parents"),
            onPullCustomChildren: (target: string) => showCustomPull(target, "children"),
            onCopyFieldTable: copyFieldTable,
            onCopyFieldDataTable: copyFieldDataTable,
          },
        };
      }),
    };
  }, [visibleDescribes, describes, labels, rootName, spot, enforced, entityLog, openEntityNote, openAutomation, automationTotals, makeRoot, openRecordTypes, showCustomPull, copyFieldTable, copyFieldDataTable, tagById, nodeTags, tagFilter, tagMode]);

  // Graph default = FULL 1-level neighborhood (parents left, children right),
  // lite previews included - this is the intent of graph view. Family
  // expansion (Discover of <node>) extends generations outward per node.
  // Manual shows only eye-kept ones. Graph NEVER narrows to the ERD canvas:
  // it is the scouting view; ERD is the curated view.
  // Tombstones (removedIds) never render anywhere; dismissedIds hide whole
  // bubbles from the graph only (quick remove) while ERD keeps them;
  // dismissedEdges hide single LINKS (family uncheck) keeping both bubbles.
  const [dismissedEdges, setDismissedEdges] = useState<Set<string>>(new Set());
  const graphElements = useMemo(() => {
    if (view !== "graph" || !rootName) return { nodes: [], edges: [], overflow: 0, extended: 0 };
    const root = describes.get(rootName);
    if (!root) return { nodes: [], edges: [], overflow: 0, extended: 0 };
    const canvasNames = new Set(describes.keys());
    const passFilters = (n: GraphNeighbor) => {
      if (removedIds.has(n.apiName) || dismissedIds.has(n.apiName)) return false;
      if (hideSystem && systemHidden(n)) return false;
      if (filterMode === "standard" && n.custom) return false;
      if (filterMode === "custom" && !n.custom) return false;
      if (filterMode === "manual" && hiddenIds.has(n.apiName)) return false;
      return true;
    };
    const level1 = rootNeighbors(root, labels, isCustomName).filter(passFilters);
    // Family generations: expansion rows hang off their source node.
    // NOTE: no apiName dedupe here - a row whose name is already a level-1
    // bubble MUST still reach the builder: mesh mode draws the extra edge
    // (Account→D&B alongside Lead→D&B), linear mode duplicates the bubble.
    // Dropping such rows is what silently killed + in testing.
    const extra: GraphNeighbor[] = [];
    for (const [, list] of expanded) {
      for (const n of list) {
        if (!passFilters(n)) continue;
        if (designMode && !designIds.has(n.apiName)) continue;
        extra.push(n);
      }
    }
    const shown1 = designMode ? level1.filter((n) => designIds.has(n.apiName)) : level1;
    const built = buildGraphElements(root, [...shown1, ...extra], canvasNames, spot, graphEnforced, familyMode);
    // Stamp entity-note flags so bubbles show the marker dot.
    const stampNotes = <T extends { data: { apiName: string } }>(list: T[]): T[] =>
      list.map((n) => {
        const rows = entityLog[n.data.apiName] ?? [];
        if (!rows.some((r) => (r.body ?? "").trim())) return n;
        return { ...n, data: { ...n.data, hasNote: true, hasTodo: rows.some((r) => (r.kind ?? "task") === "task" && r.status !== "done") } };
      });
    if (dismissedEdges.size === 0) {
      return { ...built, nodes: stampNotes(built.nodes) };
    }
    // Hide dismissed LINKS; then prune x: bubbles left linkless (level-1 fan
    // always stays - it is the neighborhood, not a link).
    const edges = built.edges.filter((e) => !dismissedEdges.has(String(e.id)));
    const linked = new Set<string>();
    for (const e of edges) {
      linked.add(String(e.source));
      linked.add(String(e.target));
    }
    const nodes = stampNotes(built.nodes.filter((n) => !n.id.startsWith("x:") || linked.has(n.id)));
    return { nodes, edges, overflow: built.overflow, extended: nodes.filter((n) => n.id.startsWith("x:")).length };
  }, [view, rootName, describes, labels, isCustomName, hideSystem, filterMode, hiddenIds, removedIds, dismissedIds, dismissedEdges, designMode, designIds, spot, graphEnforced, expanded, familyMode, entityLog, systemHidden]);

  // The review list behind Hide-system: every swept neighbor with its
  // reason, label and custom flag. The modal allow-lists from this list.
  // (systemHidden itself is defined once, up with the filter state.)
  const systemHiddenList = useMemo(() => {
    if (!rootName) return [];
    const root = describes.get(rootName);
    if (!root) return [];
    const seen = new Set<string>();
    const out: { apiName: string; label: string; reason: string; custom: boolean }[] = [];
    const consider = (n: { apiName: string; role: "parent" | "child"; via: string; custom: boolean }) => {
      if (n.apiName === rootName || seen.has(n.apiName)) return;
      seen.add(n.apiName);
      const reason = systemHidden(n)
        ? (systemReason({ apiName: n.apiName, role: n.role, via: n.via, custom: n.custom }) ?? "system")
        : null;
      if (!reason) return;
      out.push({ apiName: n.apiName, label: labels.get(n.apiName) ?? n.apiName, reason, custom: n.custom });
    };
    for (const n of rootNeighbors(root, labels, isCustomName)) consider(n);
    for (const [, list] of expanded) for (const n of list) consider(n);
    return out.sort((a, b) => (a.reason < b.reason ? -1 : 1));
  }, [rootName, describes, labels, isCustomName, expanded, systemHidden]);

  const systemHiddenCount = systemHiddenList.filter((r) => !systemAllow.has(r.apiName)).length;

  const neighborMap = useMemo(() => {
    const root = describes.get(rootName);
    if (!root) return new Map<string, ReturnType<typeof rootNeighbors>[number]>();
    const m = new Map<string, ReturnType<typeof rootNeighbors>[number]>();
    for (const n of rootNeighbors(root, labels, isCustomName)) m.set(n.apiName, n);
    return m;
  }, [describes, rootName, labels, isCustomName]);

  // Truthful ticks: for any node, which neighbor links are actually drawn.
  // Map neighbor apiName -> drawn edge ids touching this node. Unchecking a
  // row dismisses exactly those edges (link dies, bubbles survive); the
  // x: rows stay so re-checking restores instantly without refetch.
  const linksOf = useMemo(() => {
    const idToApi = new Map<string, string>();
    for (const n of graphElements.nodes) {
      const api = String((n.data as { apiName?: string } | undefined)?.apiName ?? "");
      if (api) idToApi.set(n.id, api);
    }
    const out = new Map<string, Map<string, string[]>>();
    for (const e of graphElements.edges) {
      const s = idToApi.get(String(e.source));
      const t = idToApi.get(String(e.target));
      if (!s || !t || s === t) continue;
      if (!out.has(s)) out.set(s, new Map());
      if (!out.has(t)) out.set(t, new Map());
      const sm = out.get(s)!;
      const tm = out.get(t)!;
      if (!sm.has(t)) sm.set(t, []);
      if (!tm.has(s)) tm.set(s, []);
      sm.get(t)!.push(String(e.id));
      tm.get(s)!.push(String(e.id));
    }
    return out;
  }, [graphElements]);

  const detail = useMemo(() => {
    if (!graphSelected || view !== "graph") return null;
    const d = describes.get(graphSelected);
    if (d) {
      const parents = [...new Set((d.fields ?? []).flatMap((f) => f.referenceTo ?? []))];
      const kids = [
        ...new Set(
          (d.childRelationships ?? [])
            .filter((r) => r.relationshipName)
            .map((r) => r.childSObject)
        ),
      ];
      return { kind: "loaded" as const, d, parents, kids };
    }
    const n = neighborMap.get(graphSelected);
    if (!n) return null;
    return { kind: "lite" as const, n };
  }, [graphSelected, view, describes, neighborMap]);

  // In-flight describe de-dupe: concurrent callers for the same object
  // share one promise. Combined with the describes-map check below, reopening
  // a family panel never refires /describe for known objects.
  const inflight = useRef(new Map<string, Promise<SalesforceDescribeResult>>());

  const fetchDescribe = useCallback(
    async (objectName: string): Promise<SalesforceDescribeResult> => {
      const hit = inflight.current.get(objectName);
      if (hit) return hit;
      const run = (async () => {
        const token = getToken();
        if (!token) throw new Error("Session token unavailable. Please reconnect.");
        const response = await apiFetch("/api/salesforce/describe", { instanceUrl, token, apiVersion, objectName });
        const data = (await response.json()) as SalesforceDescribeResult & { error?: string };
        if (!response.ok) {
          const message =
            typeof (data as unknown as { error?: unknown }).error === "string"
              ? (data as unknown as { error: string }).error
              : `Describe failed for ${objectName}`;
          if (isSessionExpiredMessage(message)) onSessionExpired?.();
          throw new Error(message);
        }
        return data;
      })();
      inflight.current.set(objectName, run);
      try {
        return await run;
      } finally {
        inflight.current.delete(objectName);
      }
    },
    [instanceUrl, apiVersion, getToken, onSessionExpired]
  );

  /** Cached describe: describes-map first (no network), then live fetch. */
  const describeCached = useCallback(
    async (objectName: string): Promise<SalesforceDescribeResult | null> => {
      const known = describes.get(objectName);
      if (known) return known;
      try {
        return await fetchDescribe(objectName);
      } catch {
        return null;
      }
    },
    [describes, fetchDescribe]
  );

  const mergeDescribes = useCallback((fresh: SalesforceDescribeResult[]) => {
    if (fresh.length === 0) return;
    setDescribes((prev) => {
      const next = new Map(prev);
      for (const d of fresh) next.set(d.name, d);
      return next;
    });
  }, []);

  /** Lookup picker search for the edit modal: display field per object,
   * Group (queues) included with Type context. Throws for the modal to show.
   * Picker targets often aren't on the canvas, so their describe resolves
   * through the side cache - never merged (merging would pop boxes). */
  const lookupDescribeCacheRef = useRef(new Map<string, SalesforceDescribeResult | null>());
  const searchLookupRecords = useCallback(async (
    apiName: string,
    query: string,
  ): Promise<LookupHit[]> => {
    let d: SalesforceDescribeResult | undefined = describes.get(apiName);
    if (!d && !lookupDescribeCacheRef.current.has(apiName)) {
      const fetched = await describeCached(apiName);
      lookupDescribeCacheRef.current.set(apiName, fetched);
      d = fetched ?? undefined;
    } else if (!d) {
      d = lookupDescribeCacheRef.current.get(apiName) ?? undefined;
    }
    const display = apiName === "Group"
      ? "Name"
      : keyFieldFor((d?.fields ?? []).map((f) => ({ name: f.name, type: f.type, referenceTo: f.referenceTo ?? [], nameField: f.nameField })));
    const rows = await runRecordQuery(buildLookupSearchQuery(apiName, display, query));
    const hits: LookupHit[] = [];
    for (const r of rows) {
      if (typeof r.Id !== "string" || !r.Id) continue;
      const name = apiName === "Group"
        ? (queueLabelFromRow(r) ?? r.Id)
        : (display && typeof r[display] === "string" && r[display]
          ? (r[display] as string)
          : r.Id);
      hits.push({
        id: r.Id,
        name,
        extra: apiName === "Group" && typeof r.Type === "string" ? r.Type : undefined,
      });
    }
    return hits;
  }, [describes, runRecordQuery, describeCached]);

  /**
   * Resolve one lookup Id to its human label (Name / orderNumber-style key).
   * Aboard rows first (free), else one deliberate single-row query. Null
   * when the target has no text key or the row is hidden - the caller then
   * shows the raw Id. Never throws.
   */
  const resolveLookupLabel = useCallback(async (
    apiName: string,
    id: string,
  ): Promise<string | null> => {
    const clean = id.trim();
    if (!clean) return null;
    const aboard = recordStoreRef.current.singles.get(apiName)?.get(clean)?.fields;
    if (aboard) {
      const d = describes.get(apiName);
      if (apiName === "Group") return queueLabelFromRow(aboard as Record<string, unknown> | undefined);
      const key = d ? keyFieldFor(d.fields) : null;
      const label = key ? labelFromRow(aboard as Record<string, unknown> | undefined, key) : null;
      if (label) return label;
    }
    try {
      let d: SalesforceDescribeResult | undefined = describes.get(apiName);
      if (!d && !lookupDescribeCacheRef.current.has(apiName)) {
        const fetched = await describeCached(apiName);
        lookupDescribeCacheRef.current.set(apiName, fetched);
        d = fetched ?? undefined;
      } else if (!d) {
        d = lookupDescribeCacheRef.current.get(apiName) ?? undefined;
      }
      if (apiName === "Group") {
        const rows = await runRecordQuery(
          `SELECT Id, Name, Type FROM Group WHERE Id = '${escapeSoqlString(clean)}' LIMIT 1`
        );
        return queueLabelFromRow(rows[0]) ?? null;
      }
      const key = d ? keyFieldFor(d.fields) : null;
      if (!key) return null;
      const rows = await runRecordQuery(buildLabelQuery(apiName, key, clean));
      return labelFromRow(rows[0], key);
    } catch {
      return null;
    }
  }, [describes, runRecordQuery, describeCached]);

  // ── Canvas autosave (per org, IndexedDB): full describes + curation persist
  // as the live layer under manual snapshots. Restored as-is on the next
  // connect to the same org - zero API calls, no route-hop snapshots.
  // Saves queue on change; empty mounts stay silent; Clear canvas deletes.
  // ── Schema authoring (Author mode): deploy queue, sketches, dialogs ──
  // Writes go through the Tooling API via the existing REST proxy, one
  // change at a time. Success re-describes from the org (canvas shows
  // server truth); failure rolls sketches back and keeps the error.
  const isProductionOrg = useMemo(
    () => instanceUrl !== "" && !looksLikeSandbox(instanceUrl),
    [instanceUrl]
  );

  const authorDeploying = useMemo(
    () => authorQueue.filter((c) => c.status === "deploying"),
    [authorQueue]
  );

  const authorPendingApis = useMemo(
    () => new Set(authorDeploying.map((c) => c.targetApi)),
    [authorDeploying]
  );

  /** Pending field rows per object API, read from deploying change bodies. */
  const sketchRowsByApi = useMemo(() => {
    const m = new Map<
      string,
      { fieldApi: string; designType: DesignFieldType; required: boolean; referenceTo?: string }[]
    >();
    for (const c of authorDeploying) {
      if (c.kind === "object") continue;
      const meta = (c.body.Metadata ?? {}) as {
        fullName?: unknown;
        type?: unknown;
        required?: unknown;
        referenceTo?: unknown;
      };
      const full = typeof meta.fullName === "string" ? meta.fullName : "";
      const fieldApi = full.includes(".") ? full.split(".").slice(1).join(".") : full;
      if (!fieldApi) continue;
      const list = m.get(c.targetApi) ?? [];
      list.push({
        fieldApi,
        designType: (typeof meta.type === "string" ? meta.type : "Text") as DesignFieldType,
        required: meta.required === true,
        referenceTo: typeof meta.referenceTo === "string" ? meta.referenceTo : undefined,
      });
      m.set(c.targetApi, list);
    }
    return m;
  }, [authorDeploying]);

  const withSketchRows = useCallback(
    (apiName: string, rows: ErdFieldRow[]): ErdFieldRow[] => {
      const extra = sketchRowsByApi.get(apiName);
      if (!extra || extra.length === 0) return rows;
      return [
        ...rows,
        ...extra.map((s) => ({
          name: s.fieldApi,
          label: s.fieldApi,
          type: describeTypeFor(s.designType),
          length: 0,
          precision: 0,
          scale: 0,
          description: null,
          unique: false,
          externalId: false,
          calculated: false,
          updateable: true,
          isId: false,
          isName: false,
          refs: s.referenceTo ? [s.referenceTo] : [],
          required: s.required,
          pickValues: [],
          pending: true,
        })),
      ];
    },
    [sketchRowsByApi]
  );

  /** Pending relationship edges (parent → child per canvas convention). */
  const authorEdges = useMemo((): Edge[] => {
    const sketches: Edge[] = [];
    for (const c of authorDeploying) {
      if (c.kind !== "relationship") continue;
      const meta = (c.body.Metadata ?? {}) as { fullName?: unknown; referenceTo?: unknown; type?: unknown };
      const parent = typeof meta.referenceTo === "string" ? meta.referenceTo : "";
      const full = typeof meta.fullName === "string" ? meta.fullName : "";
      const fieldApi = full.includes(".") ? full.split(".").slice(1).join(".") : full;
      if (!parent || !fieldApi) continue;
      sketches.push({
        id: `author-${c.id}`,
        source: parent,
        target: c.targetApi,
        sourceHandle: parentExitHandleId,
        targetHandle: childEntryHandleId,
        label: fieldApi,
        type: "erdEdge",
        data: {
          kind: meta.type === "MasterDetail" ? "md" : "lookup",
          pending: true,
        } as ErdEdgeData,
      });
    }
    const withSpot = baseElements.edges.map((e) =>
      e.id === spotEdgeId ? { ...e, selected: true } : e
    );
    return [...withSpot, ...sketches];
  }, [authorDeploying, baseElements.edges, spotEdgeId]);

  const openAuthorField = useCallback((apiName: string) => {
    setAuthorDialog({ kind: "field", objectApi: apiName });
  }, []);

  const handleAuthorConnect = useCallback(
    (sourceApi: string, targetApi: string) => {
      if (!authorMode) return;
      // Drag source holds the new field (child); drop target is referenced (parent).
      setAuthorDialog({ kind: "relationship", childApi: sourceApi, parentApi: targetApi });
    },
    [authorMode]
  );

  const deployAuthorChange = useCallback(
    async (change: AuthorChange): Promise<boolean> => {
      setAuthorQueue((prev) =>
        prev.map((c) => (c.id === change.id ? { ...c, status: "deploying" as const, error: undefined } : c))
      );
      const token = getToken();
      if (!token) {
        setAuthorQueue((prev) =>
          prev.map((c) =>
            c.id === change.id
              ? { ...c, status: "failed" as const, error: "Session token unavailable. Please reconnect." }
              : c
          )
        );
        void logArchActivity({
          actor: activityActor.current,
          surface: "erd",
          view,
          root: rootName || undefined,
          category: "metadata",
          action: authorActivityAction(change.kind),
          target: authorActivityTarget(change.kind, change.label, change.targetApi),
          ok: false,
          message: `${change.label} blocked - session token unavailable.`,
        });
        return false;
      }
      try {
        const response = await apiFetch("/api/salesforce/rest", {
          instanceUrl,
          token,
          scope: "org",
          method: "POST",
          path: toolingCreatePath(apiVersion, change.toolingType),
          body: JSON.stringify(change.body),
          auth: { type: "bearer", token },
        });
        const data = (await response.json()) as {
          success?: boolean;
          status?: number;
          body?: unknown;
          error?: string;
        };
        if (!response.ok) {
          const message =
            typeof data.error === "string" && data.error
              ? data.error
              : parseToolingResult(data.body, false, data.status ?? response.status).message;
          if (isSessionExpiredMessage(message)) onSessionExpired?.();
          throw new Error(message);
        }
        const result = parseToolingResult(data.body, true, data.status);
        if (!result.ok) {
          if (isSessionExpiredMessage(result.message)) onSessionExpired?.();
          throw new Error(result.message);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Deploy failed.";
        setAuthorQueue((prev) =>
          prev.map((c) => (c.id === change.id ? { ...c, status: "failed" as const, error: message } : c))
        );
        void logArchActivity({
          actor: activityActor.current,
          surface: "erd",
          view,
          root: rootName || undefined,
          category: "metadata",
          action: "deploy-failed",
          target: authorActivityTarget(change.kind, change.label, change.targetApi),
          ok: false,
          message: `${change.label} failed - ${message}`.slice(0, 500),
        });
        // Object sketches roll back; field/relationship sketches derive from
        // the deploying queue so they vanish on their own.
        if (change.kind === "object") {
          setDescribes((prev) => {
            const cur = prev.get(change.targetApi) as unknown as
              | { __authorSketch?: boolean }
              | undefined;
            if (!cur?.__authorSketch) return prev;
            const next = new Map(prev);
            next.delete(change.targetApi);
            return next;
          });
        }
        setNotice(`Deploy failed: ${message}`);
        return false;
      }
      setAuthorQueue((prev) => prev.filter((c) => c.id !== change.id));
      try {
        const fresh = await fetchDescribe(change.targetApi);
        mergeDescribes([fresh]);
      } catch {
        /* describe refresh failed - canvas keeps prior data */
      }
      setNotice(`${change.label} deployed - canvas refreshed from the org.`);
      void logArchActivity({
        actor: activityActor.current,
        surface: "erd",
        view,
        root: rootName || undefined,
        category: "metadata",
        action: authorActivityAction(change.kind),
        target: authorActivityTarget(change.kind, change.label, change.targetApi),
        ok: true,
        message: `${change.label} deployed to the org.`,
      });
      return true;
    },
    [instanceUrl, apiVersion, getToken, onSessionExpired, fetchDescribe, mergeDescribes, view, rootName]
  );

  const [pendingProdField, setPendingProdField] = useState<{ draft: FieldDraft; childApi: string } | null>(null);

  const fireAuthorField = useCallback(
    async (draft: FieldDraft, childApi: string) => {
      const isRel = draft.type === "Lookup" || draft.type === "MasterDetail";
      const label = `${childApi}.${draft.apiName.trim()} (${draft.type})`;
      const change: AuthorChange = {
        id: newAuthorId(),
        kind: isRel ? "relationship" : "field",
        status: "deploying",
        label,
        targetApi: childApi,
        toolingType: "CustomField",
        body: buildCustomFieldBody(draft, childApi),
      };
      setAuthorQueue((prev) => [...prev, change]);
      setAuthorDialog(null);
      await deployAuthorChange(change);
    },
    [deployAuthorChange]
  );

  const submitAuthorField = useCallback(
    async (draft: FieldDraft, childApi: string) => {
      if (isProductionOrg) {
        setPendingProdField({ draft, childApi });
        return;
      }
      await fireAuthorField(draft, childApi);
    },
    [isProductionOrg, fireAuthorField]
  );

  const [pendingProdObject, setPendingProdObject] = useState<ObjectDraft | null>(null);

  const fireAuthorObject = useCallback(
    async (draft: ObjectDraft) => {
      const api = draft.apiName.trim();
      if (describes.has(api)) {
        setNotice(`${api} is already on the canvas - find it in Discover.`);
        setAuthorDialog(null);
        return;
      }
      // Optimistic sketch through the normal pipeline; replaced by the live
      // describe on success, rolled back on failure. Never autosaved.
      setDescribes((prev) => {
        const next = new Map(prev);
        next.set(api, syntheticDescribeForObject(draft) as unknown as SalesforceDescribeResult);
        return next;
      });
      if (filterMode === "standard") setFilterMode("all");
      const change: AuthorChange = {
        id: newAuthorId(),
        kind: "object",
        status: "deploying",
        label: `${api} (custom object)`,
        targetApi: api,
        toolingType: "CustomObject",
        body: buildCustomObjectBody(draft),
      };
      setAuthorQueue((prev) => [...prev, change]);
      setAuthorDialog(null);
      await deployAuthorChange(change);
    },
    [describes, filterMode, deployAuthorChange]
  );

  const submitAuthorObject = useCallback(
    async (draft: ObjectDraft) => {
      if (isProductionOrg) {
        setPendingProdObject(draft);
        return;
      }
      await fireAuthorObject(draft);
    },
    [isProductionOrg, fireAuthorObject]
  );

  const retryAuthorChange = useCallback(
    (id: string) => {
      const found = authorQueue.find((c) => c.id === id);
      if (found) void deployAuthorChange({ ...found });
    },
    [authorQueue, deployAuthorChange]
  );

  const dismissAuthorChange = useCallback((id: string) => {
    setAuthorQueue((prev) => prev.filter((c) => c.id !== id));
  }, []);

  /** Canvas objects for the relationship target picker. */
  const authorObjectOptions = useMemo(
    () => [...describes.keys()].map((name) => ({ name, label: labels.get(name) ?? name })),
    [describes, labels]
  );

  interface SchemaAutosaveData {
    rootName: string;
    describes: SalesforceDescribeResult[];
    hiddenIds: string[];
    removedIds: string[];
    dismissedIds: string[];
    focusName: string;
    graphSelected: string | null;
    view: "erd" | "graph";
    filterMode: "all" | "standard" | "custom" | "manual";
    familyMode: "mesh" | "linear";
    hideSystem: boolean;
    systemAllow: string[];
    designIds: string[];
    designMode: boolean;
    expanded: [string, GraphNeighbor[]][];
    enforced: [string, { x: number; y: number }][] | null;
    graphEnforced: [string, { x: number; y: number }][] | null;
    viewports: { erd: { x: number; y: number; zoom: number } | null; graph: { x: number; y: number; zoom: number } | null };
    /** Canvas tag registry + per-node tag refs (persisted on the project). */
    tagRegistry?: ErdTag[];
    nodeTags?: Record<string, string[]>;
  }
  const schemaRestoredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!orgKey || schemaRestoredRef.current !== orgKey) return;
    // Empty mounts stay silent: nothing to save, nothing to clobber.
    if (!rootName && describes.size === 0) return;
    queueAutosave(orgKey, "schema", {
      rootName,
      // Author sketches never persist: flagged synthetic describes are dropped.
      describes: [...describes.values()].filter(
        (d) => !(d as unknown as { __authorSketch?: boolean }).__authorSketch
      ),
      hiddenIds: [...hiddenIds],
      removedIds: [...removedIds],
      dismissedIds: [...dismissedIds],
      focusName,
      graphSelected,
      view,
      filterMode,
      familyMode,
      hideSystem,
      systemAllow: [...systemAllow],
      designIds: [...designIds],
      designMode,
      expanded: [...expanded.entries()],
      enforced: enforced ? [...enforced.entries()] : null,
      graphEnforced: graphEnforced ? [...graphEnforced.entries()] : null,
      viewports: viewports.current,
      tagRegistry,
      nodeTags,
    } satisfies SchemaAutosaveData, tabId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgKey, tabId, rootName, describes, hiddenIds, removedIds, dismissedIds, focusName, graphSelected, view, filterMode, familyMode, hideSystem, systemAllow, designIds, designMode, expanded, enforced, graphEnforced, tagRegistry, nodeTags]);

  // First-class restore: reload the autosaved canvas on demand, anytime -
  // same apply path as the automatic restore on connect.
  const applyAutosaveData = useCallback((s: SchemaAutosaveData, savedAt: number | null) => {
    if (!s || (!s.rootName && (!s.describes || s.describes.length === 0))) return false;
    if (s.describes) setDescribes(new Map(s.describes.map((d) => [d.name, d])));
    if (s.rootName) {
      setRootName(s.rootName);
      setFocusName(s.focusName || s.rootName);
    }
    if (s.graphSelected) setGraphSelected(s.graphSelected);
    if (s.view) setView(s.view);
    if (s.filterMode) setFilterMode(s.filterMode);
    if (s.familyMode) setFamilyMode(s.familyMode);
    if (typeof s.hideSystem === "boolean") setHideSystem(s.hideSystem);
    if (s.hiddenIds) setHiddenIds(new Set(s.hiddenIds));
    if (s.removedIds) setRemovedIds(new Set(s.removedIds));
    if (s.dismissedIds) setDismissedIds(new Set(s.dismissedIds));
    if (s.systemAllow) setSystemAllow(new Set(s.systemAllow));
    if (s.designIds) setDesignIds(new Set(s.designIds));
    if (typeof s.designMode === "boolean") setDesignMode(s.designMode);
    if (s.expanded) setExpanded(new Map(s.expanded));
    if (s.enforced) setEnforced(new Map(s.enforced));
    if (s.graphEnforced) setGraphEnforced(new Map(s.graphEnforced));
    if (s.viewports) viewports.current = s.viewports;
    if (s.tagRegistry) setTagRegistry(s.tagRegistry.filter((t) => t && typeof t.id === "string" && typeof t.name === "string" && typeof t.color === "string"));
    if (s.nodeTags) setNodeTags(s.nodeTags);
    const count = s.describes?.length ?? 0;
    if (count > 0 && savedAt) {
      const age = Date.now() - savedAt;
      const label = age < 60_000 ? "just now" : age < 3_600_000 ? `${Math.round(age / 60_000)}m ago` : age < 86_400_000 ? `${Math.round(age / 3_600_000)}h ago` : `${Math.round(age / 86_400_000)}d ago`;
      setNotice(`Workspace restored - canvas auto-saved ${label}. Refresh all to revalidate.`);
    }
    return true;
  }, []);

  useEffect(() => {
    if (!orgKey || objects.length === 0 || schemaRestoredRef.current === orgKey) return;
    schemaRestoredRef.current = orgKey;
    void (async () => {
      const snap = await loadAutosave<SchemaAutosaveData>(orgKey, "schema", tabId);
      if (snap) applyAutosaveData(snap.data, snap.savedAt);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgKey, objects]);

  // ── Collaboration share import (?share=): structure in, metadata resolved
  // locally, positions applied. Consumed once per id; retries cover KV's
  // propagation tail. Autosave restore (IDB) usually lands first and loses -
  // the share always wins because its fetches finish later.
  const shareConsumedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!shareId || objects.length === 0 || shareConsumedRef.current === shareId) return;
    shareConsumedRef.current = shareId;
    void (async () => {
      setError(null);
      setNotice(null);
      setBusy("Opening shared canvas…");
      try {
        let raw: unknown = null;
        let invalid = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const r = await fetch(`/api/share/${encodeURIComponent(shareId)}`);
            if (r.status === 404) {
              invalid = true;
              break;
            }
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            raw = await r.json();
            break;
          } catch {
            if (attempt < 2) await new Promise((res) => window.setTimeout(res, 1500));
          }
        }
        const s = !invalid ? validateShareStructure(raw) : null;
        if (!s) throw new Error("Share link expired or invalid.");
        const settled = await mapLimit(s.nodes, 6, async (n) => {
          try {
            return { ok: true as const, value: await fetchDescribe(n) };
          } catch {
            return { ok: false as const, name: n };
          }
        });
        const fresh = settled.filter((r) => r.ok).map((r) => r.value);
        const missing = settled.filter((r) => !r.ok).map((r) => r.name);
        if (fresh.length === 0) {
          throw new Error("None of the shared objects exist on your org - nothing to rebuild.");
        }
        const alive = new Set(fresh.map((d) => d.name));
        const root = alive.has(s.root) ? s.root : fresh[0].name;
        const enforcedEntries = Object.entries(s.positions).filter(([k]) => alive.has(k)) as [string, { x: number; y: number }][];
        applyAutosaveData({
          rootName: root,
          describes: fresh,
          hiddenIds: [],
          removedIds: [],
          dismissedIds: [],
          focusName: root,
          graphSelected: null,
          view: s.view ?? view,
          filterMode,
          familyMode,
          hideSystem,
          systemAllow: [...systemAllow],
          designIds: [],
          designMode: false,
          expanded: [],
          enforced: enforcedEntries.length > 0 ? enforcedEntries : null,
          graphEnforced: null,
          viewports: viewports.current,
        }, null);
        if (s.notes) {
          setCanvasNote(noteBodyFromMd(s.notes));
          touchNotes();
        }
        if (s.entityNotes) {
          const now = Date.now();
          setEntityLog((prev) => {
            const next = { ...prev };
            for (const [api, value] of Object.entries(s.entityNotes ?? {})) {
              const rows = Array.isArray(value)
                ? shareRowsToEntries(api, value, now)
                : migrateEntityLogValue(api, value as unknown, undefined, now);
              if (rows.length > 0) next[api] = [...(next[api] ?? []), ...rows];
            }
            return next;
          });
          touchNotes();
        }
        if (s.todos && s.todos.length > 0) {
          // Shares carry canvas rows in the todos field - land them in the
          // canvas scope with the same shape the modal writes.
          setEntityLog((prev) => ({
            ...prev,
            [CANVAS_LOG_API]: [
              ...(prev[CANVAS_LOG_API] ?? []),
              ...s.todos!.map((t) => ({ ...t, kind: t.kind ?? ("task" as const), entityApi: CANVAS_LOG_API })),
            ],
          }));
          touchNotes();
        }
        setNotice(
          `Imported shared canvas "${s.name}" (${fresh.length} objects` +
            (missing.length > 0
              ? `, ${missing.length} missing on your org: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`
              : "") +
            ")."
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not open share link.");
      } finally {
        setBusy(null);
        onShareConsumed();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shareId, objects]);

  const restoreSaved = useCallback(async () => {
    if (!orgKey || busy) return;
    setError(null);
    const snap = await loadAutosave<SchemaAutosaveData>(orgKey, "schema", tabId);
    if (!snap || !applyAutosaveData(snap.data, snap.savedAt)) {
      setNotice("No autosaved workspace for this org yet - build a canvas and it saves itself.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgKey, tabId, busy]);

  const refreshNode = useCallback(
    async (id: string) => {
      if (busy) return;
      setRefreshingIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      setError(null);
      try {
        const fresh = await fetchDescribe(id);
        mergeDescribes([fresh]);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Refresh failed for ${id}`);
      } finally {
        setRefreshingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [busy, fetchDescribe, mergeDescribes]
  );

  const openPicklist = useCallback(
    (
      nodeId: string,
      fieldName: string,
      anchor: { x: number; y: number; width: number; height: number }
    ) => {
      const d = describes.get(nodeId);
      const f = d?.fields.find((fl) => fl.name === fieldName);
      if (!f) return;
      setPopover({
        apiName: nodeId,
        nodeLabel: d?.label ?? nodeId,
        fieldName,
        fieldType: f.type,
        customField: fieldName.endsWith("__c"),
        values: (f.picklistValues ?? []).slice(0, 100).map((p) => ({
          label: p.label ?? p.value,
          value: p.value,
          active: p.active !== false,
          isDefault: !!p.defaultValue,
        })),
        x: anchor.x,
        y: anchor.y,
      });
    },
    [describes]
  );

  // Attach live callbacks + refresh spinners on top of the base elements
  const elements: { nodes: Node<ErdNodeData>[]; edges: Edge[] } = useMemo(
    () => ({
      edges: authorEdges,
      nodes: baseElements.nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          refreshing: refreshingIds.has(n.id),
          authorMode,
          onAddField: openAuthorField,
          authorPending: authorPendingApis.has(n.id),
          onRefreshNode: refreshNode,
          onPicklistClick: openPicklist,
          ...recordNodeData(n.id),
          rows: withSketchRows(n.id, n.data.rows),
          totalFields: n.data.totalFields + (sketchRowsByApi.get(n.id)?.length ?? 0),
        },
      })),
    }),
    [baseElements, refreshingIds, refreshNode, openPicklist, recordNodeData, authorMode, openAuthorField, authorPendingApis, withSketchRows, sketchRowsByApi, authorEdges]
  );

  // Retired with the recursive "Discover full": the chain explorer walks
  // live describes level by level instead of this cache-only helper.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const undiscoveredChildren = useCallback(
    (ofName: string, known: Map<string, SalesforceDescribeResult>): string[] => {
      const d = known.get(ofName);
      if (!d) return [];
      const out: string[] = [];
      for (const r of d.childRelationships ?? []) {
        if (!r.relationshipName) continue;
        if (!known.has(r.childSObject) && !out.includes(r.childSObject)) {
          out.push(r.childSObject);
        }
      }
      return out;
    },
    []
  );

  const toggleStage = useCallback((apiName: string) => {
    setStaged((prev) => {
      const next = new Set(prev);
      if (next.has(apiName)) next.delete(apiName);
      else next.add(apiName);
      return next;
    });
  }, []);

  // Pin live drag positions so growth actions keep the user's arrangement
  // (fresh nodes still take dagre-planned spots). Reset view clears the pins.
  // Prefixed graph ids (p:X) are ALSO stored stripped (X) so a position
  // survives the trip back to the ERD view instead of colliding there.
  const pinCurrentLayout = useCallback(() => {
    const live = canvasRef.current?.getNodes() ?? [];
    if (live.length === 0) return;
    // Pin into the mounted view's own map - ERD tables and graph bubbles
    // must never share coordinates.
    const setPins = view === "graph" ? setGraphEnforced : setEnforced;
    setPins((prev) => {
      const next = new Map(prev ?? []);
      for (const n of live) {
        next.set(n.id, { ...n.position });
        if (n.id.includes(":")) {
          next.set(n.id.split(":").slice(1).join(":"), { ...n.position });
        }
      }
      return next;
    });
  }, [view]);

  const handleErdDragStop = useCallback((id: string, position: { x: number; y: number }) => {
    setEnforced((prev) => {
      const next = new Map(prev ?? []);
      next.set(id, { ...position });
      return next;
    });
  }, []);

  const handleGraphDragStop = useCallback((id: string, position: { x: number; y: number }) => {
    setGraphEnforced((prev) => {
      const next = new Map(prev ?? []);
      next.set(id, { ...position });
      return next;
    });
  }, []);

  const pruneEnforced = useCallback((ids: Set<string>) => {
    const prune = (prev: Map<string, { x: number; y: number }> | null) => {
      if (!prev) return prev;
      const next = new Map(prev);
      for (const id of ids) {
        next.delete(id);
        for (const k of [...next.keys()]) {
          if (k.endsWith(`:${id}`)) next.delete(k);
        }
      }
      return next;
    };
    setEnforced(prune);
    setGraphEnforced(prune);
  }, []);

  // Shared add-pipeline: fetch, merge, pin layout, bump revision.
  // Re-adding revives tombstones: removed/dismissed ids for these names clear.
  // Resilient: one object's 404 (e.g. D&B Company not in this org) must not
  // kill the whole batch - successes land, failures are named individually.
  const addNames = useCallback(
    async (names: string[]): Promise<SalesforceDescribeResult[]> => {
      const settled = await mapLimit(names, 6, async (n) => {
        try {
          return { ok: true as const, value: await fetchDescribe(n) };
        } catch (err) {
          return { ok: false as const, name: n, error: err instanceof Error ? err.message : String(err) };
        }
      });
      const fresh = settled.filter((r) => r.ok).map((r) => r.value);
      const failed = settled.filter((r) => !r.ok);
      mergeDescribes(fresh);
      const revived = new Set(fresh.map((d) => d.name));
      setRemovedIds((prev) => {
        const next = new Set(prev);
        for (const n of revived) next.delete(n);
        return next;
      });
      setDismissedIds((prev) => {
        const next = new Set(prev);
        for (const n of revived) next.delete(n);
        return next;
      });
      pinCurrentLayout();
      setLayoutRev((r) => r + 1);
      if (failed.length > 0) {
        const err = new Error(
          `Could not add ${failed.map((f) => `${f.name} (${f.error})`).join(", ")}` +
            (fresh.length > 0 ? ` - ${fresh.length} other object${fresh.length === 1 ? "" : "s"} still added.` : " - nothing added.")
        );
        (err as unknown as { partial: SalesforceDescribeResult[] }).partial = fresh;
        throw err;
      }
      return fresh;
    },
    [fetchDescribe, mergeDescribes, pinCurrentLayout]
  );

  // ---- Live agent bridge: terminal agents drive this canvas via MCP ----
  // The context ref is refreshed every render; the registered handlers are
  // stable and always read the latest state through it. No tokens flow here -
  // handlers reuse the same session-backed callbacks as the UI.
  const erdBridgeCtx = useRef<ErdBridgeContext | null>(null);
  erdBridgeCtx.current = {
    objects,
    describes,
    rootName,
    focusName,
    view,
    hideSystem,
    filterMode,
    authorMode,
    nodePositions: () => {
      const out: Record<string, { x: number; y: number }> = {};
      for (const n of canvasRef.current?.getNodes() ?? []) {
        out[n.id] = { x: n.position.x, y: n.position.y };
      }
      return out;
    },
    focusCanvasOn,
    setFocusName,
    setView,
    setHideSystem,
    setFilterMode,
    tagRegistry,
    nodeTags,
    upsertTag: (tag) => {
      setTagRegistry((prev) =>
        prev.some((t) => t.id === tag.id) ? prev.map((t) => (t.id === tag.id ? tag : t)) : [...prev, tag],
      );
    },
    assignTag: (tagId, names, on) => {
      setNodeTags((prev) => {
        const next = { ...prev };
        for (const n of names) {
          const cur = new Set(next[n] ?? []);
          if (on) cur.add(tagId);
          else cur.delete(tagId);
          next[n] = [...cur];
        }
        return next;
      });
    },
    deleteTag,
    addNames,
    describeCached,
    submitAuthorField,
    submitAuthorObject,
    hideNames: (names, hide) => {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        for (const n of names) {
          if (hide) next.add(n);
          else next.delete(n);
        }
        return next;
      });
      if (!hide) {
        setDismissedIds((prev) => {
          const next = new Set(prev);
          for (const n of names) next.delete(n);
          return next;
        });
      }
    },
    removeNames: (names) => {
      // Mirror the UI remove path: drop the describe so the ERD node goes
      // away, tombstone for the graph, prune saved positions.
      const gone = new Set(names.filter((n) => n !== rootName));
      if (gone.size === 0) return;
      pruneEnforced(gone);
      setSpot(null);
      setDescribes((prev) => {
        const next = new Map(prev);
        for (const n of gone) next.delete(n);
        return next;
      });
      setRemovedIds((prev) => new Set([...prev, ...gone]));
      setHiddenIds((prev) => new Set([...prev].filter((n) => !gone.has(n))));
      setDismissedIds((prev) => new Set([...prev].filter((n) => !gone.has(n))));
      if (gone.has(focusName)) setFocusName(rootName);
    },
  };
  useEffect(() => {
    const ref = erdBridgeCtx;
    const need = (): ErdBridgeContext => {
      const ctx = ref.current;
      if (!ctx) throw new Error("ERD bridge is not ready - open the Schema tab first.");
      return ctx;
    };
    const live: ErdBridgeContext = {
      get objects() { return need().objects; },
      get describes() { return need().describes; },
      get rootName() { return need().rootName; },
      get focusName() { return need().focusName; },
      get view() { return need().view; },
      get hideSystem() { return need().hideSystem; },
      get filterMode() { return need().filterMode; },
      get tagRegistry() { return need().tagRegistry; },
      get nodeTags() { return need().nodeTags; },
      get authorMode() { return need().authorMode; },
      nodePositions: () => need().nodePositions(),
      focusCanvasOn: (name) => need().focusCanvasOn(name),
      setFocusName: (name) => need().setFocusName(name),
      setView: (v) => need().setView(v),
      setHideSystem: (hide) => need().setHideSystem(hide),
      setFilterMode: (mode) => need().setFilterMode(mode),
      upsertTag: (tag) => need().upsertTag(tag),
      assignTag: (tagId, names, on) => need().assignTag(tagId, names, on),
      deleteTag: (tagId) => need().deleteTag(tagId),
      addNames: (names) => need().addNames(names),
      describeCached: (name) => need().describeCached(name),
      hideNames: (names, hide) => need().hideNames(names, hide),
      removeNames: (names) => need().removeNames(names),
      // Bridge-issued author calls share the human choke points; scope the
      // audit actor so the trail shows who really deployed.
      submitAuthorField: (draft, childApi) => {
        activityActor.current = "agent-bridge";
        return need().submitAuthorField(draft, childApi).finally(() => {
          activityActor.current = "architect";
        });
      },
      submitAuthorObject: (draft) => {
        activityActor.current = "agent-bridge";
        return need().submitAuthorObject(draft).finally(() => {
          activityActor.current = "architect";
        });
      },
    };
    const handlers = buildErdBridgeHandlers(live);
    for (const kind of ERD_BRIDGE_KINDS) {
      const fn = handlers[kind];
      if (fn) registerBridgeHandler(kind, fn);
    }
    return () => {
      for (const kind of ERD_BRIDGE_KINDS) unregisterBridgeHandler(kind);
    };
  }, []);

  const applyStaged = useCallback(async () => {
    if (staged.size === 0 || busy) return;
    const names = [...staged].filter((n) => !describes.has(n));
    if (names.length === 0) {
      // Everything staged is already on canvas - just focus the first
      const first = [...staged][0];
      setFocusName(first);
      setStaged(new Set());
      setRootSearch("");
      focusCanvasOn(first);
      setNotice(`${first} is already on the canvas - focused.`);
      return;
    }
    if (describes.size + names.length > MAX_NODES) {
      setNotice(`Canvas cap is ${MAX_NODES} objects - adding ${names.length} would exceed it. Remove some nodes first.`);
      return;
    }
    setError(null);
    setNotice(null);
    setSpot(null);
    setBusy(`Adding ${names.length} object${names.length === 1 ? "" : "s"} to canvas…`);
    try {
      const fresh = await addNames(names);
      if (describes.size === 0 && fresh.length > 0) {
        setRootName(fresh[0].name);
      }
      setFocusName(fresh[fresh.length - 1]?.name ?? rootName);
      if (fresh.length > 0) focusCanvasOn(fresh[fresh.length - 1].name);
      setStaged(new Set());
      setRootSearch("");
      setNotice(
        fresh.length === 1
          ? `${fresh[0].name} added - links to objects already on canvas draw automatically.`
          : `${fresh.length} objects added - links draw automatically where both ends are present.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add objects");
    } finally {
      setBusy(null);
    }
  }, [staged, describes, busy, rootName, addNames, focusCanvasOn]);

  const refreshAll = useCallback(async () => {
    if (busy || describes.size === 0) return;
    const ids = [...describes.keys()];
    const before = new Map<string, Set<string>>();
    for (const [k, d] of describes) before.set(k, new Set(d.fields.map((f) => f.name)));
    setError(null);
    setNotice(null);
    setSpot(null);
    setPopover(null);
    setBusy(`Refreshing ${ids.length} object${ids.length === 1 ? "" : "s"}…`);
    try {
      const settled = await mapLimit(ids, 6, async (n) => {
        try {
          return { ok: true as const, value: await fetchDescribe(n) };
        } catch (err) {
          return { ok: false as const, name: n, error: err instanceof Error ? err.message : String(err) };
        }
      });
      const fresh = settled.filter((r) => r.ok).map((r) => r.value);
      const failed = settled.filter((r) => !r.ok);
      mergeDescribes(fresh);
      const parts: string[] = [];
      for (const d of fresh) {
        const old = before.get(d.name) ?? new Set<string>();
        const now = new Set(d.fields.map((f) => f.name));
        const added = [...now].filter((x) => !old.has(x));
        const removed = [...old].filter((x) => !now.has(x));
        if (added.length > 0 || removed.length > 0) {
          const bits: string[] = [];
          if (added.length > 0) {
            bits.push(`+${added.length} (${added.slice(0, 3).join(", ")}${added.length > 3 ? "…" : ""})`);
          }
          if (removed.length > 0) {
            bits.push(`−${removed.length} (${removed.slice(0, 3).join(", ")}${removed.length > 3 ? "…" : ""})`);
          }
          parts.push(`${d.name} ${bits.join(" ")}`);
        }
      }
      setNotice(
        parts.length > 0
          ? `Refreshed ${fresh.length} · ` + parts.slice(0, 4).join(" · ") + (parts.length > 4 ? ` · +${parts.length - 4} more` : "")
          : `Refreshed ${fresh.length} object${fresh.length === 1 ? "" : "s"} - no field changes.`
      );
      if (failed.length > 0) {
        setError(`Skipped ${failed.map((f) => `${f.name} (${f.error})`).join(", ")} - rest refreshed.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setBusy(null);
    }
  }, [busy, describes, fetchDescribe, mergeDescribes]);

  const saveSnapshot = useCallback(async () => {
    if (busy || describes.size === 0 || !orgDomain) return;
    const live = canvasRef.current?.getNodes() ?? [];
    const positions: Record<string, { x: number; y: number }> = {};
    for (const n of live) positions[n.id] = { ...n.position };
    const label = labels.get(rootName) ?? rootName;
    const now = Date.now();
    const snap: ErdSnapshot = {
      id: newItemId(),
      orgDomain,
      tabId,
      tabName,
      name: describes.size > 1 ? `${label} +${describes.size - 1}` : label,
      createdAt: now,
      root: rootName,
      focus: focusName || rootName,
      nodes: [...describes.keys()],
      positions,
      // Design notes travel with the canvas they describe.
      ...noteToSnapshotNotes(canvasNote),
    };
    try {
      await persistSnapshot(snap);
      setSnapshots(await listSnapshotsByOrg(orgDomain));
      setNotice(`Snapshot “${snap.name}” saved${snap.notes ? " with design notes" : ""} - restore it anytime from history.`);
    } catch {
      setError("Couldn't save snapshot (IndexedDB unavailable).");
    }
  }, [busy, describes, orgDomain, rootName, focusName, labels, canvasNote, tabId, tabName]);

  const restoreSnapshot = useCallback(
    async (snap: ErdSnapshot) => {
      if (busy) return;
      setShowHistory(false);
      setError(null);
      setNotice(null);
      setSpot(null);
      setPopover(null);
      setBusy(`Restoring “${snap.name}” with fresh metadata…`);
      try {
        const results = await mapLimit(snap.nodes, 6, async (n) => {
          try {
            return await fetchDescribe(n);
          } catch {
            return null;
          }
        });
        const fresh = results.filter((d): d is SalesforceDescribeResult => d !== null);
        if (fresh.length === 0) {
          throw new Error("None of the snapshotted objects could be described - org changed or session expired.");
        }
        setDescribes(new Map(fresh.map((d) => [d.name, d] as const)));
        // Restored members are alive again - drop their tombstones/dismissals.
        const alive = new Set(fresh.map((d) => d.name));
        setRemovedIds((prev) => {
          const next = new Set(prev);
          for (const n of alive) next.delete(n);
          return next;
        });
        setDismissedIds((prev) => {
          const next = new Set(prev);
          for (const n of alive) next.delete(n);
          return next;
        });
        const root = fresh.some((d) => d.name === snap.root) ? snap.root : fresh[0].name;
        setRootName(root);
        setFocusName(fresh.some((d) => d.name === snap.focus) ? snap.focus : root);
        setEnforced(new Map(Object.entries(snap.positions)));
        setLayoutRev((r) => r + 1);
        // Snapshot notes travel back into the live editor (agreed behavior).
        if (snap.notes) {
          setCanvasNote(snapshotNotesToNote(snap));
          touchNotes();
        }
        const skipped = snap.nodes.length - fresh.length;
        setNotice(
          `Restored “${snap.name}” with fresh metadata (${fresh.length} objects)` +
            (skipped > 0 ? `, ${skipped} no longer describable` : "") +
            (snap.notes ? ", notes included" : "") +
            "."
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Restore failed");
      } finally {
        setBusy(null);
      }
    },
    [busy, fetchDescribe, touchNotes]
  );

  const deleteSnapshot = useCallback(
    async (id: string) => {
      try {
        await deleteSnapshotFromDb(id);
        setSnapshots(await listSnapshotsByOrg(orgDomain));
      } catch {
        /* ignore */
      }
    },
    [orgDomain]
  );

  // ── Snapshot sharing: export bundles full describes + positions + notes +
  // entity TODOs into a portable file; import restores with zero API calls.
  const exportSnapshot = useCallback(async (s: ErdSnapshot) => {
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy(`Packing “${s.name}” for sharing…`);
    try {
      const results = await mapLimit(s.nodes, 6, async (n) => {
        try {
          return await fetchDescribe(n);
        } catch {
          return null;
        }
      });
      const fresh = results.filter((d): d is SalesforceDescribeResult => d !== null);
      if (fresh.length === 0) {
        throw new Error("None of the snapshotted objects could be described - session expired or org changed.");
      }
      const en: NonNullable<ErdSharePayload["entityNotes"]> = {};
      for (const n of s.nodes) {
        const rows = (entityLog[n] ?? []).filter((r) => (r.body ?? "").trim());
        if (rows.length > 0) {
          en[n] = rows.map((r) => ({
            ...(r.title.trim() ? { title: r.title.trim() } : {}),
            text: (r.body ?? "").slice(0, 50_000),
            ...(r.kind ? { kind: r.kind } : {}),
            status: r.status,
            updatedAt: r.updatedAt,
          }));
        }
      }
      const payload: ErdSharePayload = {
        kind: ERD_SHARE_KIND,
        version: ERD_SHARE_VERSION,
        exportedAt: Date.now(),
        exportedOrg: orgDomain,
        snapshot: {
          name: s.name,
          root: s.root,
          focus: s.focus,
          describes: fresh,
          positions: s.positions,
          notes: s.notes,
          notesFormat: s.notesFormat,
          notesHtml: s.notesHtml,
        },
        entityNotes: Object.keys(en).length > 0 ? en : undefined,
      };
      const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = shareFileName(s.name);
      a.click();
      URL.revokeObjectURL(url);
      const skipped = s.nodes.length - fresh.length;
      setNotice(
        `Exported “${s.name}” (${fresh.length} objects${skipped > 0 ? `, ${skipped} skipped` : ""}) - share the file and your teammate continues the same canvas.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  }, [busy, fetchDescribe, orgDomain, entityLog]);

  const importSnapshotFile = useCallback(async (file: File) => {
    setError(null);
    setNotice(null);
    try {
      const raw = JSON.parse(await file.text());
      const p = validateSharePayload(raw);
      if (!p) throw new Error("Not a valid GRAVENX canvas file.");
      const s = p.snapshot;
      setDescribes(new Map(s.describes.map((d) => [d.name, d] as const)));
      const alive = new Set(s.describes.map((d) => d.name));
      setRemovedIds((prev) => {
        const next = new Set(prev);
        for (const n of alive) next.delete(n);
        return next;
      });
      setDismissedIds((prev) => {
        const next = new Set(prev);
        for (const n of alive) next.delete(n);
        return next;
      });
      if (s.removedIds) setRemovedIds(new Set(s.removedIds.filter((n) => !alive.has(n))));
      if (s.hiddenIds) setHiddenIds(new Set(s.hiddenIds));
      if (s.dismissedIds) setDismissedIds(new Set(s.dismissedIds));
      const root = alive.has(s.root) ? s.root : s.describes[0].name;
      setRootName(root);
      setFocusName(alive.has(s.focus) ? s.focus : root);
      setEnforced(new Map(Object.entries(s.positions)));
      setLayoutRev((r) => r + 1);
      if (s.notes) {
        setCanvasNote(snapshotNotesToNote(s));
        touchNotes();
      }
      if (p.entityNotes) {
        const now = Date.now();
        setEntityLog((prev) => {
          const next = { ...prev };
          for (const [api, value] of Object.entries(p.entityNotes ?? {})) {
            const rows = Array.isArray(value)
              ? shareRowsToEntries(api, value, now)
              : migrateEntityLogValue(api, value as unknown, undefined, now);
            if (rows.length > 0) next[api] = [...(next[api] ?? []), ...rows];
          }
          return next;
        });
        touchNotes();
      }
      setShowHistory(false);
      setNotice(`Imported “${s.name}” from ${p.exportedOrg} (${s.describes.length} objects) - zero API calls, continue together.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus dropdown: picks the working node for Discover/Remove AND glides
  // it to canvas center (big-canvas navigation). Canvas clicks only select -
  // they never yank the viewport. Lives up here so Inbox navigation can reuse it.
  const handleFocusChange = useCallback((id: string) => {
    setFocusName(id);
    setSpot(null);
    // The newly focused node is already laid out - center it next frame.
    window.setTimeout(() => {
      canvasRef.current?.focusNode(id);
    }, 60);
  }, []);

  const importFileRef = useRef<HTMLInputElement | null>(null);

  // ── Architecture Inbox (Phase 1): normalized view over live notes +
  // snapshot notes. Writers route back to the canonical records - the Inbox
  // never owns an editable copy.
  const [inboxOpen, setInboxOpen] = useState(false);
  const inboxItems: ArchitectureInboxItem[] = useMemo(() => {
    if (!orgKey) return [];
    const live = normalizeLiveNotes({
      orgScopeId: orgKey,
      text: canvasNote.md,
      textFormat: canvasNote.format,
      textHtml: canvasNote.html || undefined,
      updatedAt: notesSavedAt,
      entries: Object.values(entityLog).flat(),
      labels,
    });
    const fromSnaps = snapshots.flatMap((s) => normalizeSnapshotNotes({ snapshot: s, orgScopeId: orgKey }));
    // Live schema knowledge for staleness: known apis + per-entity/field facts.
    const knownApis = new Set<string>([...describes.keys(), ...objects.map((o) => o.name)]);
    const entities = new Map<string, EntityFacts>();
    const fields = new Map<string, FieldFacts>();
    for (const [api, d] of describes) {
      entities.set(api, {
        apiName: api,
        fieldCount: d.fields.length,
        fieldNames: d.fields.map((f) => f.name),
        childNames: [...new Set((d.childRelationships ?? []).map((r) => r.childSObject).filter(Boolean))],
      });
      for (const f of d.fields) {
        fields.set(`${api}.${f.name}`, {
          name: f.name,
          type: f.type,
          required: !f.nillable && !f.defaultedOnCreate,
          referenceTo: f.referenceTo ?? [],
          label: f.label,
        });
      }
    }
    return resolveStale([...live, ...fromSnaps], { knownApis, entities, fields }).map((item) =>
      // Tab-scoped canvas identity: this tab's live items group under its tab.
      item.canvasId === "live" ? { ...item, canvasId: tabId, canvasName: tabName } : item
    );
  }, [orgKey, tabId, tabName, canvasNote, notesSavedAt, entityLog, labels, snapshots, describes, objects]);
  const inboxCounts = useMemo(() => countInbox(inboxItems), [inboxItems]);
  const inboxCanvases = useMemo(() => {
    const out = [{ id: tabId, name: tabName }];
    for (const s of snapshots) {
      if (s.notes?.trim()) out.push({ id: s.id, name: s.name });
    }
    return out;
  }, [tabId, tabName, snapshots]);

  const inboxEditBody = useCallback((id: string, b: NoteBody) => {
    if (id === "live-canvas") {
      setCanvasNote(b);
      touchNotes();
      return;
    }
    if (id.startsWith("live-entry-")) {
      setEntryBodyById(id.slice("live-entry-".length), b);
      return;
    }
    if (id.startsWith("snap-")) {
      const s = snapshots.find((x) => x.id === id.slice(5));
      if (!s) return;
      void (async () => {
        try {
          await persistSnapshot({ ...s, ...noteToSnapshotNotes(b) });
          setSnapshots(await listSnapshotsByOrg(orgDomain));
        } catch {
          setError("Couldn't save notes (IndexedDB unavailable).");
        }
      })();
    }
  }, [snapshots, orgDomain, touchNotes, setEntryBodyById]);

  const inboxSetTaskDone = useCallback((id: string, done: boolean) => {
    if (id.startsWith("live-entry-")) {
      patchEntryById(id.slice("live-entry-".length), { status: done ? "done" : "open" }, done ? "Resolved from Inbox" : "Reopened from Inbox");
    }
  }, [patchEntryById]);

  /** Unified lifecycle writer: routes kind/status/owner metadata to the
   * canonical log row or snapshot record with history. */
  const inboxUpdateMeta = useCallback((id: string, patch: Partial<InboxMeta>, what: string) => {
    if (id.startsWith("live-entry-")) {
      setEntryMetaById(id.slice("live-entry-".length), patch, what);
      return;
    }
    if (id.startsWith("snap-")) {
      setSnapshotNoteMeta(id.slice(5), patch, what);
    }
  }, [setEntryMetaById, setSnapshotNoteMeta]);

  const inboxDelete = useCallback((id: string) => {
    if (id === "live-canvas") {
      setCanvasNote(emptyNoteBody());
      touchNotes();
      return;
    }
    if (id.startsWith("live-entry-")) {
      deleteEntryById(id.slice("live-entry-".length));
      return;
    }
    if (id.startsWith("snap-")) {
      const s = snapshots.find((x) => x.id === id.slice(5));
      if (!s) return;
      void (async () => {
        try {
          await persistSnapshot({ ...s, notes: undefined });
          setSnapshots(await listSnapshotsByOrg(orgDomain));
          setNotice(`Notes removed from “${s.name}” - canvas untouched.`);
        } catch {
          setError("Couldn't update snapshot (IndexedDB unavailable).");
        }
      })();
    }
  }, [snapshots, orgDomain, touchNotes, deleteEntryById]);

  /** Open a log entry modal on this tab - shared by inbox + cross-tab nav. */
  const openLogEntry = useCallback(
    (api: string, entryId: string | null) => {
      const rows = entityLog[api] ?? [];
      if (api !== CANVAS_LOG_API && !rows.some((r) => r.id === entryId)) return false;
      setNoteEntity(api);
      setNoteEntryId(entryId);
      setLogModalOpen(true);
      return true;
    },
    [entityLog]
  );

  // Cross-tab navigation: the page routes another tab's request here; apply
  // it once (restore first when a snapshot carries the note), then consume.
  const navHandledRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingNav || pendingNav.tabId !== tabId) return;
    const key = JSON.stringify(pendingNav);
    if (navHandledRef.current === key) return;
    navHandledRef.current = key;
    setInboxOpen(false);
    (async () => {
      if (pendingNav.snapshotId) {
        const s = snapshots.find((x) => x.id === pendingNav.snapshotId);
        if (s) {
          await restoreSnapshot(s);
          revealCanvasNotes();
        }
      } else if (pendingNav.api) {
        openLogEntry(pendingNav.api, pendingNav.entryId ?? null);
      } else if (pendingNav.openCanvasLog) {
        setNoteEntity(CANVAS_LOG_API);
        setNoteEntryId(null);
        setLogModalOpen(true);
      }
      onNavConsumed();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNav, tabId]);

  const inboxNavigate = useCallback((item: ArchitectureInboxItem) => {
    setInboxOpen(false);
    if (item.id.startsWith("live-entry-")) {
      const entryId = item.id.slice("live-entry-".length);
      for (const [api, rows] of Object.entries(entityLog)) {
        if (rows.some((r) => r.id === entryId)) {
          setNoteEntity(api);
          setNoteEntryId(entryId);
          setLogModalOpen(true);
          return;
        }
      }
    }
    // Whole-canvas note: open the canvas log modal on this tab.
    if (item.id === "live-canvas") {
      setNoteEntity(CANVAS_LOG_API);
      setNoteEntryId(null);
      setLogModalOpen(true);
      return;
    }
    if (item.provenance.source === "snapshot" && item.provenance.snapshotId) {
      const s = snapshots.find((x) => x.id === item.provenance.snapshotId);
      if (s) {
        // Another tab owns this snapshot - never restore it here (that would
        // clobber this canvas); route to the owning tab instead.
        if (s.tabId && s.tabId !== tabId) {
          onRequestTab(s.tabId, { snapshotId: s.id }, tabId);
          return;
        }
        void restoreSnapshot(s).then(() => revealCanvasNotes());
        return;
      }
    }
    setView("erd");
    if (item.anchor.type === "entity") {
      handleFocusChange(item.anchor.id);
      // View switch remounts the canvas - retry centering once settled.
      window.setTimeout(() => {
        canvasRef.current?.focusNode(item.anchor.id);
      }, 400);
    }
  }, [snapshots, restoreSnapshot, handleFocusChange, entityLog, tabId, onRequestTab, revealCanvasNotes]);

  const renameSnapshot = useCallback(
    async (id: string, name: string) => {
      const clean = name.trim();
      if (!clean) return;
      try {
        await renameSnapshotInDb(id, clean);
        setSnapshots(await listSnapshotsByOrg(orgDomain));
      } catch {
        /* ignore */
      }
      setRenamingId(null);
    },
    [orgDomain]
  );

  const discoverChildren = useCallback(() => {
    const target = focusName || rootName;
    if (!target || busy) return;
    const d = describes.get(target);
    if (!d) return;
    const seen = new Set<string>();
    const candidates: DiscoverCandidate[] = [];
    for (const r of d.childRelationships ?? []) {
      if (!r.relationshipName || seen.has(r.childSObject)) continue;
      seen.add(r.childSObject);
      candidates.push({
        apiName: r.childSObject,
        label: labels.get(r.childSObject) ?? r.childSObject,
        custom: isCustomName(r.childSObject),
        group: "child",
        via: r.relationshipName,
        kind: r.cascadeDelete === true ? "md" : "lookup",
        onCanvas: describes.has(r.childSObject),
        system: isSystemObject(r.childSObject, isCustomName(r.childSObject)),
      });
    }
    if (candidates.length === 0) {
      setNotice(`No child relationships on ${target}.`);
      return;
    }
    setPicker({
      mode: "children",
      target,
      title: `Discover children of ${target}`,
      subtitle: `${candidates.length} related objects - tick what joins the canvas`,
      candidates,
    });
  }, [focusName, rootName, busy, describes, labels, isCustomName]);

  // Family-tree expansion data: candidate children/parents for ONE node,
  // with ahead-counts (p:/c:) computed from describe (cache + fetch).
  // Used by the graph detail card ("Discover of <node>"). Ahead-counts are
  // CAPPED: at most 8 live fetches per panel open - the rest read 0/0 until
  // expanded. Reopening a node reuses the per-node familyCache: zero calls.
  const familyCache = useRef(new Map<string, (DiscoverCandidate & { parentCount: number; childCount: number })[]>());
  const familyCandidates = useCallback(async (apiName: string): Promise<{
    candidates: (DiscoverCandidate & { parentCount: number; childCount: number })[];
  }> => {
    const hit = familyCache.current.get(apiName);
    if (hit) return { candidates: hit };
    const d = await describeCached(apiName);
    if (!d) return { candidates: [] };
    const out: (DiscoverCandidate & { parentCount: number; childCount: number })[] = [];
    const seen = new Set<string>();
    let liveBudget = 8;
    const aheadCounts = async (name: string): Promise<{ p: number; c: number }> => {
      const cached = describes.get(name);
      const dd = cached ?? (liveBudget > 0 ? await describeCached(name) : null);
      if (!cached) liveBudget--;
      if (!dd) return { p: 0, c: 0 };
      const p = new Set<string>();
      for (const f of dd.fields ?? []) {
        if (f.type !== "reference") continue;
        for (const t of f.referenceTo ?? []) {
          if (t !== name) p.add(t);
        }
      }
      const c = new Set<string>();
      for (const r of dd.childRelationships ?? []) {
        if (r.relationshipName && r.childSObject !== name) c.add(r.childSObject);
      }
      return { p: p.size, c: c.size };
    };
    for (const r of d.childRelationships ?? []) {
      if (!r.relationshipName || seen.has(`c:${r.childSObject}`)) continue;
      seen.add(`c:${r.childSObject}`);
      const ahead = await aheadCounts(r.childSObject);
      out.push({
        apiName: r.childSObject,
        label: labels.get(r.childSObject) ?? r.childSObject,
        custom: isCustomName(r.childSObject),
        group: "child",
        via: r.relationshipName,
        kind: r.cascadeDelete === true ? "md" : "lookup",
        onCanvas: describes.has(r.childSObject),
        system: isSystemObject(r.childSObject, isCustomName(r.childSObject)),
        parentCount: ahead.p,
        childCount: ahead.c,
      });
    }
    for (const f of d.fields ?? []) {
      if (f.type !== "reference") continue;
      for (const t of f.referenceTo ?? []) {
        if (t === apiName || seen.has(`p:${t}`)) continue;
        seen.add(`p:${t}`);
        const ahead = await aheadCounts(t);
        out.push({
          apiName: t,
          label: labels.get(t) ?? t,
          custom: isCustomName(t),
          group: "parent",
          via: f.name,
          kind: "lookup",
          onCanvas: describes.has(t),
          system: isSystemObject(t, isCustomName(t)),
          parentCount: ahead.p,
          childCount: ahead.c,
        });
      }
    }
    familyCache.current.set(apiName, out);
    return { candidates: out };
  }, [describes, describeCached, labels, isCustomName]);

  // One-click custom sweep: every custom object linked to the root's
  // neighborhood, fetched live. Answers "show me all custom links" without
  // touching the canvas - results stay as lite previews until expanded.
  const discoverCustomLinked = useCallback(async () => {
    if (!rootName || busy) return;
    const root = describes.get(rootName);
    if (!root) return;
    setError(null);
    setNotice(null);
    // Level-1 custom neighbors (already known) + one live ring beyond each
    // level-1 neighbor: collect custom names, fetch, extend the graph.
    const l1 = rootNeighbors(root, labels, isCustomName);
    const customs = new Set<string>();
    for (const n of l1) {
      if (n.custom) customs.add(n.apiName);
    }
    setBusy("Scanning one ring out for custom links…");
    try {
      const ringSources = l1.slice(0, 40);
      const ringDescribes = await mapLimit(ringSources, 6, async (n) => {
        const d = describes.get(n.apiName);
        if (d) return d;
        try {
          return await fetchDescribe(n.apiName);
        } catch {
          return null;
        }
      });
      for (const d of ringDescribes) {
        if (!d) continue;
        const fam = await familyCandidates(d.name);
        for (const c of fam.candidates) {
          if (c.custom) customs.add(c.apiName);
        }
      }
      const fresh = [...customs].filter((n) => n !== rootName);
      if (fresh.length === 0) {
        setNotice("No custom objects linked within one ring of the root neighborhood.");
        return;
      }
      // Extend from the root side: attach customs found via a level-1 node to
      // that node so the tree reads honestly; root-direct customs attach to root.
      const l1Names = new Set(l1.map((n) => n.apiName));
      const rows: GraphNeighbor[] = [];
      for (const name of fresh.slice(0, 40)) {
        let attachTo = rootName;
        let via: GraphNeighbor | undefined;
        for (const n of l1) {
          if (n.apiName === name) {
            via = undefined;
            break;
          }
        }
        // Find which ring source led here: re-derive cheaply via family cache.
        attachTo = rootName;
        rows.push({
          apiName: name,
          label: labels.get(name) ?? name,
          custom: true,
          role: "child",
          via: via?.via ?? "custom-link",
          kind: "lookup",
          attachTo,
          depth: l1Names.has(name) ? 1 : 2,
        });
      }
      setExpanded((prev) => {
        const next = new Map(prev);
        const key = `${rootName}::custom-sweep`;
        const have = new Set((next.get(key) ?? []).map((n) => n.apiName));
        next.set(key, [...(next.get(key) ?? []), ...rows.filter((r) => !have.has(r.apiName))]);
        return next;
      });
      // The sweep also opens a picker: tick what joins the canvas now; the
      // left tree keeps the full sweep as dashed previews either way.
      setPicker({
        mode: "custom-sweep",
        target: rootName,
        title: `Custom links of the ${rootName} neighborhood`,
        subtitle: `${rows.length} custom objects one ring out - tick what joins the canvas now, or close and browse the dashed previews in the left tree`,
        candidates: rows.map((r) => ({
          apiName: r.apiName,
          label: r.label,
          custom: true,
          group: "child" as const,
          via: "custom-link",
          kind: "lookup" as const,
          onCanvas: describes.has(r.apiName),
          system: isSystemObject(r.apiName, true),
        })),
      });
      setNotice(`${rows.length} custom-linked objects fanned out in the left tree as dashed previews - tick in the picker to add now, or close it and use Add visible to ERD later.`);
    } finally {
      setBusy(null);
    }
  }, [rootName, busy, describes, labels, isCustomName, fetchDescribe, familyCandidates]);

  /** Expand selected family members into the GRAPH ONLY. Pure scouting:
   * lite previews unless already described; NOTHING is added to the ERD
   * canvas (use "Add visible to ERD" for that). fromApi anchors the
   * generation so the tree reads Lead → Account → Asset. Edges hang off the
   * source bubble: for children Account→Asset uses Account's own describe. */
  // NEURAL MODE: one click recursively discovers EVERYTHING reachable from
  // the root (BFS over live describes, cache-first) and fans the whole mesh
  // out as lite previews. ERD canvas untouched; filter afterwards with
  // All/Custom/Manual/Hide-system. Caps bound the blast radius.
  const NEURAL_MAX_NODES = 250;
  const NEURAL_MAX_DEPTH = 5;
  // Hub guard: a node with more than this many distinct neighbors is drawn
  // with all its links but NOT walked through. Without this, one Task-like
  // hub (or an Account with 200 children) re-explodes the sweep and drags
  // the whole org back in. Hub children stay one click away via Discover.
  const NEURAL_HUB_DEGREE = 40;
  const godCancel = useRef(false);
  const [neuralRunning, setNeuralRunning] = useState(false);
  const [addObjectOpen, setAddObjectOpen] = useState(false);
  const neuralMode = useCallback(async () => {
    if (!rootName || busy || view !== "graph") return;
    const root = describes.get(rootName);
    if (!root) return;
    godCancel.current = false;
    setNeuralRunning(true);
    setError(null);
    setNotice(null);
    const visited = new Set<string>([rootName]);
    const queue: { api: string; depth: number }[] = [{ api: rootName, depth: 0 }];
    const gathered = new Map<string, GraphNeighbor[]>();
    let fetched = 0;
    const pushRow = (from: string, n: GraphNeighbor) => {
      if (!gathered.has(from)) gathered.set(from, []);
      const list = gathered.get(from)!;
      if (list.some((r) => r.apiName === n.apiName)) return;
      list.push(n);
    };
    setBusy("Neural mode: mapping the reachable universe…");
    try {
      while (queue.length > 0 && visited.size < NEURAL_MAX_NODES) {
        if (godCancel.current) {
          setNotice("Neural mode cancelled - keeping what landed so far.");
          break;
        }
        // One BFS level per batch (concurrency 6), so progress reads level by level.
        // Custom-first ordering: under a fixed node budget, domain depth wins
        // over platform breadth.
        const level = queue.splice(0).sort((a, b) => Number(isCustomName(b.api)) - Number(isCustomName(a.api)));
        setBusy(`Neural mode: depth ${level[0].depth} · ${visited.size} objects so far…`);
        const results = await mapLimit(level, 6, async ({ api }) => {
          const d = await describeCached(api);
          return { api, d };
        });
        for (const { api, d } of results) {
          if (!d) continue;
          const depth = level.find((l) => l.api === api)?.depth ?? 0;
          if (depth >= NEURAL_MAX_DEPTH) continue;
          // Collect neighbors first so the hub guard can count before walking.
          const neighbors: { name: string; row: GraphNeighbor }[] = [];
          const neighborKey = (role: string, name: string) => `${role}:${name}`;
          const seenLocal = new Set<string>();
          for (const r of d.childRelationships ?? []) {
            if (!r.relationshipName || r.childSObject === api || seenLocal.has(neighborKey("c", r.childSObject))) continue;
            seenLocal.add(neighborKey("c", r.childSObject));
            neighbors.push({
              name: r.childSObject,
              row: {
                apiName: r.childSObject,
                label: labels.get(r.childSObject) ?? r.childSObject,
                custom: isCustomName(r.childSObject),
                role: "child",
                via: r.relationshipName,
                kind: r.cascadeDelete === true ? "md" : "lookup",
                attachTo: api,
                depth: depth + 1,
              },
            });
          }
          for (const f of d.fields ?? []) {
            if (f.type !== "reference") continue;
            for (const t of f.referenceTo ?? []) {
              if (t === api || seenLocal.has(neighborKey("p", t))) continue;
              seenLocal.add(neighborKey("p", t));
              neighbors.push({
                name: t,
                row: {
                  apiName: t,
                  label: labels.get(t) ?? t,
                  custom: isCustomName(t),
                  role: "parent",
                  via: f.name,
                  kind: "lookup",
                  attachTo: api,
                  depth: depth + 1,
                },
              });
            }
          }
          // System nodes are never touched: no rows, no traversal. This is
          // what keeps Task/User/RecordType-style hubs (and Share/Feed/
          // History families) from dragging the whole org back in.
          // The Hide-system allow-list is honored automatically: force-shown
          // names sweep normally. Audit-via parents are skipped too unless
          // explicitly allowed (a custom object behind CreatedById is still
          // noise until the architect says otherwise).
          const live = neighbors.filter((n) => {
            const custom = isCustomName(n.name);
            if (systemAllow.has(n.name)) return true;
            if (isEffectivelyHidden(n.name, custom, systemAllow)) return false;
            if (n.row.role === "parent") {
              const viaField = n.row.via;
              if (AUDIT_REFERENCE_FIELDS.has(viaField)) return false;
            }
            return true;
          });
          const hub = live.length > NEURAL_HUB_DEGREE;
          for (const n of live) pushRow(api, n.row);
          // Hub-leaf: draw all of the hub's links but do NOT walk through it.
          // Its children stay one Discover click away instead of exploding.
          if (!hub) {
            for (const n of live) {
              if (!visited.has(n.name) && visited.size < NEURAL_MAX_NODES) {
                visited.add(n.name);
                queue.push({ api: n.name, depth: depth + 1 });
              }
            }
          }
          fetched++;
        }
      }
      // Merge into expansion state (dedupe by attachTo::apiName), then also
      // feed designIds so Design mode follows along.
      setExpanded((prev) => {
        const next = new Map(prev);
        for (const [from, rows] of gathered) {
          const key = `${from}::neural`;
          const have = new Set((next.get(key) ?? []).map((n) => n.apiName));
          const freshRows = rows.filter((r) => !have.has(r.apiName));
          if (freshRows.length > 0) next.set(key, [...(next.get(key) ?? []), ...freshRows]);
        }
        return next;
      });
      setDesignIds((prev) => {
        const next = new Set(prev);
        for (const rows of gathered.values()) for (const r of rows) next.add(r.apiName);
        return next;
      });
      const totalLinks = [...gathered.values()].reduce((n, l) => n + l.length, 0);
      setNotice(
        `Neural mesh: ${visited.size} objects, ${totalLinks} links, ${fetched} describes - all previews, ERD untouched. Filter with All/Custom/Manual/Hide system, or flip Mesh/Linear.`
      );
    } finally {
      setBusy(null);
      setNeuralRunning(false);
    }
  }, [rootName, busy, view, describes, describeCached, labels, isCustomName, systemAllow]);
  const expandFamily = useCallback(async (fromApi: string, names: string[]) => {
    if (busy || names.length === 0) return;
    // True depth: walk attach-links back to the root.
    const depthOfNode = (api: string): number => {
      if (api === rootName) return 0;
      for (const [, list] of expanded) {
        for (const n of list) {
          if (n.apiName === api && n.attachTo) return depthOfNode(n.attachTo) + 1;
        }
      }
      return 1; // level-1 neighborhood
    };
    const fromDepth = depthOfNode(fromApi);
    setBusy(`Expanding ${names.length} from ${fromApi}…`);
    try {
      const key = `${fromApi}::${names.slice().sort().join(",")}`;
      const rows: GraphNeighbor[] = names.slice(0, 30).map((apiName) => {
        return {
          apiName,
          label: labels.get(apiName) ?? apiName,
          custom: isCustomName(apiName),
          role: "child",
          via: "family",
          kind: "lookup",
          attachTo: fromApi,
          depth: fromDepth + 1,
        };
      });
      // Role/via refinement from the source describe when available.
      const src = describes.get(fromApi);
      if (src) {
        const kidVia = new Map((src.childRelationships ?? []).filter((r) => r.relationshipName).map((r) => [r.childSObject, r] as const));
        for (const r of rows) {
          const rel = kidVia.get(r.apiName);
          if (rel) {
            r.via = rel.relationshipName!;
            r.kind = rel.cascadeDelete === true ? "md" : "lookup";
          } else {
            // Maybe a parent (lookup target of fromApi).
            const f = (src.fields ?? []).find((ff) => ff.type === "reference" && (ff.referenceTo ?? []).includes(r.apiName));
            if (f) {
              r.role = "parent";
              r.via = f.name;
              r.kind = "lookup";
            }
          }
        }
      }
      // Depth: one generation beyond the source node.
      for (const r of rows) r.depth = fromDepth + 1;
      setExpanded((prev) => {
        const next = new Map(prev);
        const have = new Set([...next.values()].flat().map((n) => `${n.attachTo}::${n.apiName}`));
        const freshRows = rows.filter((r) => !have.has(`${r.attachTo}::${r.apiName}`));
        if (freshRows.length === 0) return prev;
        next.set(key, [...(next.get(key) ?? []), ...freshRows]);
        return next;
      });
      // Design mode follows along: expanded names join the chosen set.
      setDesignIds((prev) => {
        const next = new Set(prev);
        for (const r of rows) next.add(r.apiName);
        return next;
      });
      // Graph-only: do NOT touch the ERD canvas here. Expanded names stay
      // lite previews until the user hits "Add visible to ERD" or opens them.
      setGraphSelected(fromApi);
    } finally {
      setBusy(null);
    }
  }, [busy, expanded, describes, labels, isCustomName, rootName]);

  /** Collapse one node's extended family out of the graph (ERD untouched). */
  const collapseFamily = useCallback((fromApi: string) => {
    setExpanded((prev) => {
      const next = new Map(prev);
      let dropped = false;
      for (const key of [...next.keys()]) {
        if (key.startsWith(`${fromApi}::`)) {
          next.delete(key);
          dropped = true;
        }
      }
      // Also drop generations that hung off the removed nodes.
      if (dropped) {
        let changed = true;
        while (changed) {
          changed = false;
          for (const [key, list] of [...next.entries()]) {
            const [from] = key.split("::");
            const stillPlaced =
              from === rootName ||
              [...next.values()].flat().some((n) => n.apiName === from);
            void stillPlaced;
            // Keep root-anchored and still-referenced generations; drop orphans
            // whose attach node is neither root nor in another generation.
            const attachAlive =
              from === rootName ||
              [...next.values()].flat().some((n) => n.apiName === from) ||
              describes.has(from);
            void attachAlive;
            if (!attachAlive && from !== rootName) {
              next.delete(key);
              changed = true;
            }
            void list;
          }
        }
      }
      return next;
    });
    if (graphSelected && graphSelected !== rootName && graphSelected !== fromApi) {
      // Keep selection stable - no-op.
    }
  }, [graphSelected, rootName, describes]);

  /** Discover the family of the currently selected graph node into the card.
   * Works on root AND any bubble; live describe when needed. Selecting a new
   * node reloads; the card's Expand pushes checked names via expandFamily. */
  const discoverFamily = useCallback(async (apiName: string) => {
    if (busy) return;
    setFamilyFor(apiName);
    setFamilyBusy(true);
    try {
      const { candidates } = await familyCandidates(apiName);
      setFamily(candidates);
      if (candidates.length === 0) setNotice(`${apiName} has no further relationships.`);
    } finally {
      setFamilyBusy(false);
    }
  }, [busy, familyCandidates]);

  /** Describe every visible graph bubble onto the ERD canvas. Lite previews
   * become solid tables; already-described names are skipped. One click
   * answers "put what I see on the canvas". */
  const addVisibleToErd = useCallback(async () => {
    if (busy || view !== "graph") return;
    const apis = new Set<string>();
    for (const n of graphElements.nodes) {
      const api = (n.data as { apiName?: string } | undefined)?.apiName;
      if (api && api !== rootName && !describes.has(api)) apis.add(api);
    }
    if (apis.size === 0) {
      setNotice("Everything visible is already on the ERD canvas.");
      return;
    }
    const names = [...apis].slice(0, MAX_NEW_PER_ACTION);
    if (describes.size + names.length > MAX_NODES) {
      setNotice(`Canvas cap is ${MAX_NODES} objects - adding ${names.length} would exceed it. Remove some nodes first.`);
      return;
    }
    setBusy(`Adding ${names.length} visible to ERD…`);
    try {
      await addNames(names);
      setNotice(`${names.length} object${names.length === 1 ? "" : "s"} added to the ERD canvas - switch views to arrange.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Add visible failed");
    } finally {
      setBusy(null);
    }
  }, [busy, view, graphElements, rootName, describes, addNames]);

  /** Sync FROM the ERD canvas: every on-canvas object gets a graph bubble,
   * fanned off the root with true roles where related (or a "canvas" link
   * where not). Clears dismissals for synced names and drops to All filter
   * so the sync is total - the mirror of Add visible to ERD. */
  const syncFromCanvas = useCallback(() => {
    if (busy || view !== "graph" || !rootName) return;
    const root = describes.get(rootName);
    if (!root) return;
    const names = [...describes.keys()].filter((n) => n !== rootName);
    if (names.length === 0) {
      setNotice("ERD canvas holds only the root - nothing to sync.");
      return;
    }
    const kidVia = new Map(
      (root.childRelationships ?? []).filter((r) => r.relationshipName).map((r) => [r.childSObject, r] as const)
    );
    const rows: GraphNeighbor[] = names.map((apiName) => {
      const rel = kidVia.get(apiName);
      if (rel) {
        return {
          apiName,
          label: labels.get(apiName) ?? apiName,
          custom: isCustomName(apiName),
          role: "child" as const,
          via: rel.relationshipName!,
          kind: (rel.cascadeDelete === true ? "md" : "lookup") as "md" | "lookup",
          attachTo: rootName,
          depth: 2,
        };
      }
      const f = (root.fields ?? []).find((ff) => ff.type === "reference" && (ff.referenceTo ?? []).includes(apiName));
      if (f) {
        return {
          apiName,
          label: labels.get(apiName) ?? apiName,
          custom: isCustomName(apiName),
          role: "parent" as const,
          via: f.name,
          kind: "lookup" as const,
          attachTo: rootName,
          depth: 2,
        };
      }
      return {
        apiName,
        label: labels.get(apiName) ?? apiName,
        custom: isCustomName(apiName),
        role: "child" as const,
        via: "canvas",
        kind: "lookup" as const,
        attachTo: rootName,
        depth: 2,
      };
    });
    setExpanded((prev) => {
      const next = new Map(prev);
      const key = `${rootName}::canvas-sync`;
      next.set(key, rows);
      return next;
    });
    setDismissedIds((prev) => {
      const next = new Set(prev);
      for (const n of names) next.delete(n);
      return next;
    });
    setDismissedEdges((prev) => {
      // Drop dismissals touching synced names so links redraw.
      const next = new Set<string>();
      for (const id of prev) {
        if (!names.some((n) => id.includes(n))) next.add(id);
      }
      return next;
    });
    setFilterMode("all");
    setNotice(`${names.length} canvas object${names.length === 1 ? "" : "s"} synced into the graph - related links first, the rest via "canvas".`);
  }, [busy, view, rootName, describes, labels, isCustomName]);

  const showParents = useCallback(() => {
    const target = focusName || rootName;
    if (!target || busy) return;
    const d = describes.get(target);
    if (!d) return;
    const seen = new Set<string>();
    const candidates: DiscoverCandidate[] = [];
    for (const f of d.fields ?? []) {
      if (f.type !== "reference") continue;
      for (const t of f.referenceTo ?? []) {
        if (t === target || seen.has(t)) continue;
        seen.add(t);
        candidates.push({
          apiName: t,
          label: labels.get(t) ?? t,
          custom: isCustomName(t),
          group: "parent",
          via: f.name,
          kind: "lookup",
          onCanvas: describes.has(t),
          system: isSystemObject(t, isCustomName(t)),
        });
      }
    }
    if (candidates.length === 0) {
      setNotice(`${target} has no lookup parents.`);
      return;
    }
    setPicker({
      mode: "parents",
      target,
      title: `Show parents of ${target}`,
      subtitle: `${candidates.length} lookup targets - tick what joins the canvas, then they spotlight`,
      candidates,
    });
  }, [focusName, rootName, busy, describes, labels, isCustomName]);

  const applyPicker = useCallback(
    async (selected: string[]) => {
      if (!picker || busy) return;
      const mode = picker.mode;
      const target = picker.target;
      const custom = mode === "custom-parents" || mode === "custom-children";
      setPicker(null);
      const names = selected.filter((n) => !describes.has(n)).slice(0, MAX_NEW_PER_ACTION);
      if (names.length === 0) {
        setNotice("Everything selected is already on canvas.");
        return;
      }
      if (describes.size + names.length > MAX_NODES) {
        setNotice(`Canvas cap is ${MAX_NODES} objects - adding ${names.length} would exceed it. Remove some nodes first.`);
        return;
      }
      setError(null);
      setNotice(null);
      setSpot(null);
      setBusy(`Adding ${names.length} object${names.length === 1 ? "" : "s"}…`);
      try {
        const fresh = await addNames(names);
        if (custom) {
          // Box-icon pulls stay on the entity: repeat box by box, no
          // viewport yank, no spotlight - the notice names what landed.
          setFocusName(target);
        } else {
          setFocusName(fresh[fresh.length - 1]?.name ?? target);
          if (fresh.length > 0) focusCanvasOn(fresh[fresh.length - 1].name);
        }
        if (mode === "parents" && target) {
          const dd = fresh.find((x) => x.name === target) ?? describes.get(target);
          const allParents = dd
            ? [...new Set((dd.fields ?? []).flatMap((f) => f.referenceTo ?? []))]
            : [];
          const freshNames = new Set(fresh.map((x) => x.name));
          const onCanvas = allParents.filter(
            (t) => t === target || describes.has(t) || freshNames.has(t)
          );
          if (onCanvas.length > 0) {
            setSpot({ focus: target, related: new Set(onCanvas) });
            setNotice(
              `${target} is ringed - ${onCanvas.length} parent${onCanvas.length === 1 ? "" : "s"} highlighted. Click empty canvas to clear.`
            );
            return;
          }
        }
        if (custom) {
          const dir = mode === "custom-parents" ? "parent" : "child";
          setNotice(
            fresh.length === 1
              ? `${fresh[0].name} joined ${target} - custom ${dir}, links draw automatically.`
              : `${fresh.length} custom ${dir === "parent" ? "parents" : "children"} pulled for ${target} - links draw automatically where both ends are present.`
          );
          return;
        }
        setNotice(
          fresh.length === 1
            ? `${fresh[0].name} added - links draw automatically.`
            : `${fresh.length} objects added - links draw automatically where both ends are present.`
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Discovery failed");
      } finally {
        setBusy(null);
      }
    },
    [picker, busy, describes, addNames, focusCanvasOn]
  );

  // Hard-remove from the ERD canvas (tombstone): always behind the confirm
  // modal (header X or the explorer Remove button). Metadata stays cached,
  // so re-adding revives the node with its tags intact.
  const removeNode = useCallback((target: string) => {
    if (!target || target === rootName) return;
    setSpot(null);
    pruneEnforced(new Set([target]));
    setRemovedIds((prev) => new Set(prev).add(target));
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.delete(target);
      return next;
    });
    setDescribes((prev) => {
      const next = new Map(prev);
      next.delete(target);
      return next;
    });
    if (target === focusName) setFocusName(rootName);
    setConfirmRemove(null);
    setNotice(`Removed ${target} from canvas - re-add anytime, nothing deleted on the org.`);
  }, [focusName, rootName, pruneEnforced]);

  const removeMany = useCallback(
    (ids: string[]) => {
      const doomed = ids.filter((id) => id !== rootName);
      if (doomed.length === 0) return;
      const gone = new Set(doomed);
      setSpot(null);
      pruneEnforced(gone);
      setHiddenIds((prev) => {
        const next = new Set(prev);
        for (const id of gone) next.delete(id);
        return next;
      });
      setRemovedIds((prev) => {
        const next = new Set(prev);
        for (const id of gone) next.add(id);
        return next;
      });
      setDismissedIds((prev) => {
        const next = new Set(prev);
        for (const id of gone) next.delete(id);
        return next;
      });
      setDescribes((prev) => {
        const next = new Map(prev);
        for (const id of gone) next.delete(id);
        return next;
      });
      if (gone.has(focusName)) setFocusName(rootName);
      if (graphSelected && gone.has(graphSelected)) setGraphSelected(null);
      setNotice(`Removed ${gone.size} object${gone.size === 1 ? "" : "s"} from canvas.`);
    },
    [rootName, focusName, graphSelected, pruneEnforced]
  );

  // Eye toggles only take effect in manual mode - jump there automatically
  // and scroll the Canvas-nodes list open so the user sees the control surface.
  const toggleHidden = useCallback((id: string) => {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setFilterMode("manual");
    window.setTimeout(() => {
      document.getElementById("schema-canvas-nodes")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 60);
  }, []);

  const resetAll = useCallback(() => {
    if (describes.size === 0) return;
    // Non-destructive: re-run auto-layout + re-fit, keep every node.
    setSpot(null);
    setNotice(null);
    setError(null);
    setEnforced(null);
    setGraphEnforced(null);
    setDescribes(new Map(describes));
    setLayoutRev((r) => r + 1);
    setNotice("Layout refreshed - nodes re-arranged, nothing removed.");
  }, [describes]);

  const [confirmClear, setConfirmClear] = useState(false);

  const clearCanvas = useCallback(() => {
    // Explicit wipe: delete the autosaved canvas too, or the next connect to
    // this org would resurrect the cleared canvas (empty mounts stay silent).
    if (orgKey) void clearAutosave(orgKey, "schema", tabId);
    // Session-only record data dies with the canvas.
    setRecordRoot(null);
    setRecordStore(emptyLoadedState());
    setRecordPop(null);
    setRecordPopError(null);
    setDescribes(new Map());
    setRemovedIds(new Set());
    setDismissedIds(new Set());
    setDismissedEdges(new Set());
    setHiddenIds(new Set());
    setSystemAllow(new Set());
    setHideSystem(false);
    setManageChecked(new Set());
    setExpanded(new Map());
    setFamilyFor(null);
    setFamily(null);
    setGraphSelected(null);
    setRootName("");
    setFocusName("");
    setSpot(null);
    setEnforced(null);
    setGraphEnforced(null);
    setNotice(null);
    setError(null);
    setConfirmClear(false);
    setTagRegistry([]);
    setNodeTags({});
    setTagFilter(new Set());
    setTagMode("dim");
    setTagPicker(null);
    setTagManagerOpen(false);
    setTagsOpen(false);
    setFilterOpen(false);
    setLinkOpen(false);
    setLinkTagId(null);
    setConfirmRemove(null);
    viewports.current = { erd: null, graph: null };
  }, [orgKey, tabId]);

  const handleNodeClick = useCallback(
    (id: string) => {
      // Bubble ids: root (Lead), level-1 (p:X / c:X), extended (x:FROM:X
      // or x:FROM:X:n in linear mode). The apiName is always the segment
      // right after the prefix... except x: ids where it sits in the middle.
      const parts = id.split(":");
      const api = id.startsWith("x:") ? (parts[2] ?? id) : parts.length > 1 ? parts.slice(1).join(":") : id;
      setFocusName(api);
      setSpot(null);
      setSpotEdgeId(null);
      setGraphSelected(api);
      // Selection only - no auto-fetch. Opening the panel to remove/hide a
      // bubble must not fire API calls; Discover + Fetch stay one manual
      // click away inside the card.
    },
    []
  );

  const loadLite = useCallback(
    async (api: string) => {
      if (busy || describes.has(api)) return;
      setError(null);
      setBusy(`Loading ${api}…`);
      try {
        const fresh = await addNames([api]);
        if (fresh.length > 0) {
          setFocusName(api);
          setNotice(`${api} added to canvas.`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to load ${api}`);
      } finally {
        setBusy(null);
      }
    },
    [busy, describes, addNames]
  );

  const handlePaneClick = useCallback(() => {
    setSpot(null);
    setSpotEdgeId(null);
    setPopover(null);
    setRtPopover(null);
    setGraphSelected(null);
  }, []);

  // ERD link click: ring the parent end, dark-frame the child end, dim the
  // rest - the relationship reads at a glance. Empty canvas clears.
  const handleEdgeClick = useCallback(
    (edgeId: string) => {
      const edge = elements.edges.find((e) => e.id === edgeId);
      if (!edge) return;
      const apiOf = (id: string) => elements.nodes.find((n) => n.id === id)?.data.apiName ?? id;
      const a = apiOf(edge.source);
      const b = apiOf(edge.target);
      const via = typeof edge.label === "string" && edge.label ? edge.label : edgeId.split("|")[2] ?? "";
      setSpot({ focus: a, related: new Set([a, b]), soft: true });
      setSpotEdgeId(edgeId);
      setNotice(via ? `${a} ↔ ${b} via ${via} - click empty canvas to clear.` : `${a} ↔ ${b} highlighted - click empty canvas to clear.`);
    },
    [elements]
  );

  // Presentation mode: same-tab full screen (PPT-style). Hides the app header
  // + footer via body.sf-present - no route switch, no token handoff.
  // Exit is icon-only on purpose: Esc belongs to the laser + picklist popover.
  const [present, setPresent] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("sf-present", present);
    return () => {
      document.body.classList.remove("sf-present");
    };
  }, [present]);
  const popOut = useCallback(() => {
    setPresent((v) => !v);
  }, []);

  const focusOptions = [...describes.keys()].sort();

  // ── Collaboration share-out: live canvas → structure payload. Positions
  // come from the laid-out ERD tables (drags included); links rebuild from
  // metadata on the receiving side, so edges never travel.
  const getShareStructure = useCallback((includeNotes: boolean): ShareStructure => {
    const nodes = [...describes.keys()];
    const positions: Record<string, { x: number; y: number }> = {};
    for (const n of baseElements.nodes) {
      const api = (n.data as ErdNodeData).apiName;
      positions[api] = { x: n.position.x, y: n.position.y };
    }
    const out: ShareStructure = {
      v: 1,
      name: `${labels.get(rootName) ?? rootName} canvas`,
      root: rootName,
      nodes,
      positions,
      view,
    };
    if (includeNotes && canvasNote.md.trim()) out.notes = canvasNote.md;
    const picked: NonNullable<ShareStructure["entityNotes"]> = {};
    if (includeNotes) {
      for (const api of nodes) {
        const rows = (entityLog[api] ?? []).filter((r) => (r.body ?? "").trim());
        if (rows.length > 0) {
          picked[api] = rows.map((r) => ({
            ...(r.title.trim() ? { title: r.title.trim() } : {}),
            text: (r.body ?? "").slice(0, 50_000),
            ...(r.kind ? { kind: r.kind } : {}),
            status: r.status,
            updatedAt: r.updatedAt,
          }));
        }
      }
      if (Object.keys(picked).length > 0) out.entityNotes = picked;
      const canvasRows = entityLog[CANVAS_LOG_API] ?? [];
      if (canvasRows.length > 0) {
        out.todos = canvasRows.map((t) => ({
          id: t.id,
          title: t.title,
          body: t.body,
          assignee: t.assignee,
          dueDate: t.dueDate,
          ...(t.kind ? { kind: t.kind } : {}),
          ...(t.owner ? { owner: t.owner } : {}),
          ...(t.team ? { team: t.team } : {}),
          ...(t.priority ? { priority: t.priority } : {}),
          status: t.status,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }));
      }
    }
    return out;
  }, [baseElements, describes, rootName, view, canvasNote, entityLog, labels]);

  return (
    <div
      className="flex gap-3"
      style={present ? { height: "calc(100vh - 12px)", minHeight: 480 } : { height: "calc(100vh - 100px)", minHeight: 520 }}
    >
      {present && (
        <button
          type="button"
          onClick={() => setPresent(false)}
          aria-label="Exit full-screen presentation"
          title="Exit full screen"
          className="fixed bottom-5 right-5 z-50 flex h-10 w-10 items-center justify-center rounded-full bg-ivory-950 text-ivory-100 shadow-xl hover:bg-bronze-600 transition-colors cursor-pointer"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
          </svg>
        </button>
      )}
      {/* ── Collapsible explorer sidebar ── */}
      {sideOpen ? (
        <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
          <div className="border-b border-[var(--color-line-soft)] px-3.5 py-2">
            <div className="flex items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-ivory-950">Schema Explorer</h2>
              <span className="shrink-0 font-mono text-[10px] font-medium text-ivory-500">
                {describes.size > 0 ? `${describes.size} on canvas` : ""}
              </span>
              <button
                type="button"
                onClick={() => setSideOpen(false)}
                aria-label="Collapse explorer panel"
                title="Collapse panel"
                className="shrink-0 rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="m14 6-6 6 6 6" />
                </svg>
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <Badge variant="info">ERD</Badge>
              <span className="mx-0.5 h-4 w-px bg-[var(--color-line-soft)]" aria-hidden="true" />
            <button
              type="button"
              onClick={popOut}
              aria-label={present ? "Exit full-screen presentation" : "Enter full-screen presentation"}
              title={present ? "Exit full screen" : "Full screen: hide header + footer for presenting (Esc stays with the laser)"}
              className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
            >
              {present ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setNoteEntity(null);
                setNotesOpen((v) => !v);
              }}
              aria-label={notesOpen ? "Close design notes" : "Open design notes"}
              aria-pressed={notesOpen}
              title="Design notes - canvas markdown + per-object TODOs, autosaved per org"
              className={`relative rounded-md p-1.5 transition-colors cursor-pointer ${notesOpen ? "text-ivory-950 bg-ivory-300" : "text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300"}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
                <path d="m13.5 6.5 3 3" />
              </svg>
              {(openTodoCount > 0 || !noteBodyEmpty(canvasNote)) && (
                <span className={`absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border border-white ${openTodoCount > 0 ? "bg-red-500" : "bg-bronze-500"}`} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={saveSnapshot}
              disabled={busy != null || describes.size === 0}
              aria-label="Save canvas snapshot"
              title="Snapshot this canvas - restorable per org from history"
              className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer disabled:opacity-40"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M8 7l1.5-2.5h5L16 7" />
                <rect x="3" y="7" width="18" height="13" rx="2" />
                <circle cx="12" cy="13.5" r="3.2" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setShowHistory(true)}
              aria-label={`Snapshot history, ${snapshots.length} saved`}
              title={`Snapshot history (${snapshots.length} for this org)`}
              className="relative rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 2" />
              </svg>
              {snapshots.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 inline-flex items-center justify-center rounded-full bg-ivory-950 text-ivory-100 text-[9px] font-bold">
                  {snapshots.length > 99 ? "99+" : snapshots.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setInboxOpen(true)}
              aria-label={`Architecture Inbox, ${inboxCounts.open} open items`}
              title="Architecture Inbox - notes, tasks and Action Pack across this org's canvases"
              className="relative rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M4 5h16v11H8l-4 4V5Z" />
                <path d="M8 9h8M8 12.5h5" />
              </svg>
              {inboxCounts.open > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-0.5 inline-flex items-center justify-center rounded-full bg-bronze-600 text-white text-[9px] font-bold">
                  {inboxCounts.open > 99 ? "99+" : inboxCounts.open}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowShare(true)}
              disabled={describes.size === 0}
              aria-label="Share this canvas with a link"
              title="Share canvas - teammates connect their own org and rebuild it (self-destructs in 30 min)"
              className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer disabled:opacity-40"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                setRecordError(null);
                setRecordModalOpen(true);
              }}
              disabled={describes.size === 0 || !rootName}
              aria-label="Walk live record data from a root record Id"
              title="Record Walk - enter a root record Id, then pull live data node by node (session only, never stored)"
              className="relative rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer disabled:opacity-40"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
                <path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13" />
                <path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
              </svg>
              {recordRoot && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border border-white bg-bronze-500" aria-hidden="true" />
              )}
            </button>
            </div>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
            <div>
              <Input
                placeholder="Add object - try Account…"
                value={rootSearch}
                onChange={(e) => setRootSearch(e.target.value)}
                aria-label="Choose root object for ERD"
              />
              {rootSearch.trim() && (
                <div className="mt-1.5 max-h-44 overflow-y-auto rounded-lg border border-[var(--color-line)] divide-y divide-[var(--color-line-soft)]" role="group" aria-label="Matching objects - check to stage">
                  {filteredObjects.length === 0 ? (
                    <p className="p-3 text-xs text-ivory-600">No objects match.</p>
                  ) : (
                    filteredObjects.map((o) => {
                      const onCanvas = describes.has(o.name);
                      const checked = onCanvas || staged.has(o.name);
                      return (
                        <label
                          key={o.name}
                          className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors hover:bg-ivory-300 ${
                            checked ? "bg-ivory-200" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={onCanvas}
                            onChange={() => toggleStage(o.name)}
                            className="h-4 w-4 shrink-0 rounded border-ivory-400 bg-white text-bronze-600 focus:ring-bronze-500 disabled:opacity-60"
                            aria-label={onCanvas ? `${o.label} (already on canvas)` : `Stage ${o.label}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-ivory-950">{o.label}</span>
                            <span className="block truncate text-[11px] font-mono text-ivory-600">{o.name}</span>
                          </span>
                          {onCanvas && (
                            <span className="shrink-0 rounded border border-bronze-300 bg-bronze-100 px-1 py-px text-[9px] font-semibold text-bronze-700">
                              On canvas
                            </span>
                          )}
                        </label>
                      );
                    })
                  )}
                </div>
              )}
              {staged.size > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-[var(--color-accent-soft)] bg-[var(--color-accent-bg)] px-3 py-2">
                  <span className="flex-1 text-[11px] font-medium text-ivory-900">
                    {staged.size} staged
                  </span>
                  <button
                    type="button"
                    onClick={() => setStaged(new Set())}
                    className="text-[11px] text-ivory-600 hover:text-ivory-950 underline cursor-pointer"
                  >
                    Clear
                  </button>
                  <Button size="sm" onClick={applyStaged} disabled={!!busy} loading={!!busy}>
                    Add to canvas
                  </Button>
                </div>
              )}
            </div>

            {!rootName && describes.size === 0 && (
              <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] p-3.5">
                <p className="flex items-center gap-1.5 text-xs font-bold text-ivory-950">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" className="text-bronze-600">
                    <circle cx="12" cy="12" r="3" />
                    <circle cx="5" cy="5" r="2" />
                    <circle cx="19" cy="5" r="2" />
                    <circle cx="5" cy="19" r="2" />
                    <circle cx="19" cy="19" r="2" />
                    <path d="M6.5 6.5 10 10m4 0 3.5-3.5M6.5 17.5 10 14m4 0 3.5 3.5" />
                  </svg>
                  Pick a root object
                </p>
                <ul className="mt-2.5 space-y-2">
                  <li className="flex items-start gap-2">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className="mt-0.5 shrink-0 text-bronze-600">
                      <circle cx="11" cy="11" r="7" />
                      <path d="m20 20-3.5-3.5" />
                    </svg>
                    <p className="text-[11px] leading-relaxed text-ivory-700"><strong className="text-ivory-950">Search</strong> above - try Account, Lead, Opportunity.</p>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className="mt-0.5 shrink-0 text-bronze-600">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    <p className="text-[11px] leading-relaxed text-ivory-700"><strong className="text-ivory-950">Tick + Add to canvas</strong> - it lands as an ERD table.</p>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true" className="mt-0.5 shrink-0 text-bronze-600">
                      <circle cx="6" cy="6" r="2.5" />
                      <circle cx="18" cy="18" r="2.5" />
                      <path d="M8 8l8 8" />
                    </svg>
                    <p className="text-[11px] leading-relaxed text-ivory-700"><strong className="text-ivory-950">Discover children + parents</strong> - links draw themselves.</p>
                  </li>
                </ul>
              </div>
            )}

            {rootName && (
              <>
                <label className="block text-xs font-medium text-ivory-700" title="Working node for Discover / Remove - picking one glides it to canvas center">
                  <span className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        focusCanvasOn(focusName || rootName);
                      }}
                      title={`Center canvas on ${focusName || rootName}`}
                      aria-label={`Center canvas on ${focusName || rootName}`}
                      className="cursor-pointer rounded p-0.5 text-[#722F37] hover:bg-[#F0EBE0]"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                        <circle cx="12" cy="12" r="7" />
                        <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
                        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                      </svg>
                    </button>
                    <span>Focus node - centers canvas</span>
                  </span>
                  <select
                    value={focusName}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleFocusChange(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-xs font-medium text-ivory-950 focus:outline-none focus:border-bronze-500 cursor-pointer"
                    aria-label="Focused object"
                  >
                    {focusOptions.map((n) => (
                      <option key={n} value={n}>{labels.get(n) ?? n} ({n})</option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-1 gap-1.5">
                  <Button size="sm" variant="secondary" onClick={discoverChildren} disabled={!!busy} title="Expand one level under the focused node">
                    Discover children
                  </Button>
                  <Button size="sm" variant="secondary" onClick={showParents} disabled={!!busy} title="Ring the focused node and highlight its lookup parents">
                    Show parents
                  </Button>
                  <Button size="sm" onClick={discoverCustomLinked} disabled={!!busy} loading={!!busy} title="Scout only: fans every custom object linked to the root neighborhood into the left tree as dashed previews. Nothing lands on canvas until you open rows and hit Add visible to ERD.">
                    Custom links
                  </Button>
                  <Button size="sm" variant="secondary" onClick={refreshAll} disabled={!!busy || describes.size === 0} title="Re-fetch metadata for every object on canvas and report what changed">
                    Refresh all
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void restoreSaved()} disabled={!!busy || !orgKey} title="Reload the autosaved canvas for this org - the same workspace restore that runs on connect, on demand">
                    Restore saved
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setNoteEntity(null);
                      setNotesOpen((v) => !v);
                    }}
                    title="Canvas design notes - markdown, autosaved per org, attaches to snapshots"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                        <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
                        <path d="m13.5 6.5 3 3" />
                      </svg>
                      {notesOpen ? "Hide notes" : "Design notes"}
                      {openTodoCount > 0 && (
                        <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                          {openTodoCount}
                        </span>
                      )}
                    </span>
                  </Button>
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => { if (focusName && focusName !== rootName) setConfirmRemove(focusName); }} disabled={!focusName || focusName === rootName || !!busy} className="flex-1" title="Remove the focused object from the canvas">
                      Remove
                    </Button>
                    <Button size="sm" variant="ghost" onClick={resetAll} disabled={describes.size === 0 || !!busy} className="flex-1" title="Re-run auto-layout and re-fit - keeps every node">
                      Reset view
                    </Button>
                  </div>
                  {confirmClear ? (
                    <span className="flex items-center gap-2 text-[11px] text-ivory-700">
                      Empty the whole canvas?
                      <button type="button" onClick={clearCanvas} className="font-semibold text-red-700 underline cursor-pointer">
                        Yes, clear
                      </button>
                      <button type="button" onClick={() => setConfirmClear(false)} className="underline cursor-pointer">
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmClear(true)}
                      disabled={describes.size === 0}
                      className="text-[11px] text-ivory-600 hover:text-red-700 underline cursor-pointer disabled:opacity-40"
                    >
                      Clear canvas
                    </button>
                  )}
                </div>
              </>
            )}

            {busy && <p className="text-xs text-bronze-600" role="status">{busy}</p>}
            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                {error}
              </div>
            )}
            {notice && <p className="text-[11px] leading-relaxed text-ivory-700">{notice}</p>}

            {describes.size > 0 && (
              <details id="schema-canvas-nodes" className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)]">
                <summary className="cursor-pointer list-none px-2.5 py-2 text-[11px] font-semibold text-ivory-900 hover:text-ivory-950">
                  Canvas nodes ({describes.size})
                  <span className="ml-1 font-normal text-ivory-500">- eye to curate Manual mode, tick + remove for bulk</span>
                </summary>
                <div className="border-t border-[var(--color-line-soft)] p-1.5 pb-0.5">
                  <input
                    value={nodeSearch}
                    onChange={(e) => setNodeSearch(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder="Search canvas nodes…"
                    aria-label="Search canvas nodes"
                    spellCheck={false}
                    className="w-full rounded-md border border-[var(--color-line)] bg-white px-2 py-1 font-mono text-[11px] text-ivory-900 focus:border-bronze-500 focus:outline-none"
                  />
                </div>
                <ul className="max-h-44 space-y-0.5 overflow-y-auto p-1.5">
                  {[...describes.keys()]
                    .sort()
                    .filter((name) => {
                      const q = nodeSearch.trim().toLowerCase();
                      return !q || name.toLowerCase().includes(q) || (labels.get(name) ?? "").toLowerCase().includes(q);
                    })
                    .map((name) => {
                    const isRoot = name === rootName;
                    const hidden = hiddenIds.has(name);
                    const checked = manageChecked.has(name);
                    return (
                      <li
                        key={name}
                        className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 ${hidden ? "opacity-50" : ""}`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleHidden(name)}
                          aria-label={hidden ? `Show ${name}` : `Hide ${name}`}
                          title={hidden ? "Show (manual filter)" : "Hide (manual filter)"}
                          className="rounded p-1 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
                        >
                          {hidden ? (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                              <path d="M3 3l18 18M10.5 5.2A9.8 9.8 0 0 1 12 5c7 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.6 6.6C4 8.4 2 12 2 12s3 7 10 7c1.5 0 2.9-.3 4.1-.8" />
                              <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                            </svg>
                          ) : (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                        {!isRoot && (
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setManageChecked((prev) => {
                                const next = new Set(prev);
                                if (next.has(name)) next.delete(name);
                                else next.add(name);
                                return next;
                              });
                            }}
                            aria-label={`Select ${name} for bulk remove`}
                            className="h-3.5 w-3.5 shrink-0 rounded border-ivory-400 text-bronze-600"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setFocusName(name);
                            setSpot(null);
                            if (view === "graph") setGraphSelected(name);
                          }}
                          className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-ivory-800 hover:text-ivory-950 cursor-pointer"
                          title={`${labels.get(name) ?? name} - click to focus`}
                        >
                          {name}
                          {isRoot && <span className="ml-1 text-[9px] font-bold text-bronze-600">ROOT</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {[...manageChecked].some((n) => n !== rootName && describes.has(n)) && (
                  <div className="border-t border-[var(--color-line-soft)] p-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full text-red-700"
                      onClick={() => {
                        removeMany([...manageChecked]);
                        setManageChecked(new Set());
                      }}
                    >
                      Remove checked
                    </Button>
                  </div>
                )}
              </details>
            )}

            <div className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-2.5 text-[10px] leading-relaxed text-ivory-600">
              <p className="font-semibold text-ivory-900 mb-1">Legend</p>
              {view === "graph" ? (
                <>
                  <p><strong className="text-ivory-950">Solid</strong> = master-detail · <strong className="text-ivory-950">dotted</strong> = lookup</p>
                  <p>Dashed bubble = preview, click for details · ring = selected · click empty canvas to clear</p>
                </>
              ) : (
                <>
                  <p><strong className="text-ivory-950">Key</strong> = Id / Name · <strong className="text-bronze-600">Link</strong> = lookup</p>
                  <p><strong className="text-red-600">*</strong> = required · <strong className="text-bronze-700">JUNCTION</strong> = 2+ required lookups (audit fields excluded)</p>
                  <p>Solid = master-detail · dotted = lookup · click a line to reveal its lookup field · drag nodes to rearrange</p>
                </>
              )}
            </div>
          </div>
        </aside>
      ) : (
        <div className="flex w-11 shrink-0 flex-col items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] py-3">
          <button
            type="button"
            onClick={() => setSideOpen(true)}
            aria-label="Expand explorer panel"
            title="Expand explorer panel"
            className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="m10 6 6 6-6 6" />
            </svg>
          </button>
          <span className="text-[10px] font-bold text-ivory-500" style={{ writingMode: "vertical-rl" }}>
            {describes.size > 0 ? `${describes.size} objects` : "Explorer"}
          </span>
        </div>
      )}

      {/* ── Author queue: deploying / failed schema changes ── */}
      {authorQueue.length > 0 && (
        <div
          role="status"
          aria-label="Schema deploys"
          className="shrink-0 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent-dark)]">
              Author queue
            </span>
            {authorQueue.map((c) => (
              <span
                key={c.id}
                className="flex items-center gap-1.5 font-mono text-[11px]"
                title={c.status === "failed" && c.error ? `${c.label}: ${c.error}` : c.label}
              >
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${
                    c.status === "deploying" ? "bg-amber-500" : "bg-red-500"
                  }`}
                />
                <span className="text-[var(--color-ink-soft)]">{c.label}</span>
                <span className={c.status === "failed" ? "text-red-700 font-bold" : "text-[var(--color-muted)]"}>
                  {c.status === "deploying" ? "deploying…" : "failed"}
                </span>
                {c.status === "failed" && (
                  <button
                    type="button"
                    onClick={() => retryAuthorChange(c.id)}
                    className="font-bold text-bronze-600 hover:text-bronze-700 underline cursor-pointer"
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismissAuthorChange(c.id)}
                  aria-label={`Dismiss ${c.label}`}
                  className="text-[var(--color-muted)] hover:text-[var(--color-ink)] cursor-pointer"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Full-height canvas ── */}
      <div className="min-w-0 flex-1 min-h-0 flex flex-col gap-2">
        {rootName && describes.size > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 gap-y-2 shrink-0">
            <div className="flex rounded-lg border border-[var(--color-line)] overflow-hidden bg-[var(--color-surface)]" role="tablist" aria-label="Canvas view">
              {(["erd", "graph"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => {
                    setView(v);
                    setGraphSelected(null);
                  }}
                  title={v === "erd" ? "ERD tables with fields" : "Radial graph - root in the middle, fan out"}
                  className={`px-3 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                    view === v ? "bg-ivory-950 text-ivory-100" : "text-ivory-700 hover:text-ivory-950"
                  }`}
                >
                  {v === "erd" ? "ERD" : "Graph"}
                </button>
              ))}
            </div>
            <span className="mx-1 h-4 w-px bg-[var(--color-line)]" aria-hidden="true" />
            {view === "erd" && (
              <button
                type="button"
                onClick={() => setAuthorMode((v) => !v)}
                aria-pressed={authorMode}
                title={authorMode ? "Exit Author mode" : "Author mode: create custom fields, objects, and relationships on this org"}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                  authorMode
                    ? "bg-ivory-950 text-ivory-100 border-ivory-950"
                    : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-700 hover:border-[var(--color-accent)]"
                }`}
              >
                {authorMode ? "Authoring" : "Author"}
              </button>
            )}
            {view === "erd" && authorMode && (
              <button
                type="button"
                onClick={() => setAuthorDialog({ kind: "object" })}
                title="Create a new custom object on this org"
                className="rounded-full border border-bronze-600 bg-bronze-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors cursor-pointer hover:bg-bronze-700"
              >
                + Object
              </button>
            )}
            {view === "erd" && authorMode && (
              <span
                className="hidden xl:inline font-mono text-[10px] text-ivory-500"
                title="Drag from one table's edge to another to draw a relationship"
              >
                drag table-to-table to relate
                {isProductionOrg && (
                  <span className="ml-2 rounded border border-amber-300 bg-amber-50 px-1.5 py-px font-bold text-amber-800">
                    PRODUCTION ORG
                  </span>
                )}
              </span>
            )}
            {(["all", "standard", "custom", "manual"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilterMode(f)}
                aria-pressed={filterMode === f}
                title={
                  f === "all" ? "Show everything on canvas"
                  : f === "standard" ? "Show standard objects only"
                  : f === "custom" ? "Show custom objects only"
                  : hiddenIds.size === 0
                    ? "Nothing hidden yet - hide nodes with the eye icon in Canvas nodes, then Manual keeps only the rest"
                    : `Showing ${describes.size - hiddenIds.size} of ${describes.size} - eyes control what stays`
                }
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize transition-colors cursor-pointer ${
                  filterMode === f
                    ? "bg-ivory-950 text-ivory-100 border-ivory-950"
                    : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-700 hover:border-[var(--color-accent)]"
                }`}
              >
                {f}
                {f === "manual" && hiddenIds.size > 0 && (
                  <span className="ml-1 font-mono text-[10px] opacity-70">
                    {describes.size - hiddenIds.size}/{describes.size}
                  </span>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setHidePanel(hideSystem || (dismissedIds.size === 0 && dismissedEdges.size === 0) ? "system" : "graph")}
              aria-pressed={hideSystem}
              title="Hide: review the system sweep, allow-list per item, or manage every graph entity - Neural honors the same list"
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                hideSystem
                  ? "bg-bronze-600 text-white border-bronze-600"
                  : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-600 hover:text-ivory-950"
              }`}
            >
              Hide{systemHiddenCount + dismissedIds.size + dismissedEdges.size > 0 ? ` · ${systemHiddenCount + dismissedIds.size + dismissedEdges.size}` : ""}
            </button>
            {view === "erd" && (
              <>
                <span className="relative" ref={tagsRef}>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !tagsOpen;
                      closeTagSurfaces();
                      setTagsOpen(next);
                    }}
                    aria-expanded={tagsOpen}
                    title="Tag inventory - create canvas tags (persisted on this canvas project)"
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                      tagsOpen
                        ? "bg-ivory-950 text-ivory-100 border-ivory-950"
                        : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-700 hover:border-[var(--color-accent)]"
                    }`}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
                      <path d="M12 8v6M9 11h6" />
                    </svg>
                    Tags{tagRegistry.length > 0 ? ` · ${tagRegistry.length}` : ""}
                  </button>
                  {tagsOpen && (
                    <div
                      role="dialog"
                      aria-label="Tag inventory"
                      className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-[0_16px_48px_-12px_rgba(24,20,12,0.4)]"
                    >
                      <p className="text-[11px] font-bold text-ivory-950">Tag inventory</p>
                      <p className="mt-0.5 text-[10px] text-ivory-500">Free-text names, fixed 8 colors - persisted on this canvas project.</p>
                      <div className="mt-2">
                        <TagCreator onCreate={(name, color) => addTag(name, color)} idPrefix="tag-inventory" />
                      </div>
                      {tagRegistry.length > 0 && (
                        <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto border-t border-[var(--color-line-soft)] pt-2">
                          {tagRegistry.map((t) => (
                            <li key={t.id} className="flex items-center gap-2 rounded-lg border border-[var(--color-line-soft)] px-2 py-1.5 text-[11px] font-semibold text-ivory-800">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} aria-hidden="true" />
                              <span className="min-w-0 flex-1 truncate">{t.name}</span>
                              <span className="shrink-0 font-mono text-[10px] opacity-70">
                                {(tagCounts[t.id] ?? 0)} node{(tagCounts[t.id] ?? 0) === 1 ? "" : "s"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-2 flex items-center justify-between border-t border-[var(--color-line-soft)] pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            closeTagSurfaces();
                            setTagManagerOpen(true);
                          }}
                          className="cursor-pointer text-[11px] font-semibold text-bronze-700 underline decoration-bronze-300 underline-offset-2 hover:text-bronze-800"
                        >
                          Rename, recolor, delete…
                        </button>
                        <button
                          type="button"
                          onClick={() => setTagsOpen(false)}
                          className="cursor-pointer rounded-lg border border-ivory-950 bg-ivory-950 px-3 py-1.5 text-[11px] font-semibold text-ivory-100 transition-colors hover:bg-ivory-800"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </span>
                <span className="relative" ref={filterRef}>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !filterOpen;
                      closeTagSurfaces();
                      setFilterOpen(next);
                    }}
                    aria-expanded={filterOpen}
                    title={
                      tagFilter.size > 0
                        ? `Filtering by ${tagFilter.size} tag${tagFilter.size === 1 ? "" : "s"} (${tagMode}) - click to change`
                        : "Filter canvas by tag - multi-select, Dim or Hide, reset"
                    }
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                      filterOpen || tagFilter.size > 0
                        ? "bg-ivory-950 text-ivory-100 border-ivory-950"
                        : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-700 hover:border-[var(--color-accent)]"
                    }`}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                      <path d="M4 5h16l-6.5 7.5V19l-3 2v-8.5L4 5Z" />
                    </svg>
                    Filter{tagFilter.size > 0 ? ` · ${tagFilter.size} on` : ""}
                  </button>
                  {filterOpen && (
                    <div
                      role="dialog"
                      aria-label="Filter by tag"
                      className="absolute left-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-[0_16px_48px_-12px_rgba(24,20,12,0.4)]"
                    >
                      <p className="text-[11px] font-bold text-ivory-950">Filter canvas</p>
                      {tagRegistry.length === 0 ? (
                        <p className="mt-1 text-[11px] leading-relaxed text-ivory-600">No tags yet - create them under Tags first.</p>
                      ) : (
                        <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
                          {tagRegistry.map((t) => {
                            const active = tagFilter.has(t.id);
                            return (
                              <li key={t.id}>
                                <button
                                  type="button"
                                  onClick={() => setTagFilter((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(t.id)) next.delete(t.id);
                                    else next.add(t.id);
                                    return next;
                                  })}
                                  aria-pressed={active}
                                  title={active ? `Unfilter ${t.name}` : `Show ${t.name} - ${tagMode === "dim" ? "everything else dims" : "everything else hides and the layout rebalances"}`}
                                  className={`flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-[11px] font-semibold transition-colors ${
                                    active
                                      ? "border-ivory-950 bg-ivory-950 text-ivory-100"
                                      : "border-[var(--color-line-soft)] text-ivory-800 hover:border-[var(--color-accent)]"
                                  }`}
                                >
                                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} aria-hidden="true" />
                                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                                  <span className="shrink-0 font-mono text-[10px] opacity-70">{tagCounts[t.id] ?? 0}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {tagFilter.size > 0 && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <span role="group" aria-label="Tag filter mode" className="flex rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5" title="Dim keeps every node and fades the rest; Hide drops the rest so the layout rebalances">
                            {(["dim", "hide"] as const).map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => setTagMode(m)}
                                aria-pressed={tagMode === m}
                                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize transition-colors cursor-pointer ${
                                  tagMode === m ? "bg-ivory-950 text-ivory-100" : "text-ivory-600 hover:text-ivory-950"
                                }`}
                              >
                                {m}
                              </button>
                            ))}
                          </span>
                          <button
                            type="button"
                            onClick={() => setTagFilter(new Set())}
                            title="Clear the tag filter - show everything"
                            className="cursor-pointer text-[11px] font-semibold text-ivory-600 underline hover:text-ivory-950"
                          >
                            Reset
                          </button>
                        </div>
                      )}
                      <div className="mt-2 flex items-center justify-between border-t border-[var(--color-line-soft)] pt-2">
                        <span className="text-[10px] text-ivory-500">
                          {tagMode === "hide" ? `${visibleDescribes.size} of ${describes.size} shown` : `${describes.size} nodes, rest dimmed`}
                        </span>
                        <button
                          type="button"
                          onClick={() => setFilterOpen(false)}
                          className="cursor-pointer rounded-lg border border-ivory-950 bg-ivory-950 px-3 py-1.5 text-[11px] font-semibold text-ivory-100 transition-colors hover:bg-ivory-800"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </span>
                <span className="relative" ref={linkRef}>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !linkOpen;
                      closeTagSurfaces();
                      setLinkOpen(next);
                    }}
                    aria-expanded={linkOpen}
                    title="Link one tag to many nodes at once - or press T on a focused node"
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                      linkOpen
                        ? "bg-ivory-950 text-ivory-100 border-ivory-950"
                        : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-700 hover:border-[var(--color-accent)]"
                    }`}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
                    </svg>
                    Link
                  </button>
                  {linkOpen && (
                    <div
                      role="dialog"
                      aria-label="Link tags to nodes"
                      className="absolute left-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-[0_16px_48px_-12px_rgba(24,20,12,0.4)]"
                    >
                      <p className="text-[11px] font-bold text-ivory-950">Link tags to nodes</p>
                      {tagRegistry.length === 0 ? (
                        <p className="mt-1 text-[11px] leading-relaxed text-ivory-600">No tags yet - create them under Tags first.</p>
                      ) : (
                        <>
                          <div className="mt-1.5 flex flex-wrap gap-1" role="group" aria-label="Choose a tag to link">
                            {tagRegistry.map((t) => {
                              const sel = (linkTagId ?? tagRegistry[0].id) === t.id;
                              return (
                                <button
                                  key={t.id}
                                  type="button"
                                  onClick={() => setLinkTagId(t.id)}
                                  aria-pressed={sel}
                                  title={`Link ${t.name} to nodes below`}
                                  className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold transition-colors ${
                                    sel
                                      ? "border-ivory-950 bg-ivory-950 text-ivory-100"
                                      : "border-[var(--color-line-soft)] text-ivory-800 hover:border-[var(--color-accent)]"
                                  }`}
                                >
                                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} aria-hidden="true" />
                                  {t.name}
                                </button>
                              );
                            })}
                          </div>
                          {(() => {
                            const linkTag = tagById.get(linkTagId ?? "") ?? tagRegistry[0];
                            if (!linkTag) return null;
                            const linked = new Set(
                              Object.entries(nodeTags)
                                .filter(([, ids]) => ids.includes(linkTag.id))
                                .map(([api]) => api)
                            );
                            const names = [...describes.keys()].sort();
                            return (
                              <>
                                <p className="mt-2 text-[10px] text-ivory-500">
                                  Tick nodes to link <span className="font-bold" style={{ color: linkTag.color }}>{linkTag.name}</span> - {linked.size} linked.
                                </p>
                                <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto">
                                  {names.map((api) => {
                                    const on = linked.has(api);
                                    return (
                                      <li key={api}>
                                        <button
                                          type="button"
                                          onClick={() => toggleNodeTag(api, linkTag.id)}
                                          aria-pressed={on}
                                          title={on ? `Unlink ${linkTag.name} from ${api}` : `Link ${linkTag.name} to ${api}`}
                                          className={`flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-[11px] font-semibold transition-colors ${
                                            on
                                              ? "border-ivory-950 bg-ivory-950 text-ivory-100"
                                              : "border-[var(--color-line-soft)] text-ivory-800 hover:border-[var(--color-accent)]"
                                          }`}
                                        >
                                          <span className="min-w-0 flex-1 truncate font-mono">{api}</span>
                                          <span className="max-w-[40%] shrink-0 truncate text-[10px] opacity-70">{labels.get(api) ?? ""}</span>
                                          {on && (
                                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true" className="shrink-0">
                                              <path d="m4 12.5 5 5L20 6.5" />
                                            </svg>
                                          )}
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </>
                            );
                          })()}
                        </>
                      )}
                      <div className="mt-2 flex items-center justify-end border-t border-[var(--color-line-soft)] pt-2">
                        <button
                          type="button"
                          onClick={() => setLinkOpen(false)}
                          className="cursor-pointer rounded-lg border border-ivory-950 bg-ivory-950 px-3 py-1.5 text-[11px] font-semibold text-ivory-100 transition-colors hover:bg-ivory-800"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </span>
              </>
            )}
            {view === "graph" && (
              <span
                role="group"
                aria-label="Family layout"
                className="flex rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5"
                title="Mesh: one bubble per object, every attach path draws its edge. Linear: duplicate bubbles per parent for independent trees."
              >
                {(["mesh", "linear"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setFamilyMode(m)}
                    aria-pressed={familyMode === m}
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize transition-colors cursor-pointer ${
                      familyMode === m ? "bg-ivory-950 text-ivory-100" : "text-ivory-600 hover:text-ivory-950"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </span>
            )}
            {view === "graph" && graphElements.extended > 0 && (
              <span
                className="rounded-full border border-bronze-300 bg-bronze-100 px-2.5 py-1 text-[11px] font-medium text-bronze-700"
                title="Family-tree generations extended beyond the root neighborhood - Collapse per node to prune"
              >
                +{graphElements.extended} extended
              </span>
            )}
            {view === "graph" && (
              <button
                type="button"
                onClick={() => {
                  // Design mode: graph starts at the root bubble alone; every
                  // added object lands left (parent) / right (child) by role.
                  // Leaving restores the full neighborhood.
                  setDesignMode((v) => !v);
                  setDesignIds(new Set());
                }}
                aria-pressed={designMode}
                title={designMode ? "Exit design mode - restore the full neighborhood" : "Design from zero: root bubble only, add objects one by one with roles placing them"}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                  designMode
                    ? "bg-ivory-950 text-ivory-100 border-ivory-950"
                    : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-700 hover:border-[var(--color-accent)]"
                }`}
              >
                Design{designMode && designIds.size > 0 ? ` · ${designIds.size}` : ""}
              </button>
            )}
            {view === "graph" && (
              neuralRunning ? (
                <button
                  type="button"
                  onClick={() => {
                    godCancel.current = true;
                  }}
                  title="Stop the neural sweep, keeping what landed so far"
                  className="rounded-full border border-red-300 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 transition-colors cursor-pointer"
                >
                  Stop neural
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void neuralMode()}
                  disabled={!!busy}
                  title="Neural mode: recursively discover EVERYTHING reachable from the root and fan the full mesh out as lite previews. ERD untouched - filter afterwards. Capped, cancellable."
                  className="rounded-full border border-bronze-600 bg-bronze-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors cursor-pointer hover:bg-bronze-700 disabled:opacity-40"
                >
                  Neural
                </button>
              )
            )}
            {view === "graph" && (expanded.size > 0 || dismissedIds.size > 0 || dismissedEdges.size > 0 || graphSelected || designIds.size > 0) && (
              <button
                type="button"
                onClick={() => {
                  // Reset graph: back to step 1 (root neighborhood, no
                  // expansions, no dismissals, remembered zoom cleared).
                  setExpanded(new Map());
                  setDismissedIds(new Set());
                  setDismissedEdges(new Set());
                  setDesignIds(new Set());
                  setDesignMode(false);
                  setGraphSelected(null);
                  setFamilyFor(null);
                  setFamily(null);
                  viewports.current = { ...viewports.current, graph: null };
                  setLayoutRev((r) => r + 1);
                  setNotice("Graph reset - root neighborhood restored.");
                }}
                title="Clear expansions, restores and selection - back to the root neighborhood"
                className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-semibold text-ivory-700 hover:border-red-400 hover:text-red-600 transition-colors cursor-pointer"
              >
                Reset
              </button>
            )}
            {view === "graph" && (
              <button
                type="button"
                onClick={() => void addVisibleToErd()}
                disabled={!!busy}
                title="Add visible graph bubbles to the ERD canvas - lite previews become solid tables"
                className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-semibold text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950 transition-colors cursor-pointer disabled:opacity-40"
              >
                + ERD
              </button>
            )}
            {view === "graph" && (
              <button
                type="button"
                onClick={syncFromCanvas}
                disabled={!!busy}
                title="Sync: pull every ERD-canvas object into the graph - related links first, the rest follow via 'canvas'"
                className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-semibold text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950 transition-colors cursor-pointer disabled:opacity-40"
              >
                Sync
              </button>
            )}
            {view === "graph" && (
              <button
                type="button"
                onClick={() => setAddObjectOpen(true)}
                disabled={!!busy}
                title="+ adds any sObject (Obj = Object) straight into the graph - search, tick, add. No ERD round-trip."
                className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-semibold text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950 transition-colors cursor-pointer disabled:opacity-40"
              >
                + Obj
              </button>
            )}
            {view === "graph" && (
              <button
                type="button"
                onClick={resetAll}
                disabled={describes.size === 0 || !!busy}
                title="Rebalance: re-run auto-layout and re-fit - keeps every node (same as Reset view in the explorer panel)"
                className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] font-semibold text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950 transition-colors cursor-pointer disabled:opacity-40"
              >
                Rebalance
              </button>
            )}
            <span className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => void refreshAll()}
                disabled={describes.size === 0 || !!busy}
                aria-label="Reload all canvas metadata fresh from the org"
                title="Reload all canvas metadata fresh from the org - re-fetch every object on canvas and report what changed"
                className="flex items-center rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950 transition-colors cursor-pointer disabled:opacity-40"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3" />
                  <path d="M18 4v4h-4M6 20v-4h4" />
                </svg>
              </button>
              {view === "graph" && (
                <button
                  type="button"
                  onClick={() => setNodesLocked((v) => !v)}
                  disabled={oobLocked}
                  aria-pressed={nodesLocked}
                  aria-label={nodesLocked ? "Unlock node positions" : "Lock node positions"}
                  title={
                    oobLocked
                      ? "Built-in lock is engaged - release it below to use the position lock"
                      : nodesLocked
                        ? "Unlock node positions (pan/zoom always work)"
                        : "Lock node positions - drag to arrange, lock to present (pan/zoom always work)"
                  }
                  className={`flex items-center rounded-full border p-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    nodesLocked
                      ? "bg-ivory-950 text-ivory-100 border-ivory-950"
                      : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-700 hover:border-[var(--color-accent)]"
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                    <rect x="4" y="11" width="16" height="9" rx="2" />
                    {nodesLocked ? (
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    ) : (
                      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
                    )}
                  </svg>
                </button>
              )}
              </span>
            {view === "graph" && graphElements.overflow > 0 && (
              <span
                className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800"
                title="Degenerate layout guard tripped - everything still drew, this is just a heads-up"
              >
                +{graphElements.overflow} placed far out
              </span>
            )}
          </div>
        )}
        {confirmRemove && (
          <ConfirmRemoveDialog apiName={confirmRemove} onConfirm={() => removeNode(confirmRemove)} onClose={() => setConfirmRemove(null)} />
        )}
        {tagPicker && (
          <TagPickerDialog
            apiName={tagPicker}
            registry={tagRegistry}
            assignedIds={nodeTags[tagPicker] ?? []}
            onToggle={toggleNodeTag}
            onCreate={(name, color) => addTag(name, color, tagPicker)}
            onManage={() => {
              setTagPicker(null);
              setTagManagerOpen(true);
            }}
            onClose={() => setTagPicker(null)}
          />
        )}
        {tagManagerOpen && (
          <TagManagerDialog
            registry={tagRegistry}
            counts={tagCounts}
            onRename={renameTag}
            onRecolor={recolorTag}
            onDelete={deleteTag}
            onCreate={(name, color) => addTag(name, color)}
            onClose={() => setTagManagerOpen(false)}
          />
        )}
        <div className="relative min-h-0 flex-1">
          {!rootName || describes.size === 0 ? (
            <div className="flex items-center justify-center rounded-xl border border-dashed border-[var(--color-line)] bg-[var(--color-surface)] p-6 h-full min-h-[420px]">
              <EmptyState
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="3" y="3" width="7" height="7" rx="1.5" />
                    <rect x="14" y="14" width="7" height="7" rx="1.5" />
                    <path d="M10 6.5h5.5a2 2 0 0 1 2 2V14M14 17.5H8.5a2 2 0 0 1-2-2V10" />
                  </svg>
                }
                title="Pick an object to map its data model"
                description="Search the explorer panel - the object lands on the infinite canvas as an ERD table. Discover children level by level, go full-depth, present with the laser, export hi-res PNG."
              />
            </div>
          ) : view === "erd" ? (
            <ErdCanvas
              nodes={elements.nodes}
              edges={elements.edges}
              onNodeClick={handleNodeClick}
              onEdgeClick={handleEdgeClick}
              onPaneClick={handlePaneClick}
              onViewportMove={() => setPopover(null)}
              connectable={authorMode}
              onConnectNodes={handleAuthorConnect}
              onNodeDragStop={handleErdDragStop}
              layoutRev={layoutRev}
              enforcedPositions={enforced}
              storedViewport={viewports.current.erd}
              onViewportChange={(v) => {
                viewports.current = { ...viewports.current, erd: v };
              }}
              nodesLocked={nodesLocked}
              onOobLockChange={setOobLocked}
              onResetView={resetAll}
              onExportDictionary={exportDictionary}
              ref={canvasRef}
            />
          ) : (
            <ErdCanvas
              nodes={graphElements.nodes}
              edges={graphElements.edges}
              onNodeClick={handleNodeClick}
              onPaneClick={handlePaneClick}
              onViewportMove={() => setPopover(null)}
              onNodeDragStop={handleGraphDragStop}
              layoutRev={layoutRev}
              enforcedPositions={null}
              storedViewport={viewports.current.graph}
              onViewportChange={(v) => {
                viewports.current = { ...viewports.current, graph: v };
              }}
              nodesLocked={nodesLocked}
              onOobLockChange={setOobLocked}
              ref={canvasRef}
            />
          )}
          {view === "graph" && detail && (
            <GraphDetailCard
              detail={detail}
              labels={labels}
              erdCount={describes.size}
              family={familyFor === (detail.kind === "loaded" ? detail.d.name : detail.n.apiName) ? family : null}
              drawnHere={linksOf.get(detail.kind === "loaded" ? detail.d.name : detail.n.apiName) ?? new Map<string, string[]>()}
              familyBusy={familyBusy}
              onClose={() => setGraphSelected(null)}
              onOpenInErd={() => {
                if (detail.kind === "loaded") {
                  setFocusName(detail.d.name);
                  setView("erd");
                }
              }}
              onMakeRoot={() => {
                if (detail.kind === "loaded") {
                  makeRoot(detail.d.name);
                }
              }}
              onLoad={() => {
                if (detail.kind === "lite") void loadLite(detail.n.apiName);
              }}
              onDismiss={() => {
                const api = detail.kind === "loaded" ? detail.d.name : detail.n.apiName;
                if (api === rootName) return;
                setDismissedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(api)) next.delete(api);
                  else next.add(api);
                  return next;
                });
              }}
              dismissed={dismissedIds.has(detail.kind === "loaded" ? detail.d.name : detail.n.apiName)}
              onDiscoverFamily={() => {
                const api = detail.kind === "loaded" ? detail.d.name : detail.n.apiName;
                void discoverFamily(api);
              }}
              onExpandFamily={(names) => {
                const api = detail.kind === "loaded" ? detail.d.name : detail.n.apiName;
                void expandFamily(api, names);
              }}
              designMode={designMode}
              onAddToGraph={(names) => {
                const api = detail.kind === "loaded" ? detail.d.name : detail.n.apiName;
                void expandFamily(api, names);
              }}
              onNote={openEntityNote}
              noteFlags={(() => {
                const api = detail.kind === "loaded" ? detail.d.name : detail.n.apiName;
                const rows = entityLog[api] ?? [];
                return rows.length > 0
                  ? { hasNote: true, hasTodo: rows.some((r) => (r.kind ?? "task") === "task" && r.status !== "done") }
                  : null;
              })()}
              catalog={objects.map((o) => ({ name: o.name, label: o.label }))}
              onExpandToErd={(names) => {
                void (async () => {
                  const missing = names.filter((n) => !describes.has(n)).slice(0, MAX_NEW_PER_ACTION);
                  if (missing.length === 0) {
                    setNotice("Everything selected is already on the ERD canvas.");
                    return;
                  }
                  if (describes.size + missing.length > MAX_NODES) {
                    setNotice(`Canvas cap is ${MAX_NODES} objects - adding ${missing.length} would exceed it. Remove some nodes first.`);
                    return;
                  }
                  setBusy(`Adding ${missing.length} to ERD…`);
                  try {
                    await addNames(missing);
                    setNotice(`${missing.length} object${missing.length === 1 ? "" : "s"} added to the ERD canvas as solid tables.`);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Add to ERD failed");
                  } finally {
                    setBusy(null);
                  }
                })();
              }}
              onCollapseFamily={() => {
                const api = detail.kind === "loaded" ? detail.d.name : detail.n.apiName;
                collapseFamily(api);
              }}
              onVisibility={(apiName, visible) => {
                // Uncheck = dismiss THIS node's drawn edges to the neighbor
                // (bubbles survive); re-check restores them. Rows are never
                // deleted, so no refetch is ever needed to bring a link back.
                const ids = linksOf.get(detail.kind === "loaded" ? detail.d.name : detail.n.apiName)?.get(apiName) ?? [];
                setDismissedEdges((prev) => {
                  const next = new Set(prev);
                  if (visible) {
                    for (const id of ids) next.delete(id);
                  } else {
                    for (const id of ids) next.add(id);
                  }
                  return next;
                });
              }}
            />
          )}
        </div>
      </div>

      {/* ── Design notes (right panel, shared by ERD + Graph) ── */}
      {notesOpen && (
        <aside className="flex w-96 shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]">
          <div className="flex items-center gap-2 border-b border-[var(--color-line-soft)] px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-bold text-ivory-950">
                Design Notes
              </h2>
              <p className="truncate font-mono text-[10px] text-ivory-600">
                {notesSavedAt ? `Auto-saved ${timeAgo(notesSavedAt)}` : "Autosaves per org"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const line = `- ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — `;
                setCanvasNote((p) => appendNoteLine(p, line));
                touchNotes();
              }}
              title="Insert timestamp bullet"
              aria-label="Insert timestamp bullet"
              className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <circle cx="12" cy="12" r="8.5" />
                <path d="M12 7.5V12l3 2" />
              </svg>
            </button>
            {(
              <button
                type="button"
                onClick={() => setNotesZen(true)}
                title="Pop out fullscreen editor (Outlook-style) - collapse back anytime"
                aria-label="Open fullscreen notes editor"
                className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={() => void exportCanvasNote()}
              disabled={noteExporting || noteBodyEmpty(canvasNote)}
              title="Export canvas notes as Word (.docx)"
              aria-label="Export canvas notes as Word"
              className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer disabled:opacity-40"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M6 3h8l4 4v14H6V3Z" />
                <path d="M14 3v4h4" />
                <path d="M9 13l1.5 4L12 14l1.5 3L15 13" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => {
                setNotesOpen(false);
              }}
              aria-label="Close design notes"
              title="Close notes"
              className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3.5">
              <div className="flex min-h-0 flex-1 flex-col">
                {openTodos.length > 0 && (
                  <div className="mb-3 rounded-xl border border-[var(--color-line)] bg-white/60 p-2">
                    <button
                      type="button"
                      onClick={() => setOpenItemsOpen((v) => !v)}
                      aria-expanded={openItemsOpen}
                      title={openItemsOpen ? "Hide open items" : "Show every open item"}
                      className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-ivory-200/60 transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" className="shrink-0 text-ivory-500">
                        <path d="M9 6h11M9 12h11M9 18h11" />
                        <path d="M4 6h.01M4 12h.01M4 18h.01" />
                      </svg>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-ivory-700">
                        Open items <sup className="font-mono text-[10px] text-bronze-600">{openTodoCount}</sup>
                      </span>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" className={`ml-auto shrink-0 text-ivory-500 transition-transform ${openItemsOpen ? "" : "-rotate-90"}`}>
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    {openItemsOpen && (
                    <ul className="mt-1 space-y-1">
                      {openTodos.map(({ api, entry }) => {
                        const scopeLabel = api === CANVAS_LOG_API ? "Canvas" : (labels.get(api) ?? api);
                        return (
                          <li key={entry.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setNoteEntity(api);
                                setNoteEntryId(entry.id);
                                setLogModalOpen(true);
                              }}
                              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-white/70 transition-colors cursor-pointer"
                            >
                              <span className="shrink-0 font-mono text-[9px] font-bold uppercase text-ivory-500">
                                {(entry.kind ?? "task").slice(0, 4)}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ivory-950">
                                {entry.title.trim() || scopeLabel}
                              </span>
                              <span className="shrink-0 font-mono text-[10px] text-ivory-500">
                                {scopeLabel} · {timeAgo(entry.updatedAt)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    )}
                  </div>
                )}
                <div className="mb-3">
                  <button
                    type="button"
                    onClick={() => {
                      const rows = (entityLog[CANVAS_LOG_API] ?? []).slice().sort((a, b) => b.updatedAt - a.updatedAt);
                      setNoteEntity(CANVAS_LOG_API);
                      setNoteEntryId(rows[0]?.id ?? null);
                      setLogModalOpen(true);
                    }}
                    title="Open the canvas log - tasks, notes, questions and decisions for this canvas"
                    className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-[var(--color-line)] bg-white/60 px-2.5 py-2 text-left hover:border-[#C9A86A] transition-colors"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-bold text-ivory-950">
                        Canvas log <sup className="font-mono text-[10px] text-bronze-600">{(entityLog[CANVAS_LOG_API] ?? []).length}</sup>
                      </span>
                      <span className="block truncate text-[10px] text-ivory-500">
                        Tasks, notes, questions and decisions for this canvas
                      </span>
                    </span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" className="shrink-0 text-ivory-500">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                </div>
                <div ref={canvasNotesRef} className="scroll-mt-2">
                <CanvasNotesField
                  note={canvasNote}
                  onNote={(b) => {
                    setCanvasNote(b);
                    touchNotes();
                  }}
                  onToggleTask={(idx) => {
                    setCanvasNote((p) => commitNoteBody(p, "md", toggleTaskLine(p.md, idx)));
                    touchNotes();
                  }}
                />
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <p className="text-[10px] text-ivory-500">
                    {canvasNote.md.trim().split(/\s+/).filter(Boolean).length} words · {canvasNote.format === "rich" ? "rich text" : "markdown"} · attaches to snapshots
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    {!noteBodyEmpty(canvasNote) && (
                      <button
                        type="button"
                        onClick={() => {
                          setCanvasNote(emptyNoteBody());
                          touchNotes();
                        }}
                        className="text-[10px] text-ivory-500 hover:text-red-700 underline cursor-pointer"
                      >
                        Delete note
                      </button>
                    )}
                    {canvasNote.md.trim() && (
                      <button
                        type="button"
                        onClick={() => {
                          const d = new Date();
                          const pad = (v: number) => String(v).padStart(2, "0");
                          const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
                          const slug = (rootName || "canvas").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "canvas";
                          const blob = new Blob([canvasNote.md], { type: "text/markdown" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `design-notes-${slug}-${stamp}.md`;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        title="Download canvas notes as a Markdown file"
                        aria-label="Download canvas notes as Markdown"
                        className="rounded p-1 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-200 transition-colors cursor-pointer"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                          <path d="M12 4v11m0 0 4-4m-4 4-4-4" />
                          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
          </div>
        </aside>
      )}

      {/* Fullscreen notes editor (Outlook-style pop-out) - same canvas text,
          collapses straight back to the vertical panel. */}
      {notesZen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ivory-950/40 p-5" role="dialog" aria-modal="true" aria-label="Design notes fullscreen editor">
          <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-2xl">
            <div className="flex items-center gap-2 border-b border-[var(--color-line-soft)] px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-bold text-ivory-950">Design Notes</h2>
                <p className="truncate font-mono text-[10px] text-ivory-600">
                  {canvasNote.md.trim().split(/\s+/).filter(Boolean).length} words · {notesSavedAt ? `Auto-saved ${timeAgo(notesSavedAt)}` : "Autosaves per org"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void exportCanvasNote()}
                disabled={noteExporting || noteBodyEmpty(canvasNote)}
                title="Export as Word (.docx)"
                className="rounded-lg border border-[var(--color-line-soft)] px-3 py-1.5 text-[11px] font-semibold text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer disabled:opacity-40"
              >
                {noteExporting ? "Exporting…" : "Word"}
              </button>
              <button
                type="button"
                onClick={() => setNotesZen(false)}
                title="Collapse back to the side panel"
                aria-label="Collapse back to side panel"
                className="rounded-lg bg-ivory-950 px-3 py-1.5 text-[11px] font-semibold text-ivory-100 hover:bg-bronze-600 transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
              <CanvasNotesField
                note={canvasNote}
                onNote={(b) => {
                  setCanvasNote(b);
                  touchNotes();
                }}
                onToggleTask={(idx) => {
                  setCanvasNote((p) => commitNoteBody(p, "md", toggleTaskLine(p.md, idx)));
                  touchNotes();
                }}
                fill
              />
            </div>
          </div>
        </div>
      )}

      {/* Entity log modal - the only editing surface for log entries. */}
      {logModalOpen && noteEntity && (
        <EntityLogModal
          key={noteEntity}
          apiName={noteEntity}
          label={noteEntity === CANVAS_LOG_API ? "Canvas" : (labels.get(noteEntity) ?? noteEntity)}
          rows={entityLog[noteEntity] ?? []}
          fields={(describes.get(noteEntity)?.fields ?? []).map((f) => ({ name: f.name, label: f.label, type: f.type, referenceTo: f.referenceTo ?? [] }))}
          hideAnchor={noteEntity === CANVAS_LOG_API}
          initialSelectedId={noteEntryId}
          onClose={() => setLogModalOpen(false)}
          onNew={(kind) => addEntityEntry(noteEntity, kind)}
          onDelete={(id) => deleteEntryById(id)}
          onBody={(id, b) => setEntryBodyById(id, b)}
          onToggleTask={(id, idx) => {
            const found = locateEntry(id);
            if (!found) return;
            const draft = todoBodyToNote({ body: found.entry.body, bodyFormat: found.entry.bodyFormat, bodyHtml: found.entry.bodyHtml });
            setEntryBodyById(id, commitNoteBody(draft, "md", toggleTaskLine(draft.md, idx)));
          }}
          onPatch={(id, patch, what) => patchLogEntry(id, patch, what)}
          onAnchor={(id, anchor) => {
            if (!anchor) {
              setEntryMetaById(id, { anchor: { type: "entity", id: noteEntity } }, "Anchor reset to object");
              return;
            }
            setEntryMetaById(id, { anchor }, `Anchor set to ${anchor.id}`);
          }}
        />
      )}

      {/* Automation footprint modal - Tooling API read of triggers/flows/queues/validation/approvals. */}
      {automationApi && (
        <AutomationModal
          key={automationApi}
          apiName={automationApi}
          label={labels.get(automationApi) ?? automationApi}
          keyPrefix=""
          instanceUrl={instanceUrl}
          apiVersion={apiVersion}
          getToken={getToken}
          fields={(describes.get(automationApi)?.fields ?? []).map((f) => ({ name: f.name, label: f.label }))}
          onClose={() => setAutomationApi(null)}
          onLoaded={recordAutomationTotal}
        />
      )}

      {/* Architecture Inbox overlay */}      <ArchitectureInbox
        open={inboxOpen}
        onClose={() => setInboxOpen(false)}
        orgLabel={orgDomain || "This org"}
        items={inboxItems}
        canvases={inboxCanvases}
        onEditBody={inboxEditBody}
        onSetTaskDone={inboxSetTaskDone}
        onDelete={inboxDelete}
        onNavigate={inboxNavigate}
        onUpdateMeta={inboxUpdateMeta}
        getAnchorReview={getAnchorReview}
        onAcceptAnchor={acceptAnchorReview}
      />

      {/* Collaboration share dialog */}
      <ShareDialog
        open={showShare}
        onClose={() => setShowShare(false)}
        objectCount={describes.size}
        getStructure={getShareStructure}
      />

      {/* Picklist inspector */}
      {rtPopover && <RecordTypePopover pop={rtPopover} onClose={() => setRtPopover(null)} onExportMatrix={exportPicklistMatrix} />}
      {popover && (
        <PicklistPopover
          pop={popover}
          onClose={() => setPopover(null)}
          onAddValues={
            authorMode
              ? () => {
                  setAddValues({
                    objectApi: popover.apiName,
                    objectLabel: popover.nodeLabel,
                    fieldApi: popover.fieldName,
                    fieldLabel: popover.fieldName,
                  });
                  setPopover(null);
                }
              : undefined
          }
        />
      )}

      {/* Schema authoring dialogs */}
      {authorDialog?.kind === "field" && describes.has(authorDialog.objectApi) && (
        <AuthorFieldDialog
          objectApi={authorDialog.objectApi}
          objectLabel={labels.get(authorDialog.objectApi) ?? authorDialog.objectApi}
          objectOptions={authorObjectOptions}
          busy={false}
          serverError={null}
          isProduction={isProductionOrg}
          onClose={() => setAuthorDialog(null)}
          onDeploy={(draft, childApi) => void submitAuthorField(draft, childApi)}
        />
      )}
      {authorDialog?.kind === "relationship" && (
        <AuthorFieldDialog
          objectApi={authorDialog.childApi}
          objectLabel={labels.get(authorDialog.childApi) ?? authorDialog.childApi}
          objectOptions={authorObjectOptions}
          initial={{
            type: "Lookup",
            referenceTo: authorDialog.parentApi,
            lockReferenceTo: true,
          }}
          busy={false}
          serverError={null}
          isProduction={isProductionOrg}
          onClose={() => setAuthorDialog(null)}
          onDeploy={(draft, childApi) => void submitAuthorField(draft, childApi)}
        />
      )}
      {authorDialog?.kind === "object" && (
        <AuthorObjectDialog
          busy={false}
          serverError={null}
          isProduction={isProductionOrg}
          onClose={() => setAuthorDialog(null)}
          onDeploy={(draft) => void submitAuthorObject(draft)}
        />
      )}
      {pendingProdField && (
        <ConfirmDialog
          title={`Deploy ${pendingProdField.childApi}.${pendingProdField.draft.apiName.trim()} to PRODUCTION?`}
          message={`${instanceUrl} - this goes live immediately and cannot be undone from here.`}
          confirmLabel="Deploy to production"
          tone="danger"
          onCancel={() => setPendingProdField(null)}
          onConfirm={() => {
            const p = pendingProdField;
            setPendingProdField(null);
            void fireAuthorField(p.draft, p.childApi);
          }}
        />
      )}
      {pendingProdObject && (
        <ConfirmDialog
          title={`Create object ${pendingProdObject.apiName.trim()} on PRODUCTION?`}
          message={`${instanceUrl} - this goes live immediately and cannot be undone from here.`}
          confirmLabel="Create on production"
          tone="danger"
          onCancel={() => setPendingProdObject(null)}
          onConfirm={() => {
            const p = pendingProdObject;
            setPendingProdObject(null);
            void fireAuthorObject(p);
          }}
        />
      )}
      {addValues && (
        <AddPicklistValuesDialog
          objectApi={addValues.objectApi}
          objectLabel={addValues.objectLabel}
          fieldApi={addValues.fieldApi}
          fieldLabel={addValues.fieldLabel}
          instanceUrl={instanceUrl}
          apiVersion={apiVersion}
          getToken={getToken}
          isProduction={isProductionOrg}
          onClose={() => setAddValues(null)}
          onApplied={() => {
            void (async () => {
              try {
                mergeDescribes([await fetchDescribe(addValues.objectApi)]);
              } catch {
                /* canvas keeps prior data */
              }
            })();
            setNotice(`${addValues.fieldApi} updated - canvas refreshed from the org.`);
          }}
          onSessionExpired={onSessionExpired}
        />
      )}

      {/* Record Walk popover (view-only: all edits go through the full-screen modal) */}
      {recordPop && (
        <RecordPopover
          pop={buildRecordPop(recordPop.apiName, recordPop.x, recordPop.y)}
          onClose={() => {
            setRecordPop(null);
            setRecordPopError(null);
          }}
          onLoadMore={(key) => void loadMoreRecords(key)}
          onFetchMissing={(api) => {
            // Chain guidance: open the missing parent the same way.
            const rect = { x: recordPop.x, y: recordPop.y, width: 12, height: 12 };
            void openNodeRecord(api, rect);
          }}
          onClear={() => clearNodeRecordData(recordPop.apiName)}
          onRefresh={() => void refreshNodeRecord(recordPop.apiName)}
          refreshing={recordBusy !== null}
          onSelectRecord={(api, id) => void selectNodeRecord(api, id)}
          onModeChange={(mode) => setRecordPop((prev) => (prev ? { ...prev, mode } : prev))}
          onCopyLookup={(value) => {
            void (async () => {
              try {
                await navigator.clipboard.writeText(value);
              } catch {
                /* clipboard unavailable */
              }
            })();
          }}
          onEditRecord={(api, id) => openEditModal(api, id)}
          onInspectRecord={(api, id) => {
            void selectNodeRecord(api, id);
            setRecordPop((prev) => (prev ? { ...prev, apiName: api, mode: "record" } : prev));
          }}
        />
      )}

      {/* Full-screen record edit modal: All fields + page-layout tabs, review then save */}
      {editModal && (() => {
        const raw = editRawFields(editModal.apiName, editModal.id);
        if (!raw) return null;
        const ls = layoutState.key === editModal.apiName ? layoutState : { loading: false, error: null as string | null };
        return (
          <RecordEditModal
            data={{
              apiName: editModal.apiName,
              objectLabel: labels.get(editModal.apiName) ?? editModal.apiName,
              recordId: editModal.id,
              recordName: editRecordName(editModal.apiName, editModal.id),
              rawFields: raw,
              metas: recordFieldMeta(editModal.apiName) ?? [],
              layouts: layoutCacheRef.current.get(editModal.apiName) ?? [],
              layoutsLoading: ls.loading,
              layoutsError: ls.error,
              objectLabelOf: (api) => labels.get(api) ?? api,
              onLookupSearch: (api, q) => searchLookupRecords(api, q),
              onResolveLookup: (api, id) => resolveLookupLabel(api, id),
            }}
            onClose={() => setEditModal(null)}
            onSave={(api, id, changes) => saveRecordEdit(api, id, changes)}
          />
        );
      })()}

      {/* Record Walk entry */}
      {recordModalOpen && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="record-title"
          onClick={() => setRecordModalOpen(false)}
        >
          <div className="modal-card max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)]">
              <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
                Record Walk · {rootName || "no root"}
              </p>
              <h2 id="record-title" className="mt-1 text-lg font-bold text-ivory-950">
                Walk live data from a record
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-ivory-600">
                Enter a {rootName || "root"} record Id. It loads automatically; every other
                node pulls on demand with one click. Session only - nothing is stored.
              </p>
            </div>
            <div className="px-6 py-4">
              <div className="flex gap-1.5">
                <Input
                  placeholder="e.g. 00Qxx0000012345…"
                  value={recordInput}
                  onChange={(e) => setRecordInput(e.target.value)}
                  aria-label="Root record Id"
                />
                <Button
                  size="sm"
                  disabled={recordBusy !== null || !recordInput.trim()}
                  onClick={() => {
                    setRecordError(null);
                    const id = recordInput.trim();
                    const api = rootName;
                    setRecordBusy(api);
                    void (async () => {
                      try {
                        await fetchRootRecord(id);
                        setRecordModalOpen(false);
                        setNotice(`Root record ${id} loaded - eye pulls silently, field icons peek values, lists open a picker.`);
                      } catch (err) {
                        setRecordError(err instanceof Error ? err.message : "Record fetch failed.");
                      } finally {
                        setRecordBusy(null);
                      }
                    })();
                  }}
                >
                  {recordBusy ? "Fetching…" : "Fetch"}
                </Button>
              </div>
              {recordError && (
                <p className="mt-2.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-2 text-xs text-red-700" role="alert">
                  {recordError}
                </p>
              )}
              {recordRoot && (
                <p className="mt-2.5 font-mono text-[11px] text-ivory-700">
                  Root: {recordRoot.apiName} · {recordRoot.id}
                </p>
              )}
              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={clearRecordData}
                  className="text-[11px] text-ivory-500 hover:text-red-700 underline cursor-pointer"
                >
                  Clear record data
                </button>
                <div className="flex gap-1.5">
                  {recordRoot && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={recordBusy !== null}
                      title="Re-pull the root, every loaded record and every open list - latest truth from the server"
                      onClick={() => {
                        setRecordModalOpen(false);
                        void refreshAllRecords();
                      }}
                    >
                      {recordBusy ? "Refreshing…" : "Refresh all loaded"}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setRecordModalOpen(false)}>
                    Close
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Unified Hide panel: System sweep review + all graph entities */}
      {hidePanel && (
        <HidePanel
          initialTab={hidePanel}
          systemRows={systemHiddenList}
          initialAllow={systemAllow}
          hideSystemActive={hideSystem}
          graphNodes={(() => {
            const seen = new Map<string, string>();
            for (const n of graphElements.nodes) {
              const api = String((n.data as { apiName?: string } | undefined)?.apiName ?? "");
              if (!api || seen.has(api)) continue;
              seen.set(api, String((n.data as { label?: string } | undefined)?.label ?? labels.get(api) ?? api));
            }
            // Dismissed bubbles are filtered from nodes - list them too as hidden.
            for (const api of dismissedIds) {
              if (!seen.has(api)) seen.set(api, labels.get(api) ?? api);
            }
            return [...seen.entries()]
              .map(([apiName, label]) => ({ apiName, label, visible: !dismissedIds.has(apiName) }))
              .sort((a, b) => (a.apiName < b.apiName ? -1 : 1));
          })()}
          hiddenLinks={[...dismissedEdges].sort().map((id) => {
            const parts = id.split("|");
            const strip = (s: string | undefined) =>
              !s ? "?" : s.startsWith("x:") ? (s.split(":")[2] ?? s) : s.includes(":") ? (s.split(":").pop() ?? s) : s;
            return { id, from: strip(parts[1]), to: strip(parts[2]), via: parts[3] ?? "" };
          })}
          onClose={() => setHidePanel(null)}
          onApplySystem={(allow) => {
            setSystemAllow(allow);
            setHideSystem(true);
          }}
          onTurnOffSystem={() => {
            setHideSystem(false);
            setHidePanel(null);
          }}
          onToggleNode={(apiName, visible) =>
            setDismissedIds((prev) => {
              const next = new Set(prev);
              if (visible) next.delete(apiName);
              else next.add(apiName);
              return next;
            })
          }
          onRestoreLink={(id) =>
            setDismissedEdges((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            })
          }
          onRestoreAll={() => {
            setDismissedIds(new Set());
            setDismissedEdges(new Set());
          }}
        />
      )}
      {picker && (
        <DiscoverPicker
          open
          title={picker.title}
          subtitle={picker.subtitle}
          candidates={picker.candidates}
          emptyMessage={picker.emptyMessage}
          standardCandidates={picker.standardCandidates}
          standardEmptyMessage={picker.standardEmptyMessage}
          onApply={applyPicker}
          onClose={() => setPicker(null)}
          onFocusNode={(api) => {
            setPicker(null);
            setFocusName(api);
            focusCanvasOn(api);
          }}
        />
      )}

      {addObjectOpen && (
        <AddObjectModal
          objects={objects}
          drawn={new Set(graphElements.nodes.map((n) => String((n.data as { apiName?: string } | undefined)?.apiName ?? "")).filter(Boolean))}
          busy={!!busy}
          onAdd={(names) => void expandFamily(rootName, names)}
          onClose={() => setAddObjectOpen(false)}
        />
      )}

      {/* Family expansion lives in the graph detail card - no modal. */}

      {/* Snapshot history */}
      {showHistory && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-title"
          onClick={() => {
            setShowHistory(false);
            setRenamingId(null);
          }}
        >
          <div className="modal-card max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-[var(--color-line-soft)]">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">
                  {orgDomain || "This org"} · {snapshots.length} saved
                </p>
                <h2 id="history-title" className="mt-1 text-lg font-bold text-ivory-950">
                  Canvas snapshots
                </h2>
                <p className="mt-0.5 text-[11px] text-ivory-600">
                  Export shares the full canvas as a file - teammates import to continue together.
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => importFileRef.current?.click()}
                  title="Import a shared canvas file (.sobject-erd.json) - restores with zero API calls"
                  className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M12 4v11m0 0 4-4m-4 4-4-4" />
                    <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                  </svg>
                </button>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  aria-label="Import shared canvas file"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void importSnapshotFile(f);
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowHistory(false);
                    setRenamingId(null);
                  }}
                  aria-label="Close snapshot history"
                className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
              </div>
            </div>
            <div className="max-h-80 overflow-y-auto px-6 py-4">
              {snapshots.length === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-sm font-semibold text-ivory-950">No snapshots yet</p>
                  <p className="mt-1 text-xs leading-relaxed text-ivory-600">
                    Arrange your canvas, hit the camera icon, and pick up exactly here later -
                    snapshots restore with fresh metadata.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {snapshots.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2.5"
                    >
                      {renamingId === s.id ? (
                        <div className="flex gap-2">
                          <input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") renameSnapshot(s.id, renameValue);
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            autoFocus
                            aria-label="Snapshot name"
                            className="flex-1 min-w-0 rounded border border-ivory-400 bg-white px-2 py-1 text-xs text-ivory-950 focus:border-bronze-500 focus:outline-none"
                          />
                          <Button size="sm" onClick={() => renameSnapshot(s.id, renameValue)}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-ivory-950">{s.name}</p>
                            <p className="flex items-center gap-1.5 text-[11px] text-ivory-600">
                              {s.nodes.length} objects · {timeAgo(s.createdAt)}
                              {s.notes && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSnapNotesId((cur) => (cur === s.id ? null : s.id));
                                    setSnapNotesDraft(snapshotNotesToNote(s));
                                  }}
                                  title="View attached design notes"
                                  className="rounded-full border border-bronze-300 bg-bronze-100 px-1.5 py-px text-[9px] font-bold text-bronze-700 hover:border-bronze-500 cursor-pointer"
                                >
                                  Notes
                                </button>
                              )}
                            </p>
                          </div>
                          <Button size="sm" variant="secondary" onClick={() => restoreSnapshot(s)} disabled={!!busy}>
                            Restore
                          </Button>
                          <button
                            type="button"
                            onClick={() => void exportSnapshot(s)}
                            disabled={!!busy}
                            aria-label={`Export ${s.name} as a shareable file`}
                            title="Export full canvas as a file - teammates import to continue together"
                            className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer disabled:opacity-40"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                              <path d="M12 15V4m0 0 4 4m-4-4L8 8" />
                              <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingId(s.id);
                              setRenameValue(s.name);
                            }}
                            aria-label={`Rename ${s.name}`}
                            title="Rename"
                            className="rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                              <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
                              <path d="m13.5 6.5 3 3" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSnapshot(s.id)}
                            aria-label={`Delete ${s.name}`}
                            title="Delete"
                            className="rounded-md p-1.5 text-ivory-500 hover:text-red-700 hover:bg-red-500/10 transition-colors cursor-pointer"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                              <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13h10l1-13" />
                            </svg>
                          </button>
                        </div>
                      )}
                      {snapNotesId === s.id && (
                        <div className="mt-2 rounded-lg border border-[var(--color-line)] bg-white p-2">
                          <NoteEditor
                            draft={snapNotesDraft}
                            onDraft={setSnapNotesDraft}
                            label="Snapshot notes"
                            textareaRows={3}
                            renderPreview={(md) => renderMarkdownLite(md)}
                          />
                          <div className="mt-1.5 flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => void (async () => {
                                try {
                                  await persistSnapshot({ ...s, ...noteToSnapshotNotes(snapNotesDraft) });
                                  setSnapshots(await listSnapshotsByOrg(orgDomain));
                                  setSnapNotesId(null);
                                  setNotice(`Notes updated on “${s.name}”.`);
                                } catch {
                                  setError("Couldn't save notes (IndexedDB unavailable).");
                                }
                              })()}
                            >
                              Save notes
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setSnapNotesId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="px-6 pb-4 text-[11px] text-ivory-600">
              Restoring re-fetches live metadata - layouts come back, stale fields don&apos;t.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
