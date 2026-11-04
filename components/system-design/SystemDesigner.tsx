"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Download, Expand, FlaskConical, IdCard, Layers, Map as MapIcon, Maximize, Play, Plug, Save, Settings, Shuffle, SquareTerminal, Terminal, Trash2, TriangleAlert, Upload, LayoutTemplate, Plus, Zap, Undo2, Redo2, List, MousePointer2, Hand, Group, Ungroup } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  Controls,
  useReactFlow,
  useNodesState,
  getViewportForBounds,
  ConnectionMode,
  PanOnScrollMode,
  SelectionMode,
  type ReactFlowInstance,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng } from "html-to-image";
import Button from "../ui/Button";
import { registerBridgeHandler, unregisterBridgeHandler } from "@/lib/bridge/registry";
import { buildSystemBridgeHandlers, resolveSystemByName, resolveSystemType, type SystemBridgeContext } from "@/lib/bridge/system";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import Input from "../ui/Input";
import Badge from "../ui/Badge";
import {
  SYSTEM_TEMPLATES,
  newProject,
  rebalanceLayout,
  newSystemFromTemplate,
  defaultInterfaceFor,
  ensureDefaultInterfaces,
  pruneCanvasGroups,
  newId,
  validateProject,
  exportProject,
  importProject,
  projectFileName,
  connectionReadiness,
  operationsForSystem,
  noteToSystemNotes,
  systemNotesToNote,
  type SystemNode,
  type SystemConnection,
  type SystemCanvasImage,
  type SystemCanvasNote,
  type SystemProject,
  type SystemTemplate,
  type SystemInterface,
  type SystemOperation,
  type OperationMethod,
  type FlowDef,
  type ScenarioDef,
} from "@/lib/system-design/model";
import {
  saveSystemProject,
  listSystemProjects,
  loadSystemProject,
  deleteSystemProject,
} from "@/lib/system-design/store";
import { buildCdcSyncProject, buildDemoProject, buildGroqSampleProject, buildOrderFanoutProject, buildRetryFallbackProject, buildRevenueCloudProject, buildTmfSampleProject } from "@/lib/system-design/demo";
import { deleteCanvasBlob, isPastesableImage, newBlobId, probeImageSize, putCanvasBlob } from "@/lib/system-design/blobStore";
import { SYSTEM_DRAFT_KEY } from "@/lib/draw/toSystemDraft";
import { syncDeepParam } from "@/lib/deep/deep";
import { validateShareEnvelope } from "@/lib/share/envelope";
import { DeepLinkButton } from "../ui/DeepLinkButton";
import { ShareButton } from "../share/ShareButton";
import { SystemGlyph } from "./SystemNode";
import { TestRunner } from "./TestRunner";
import { RunEdgeDialog } from "./RunEdgeDialog";
import { ChainRunDialog } from "./ChainRunDialog";
import { useAmplifiedPinch } from "../canvas/useAmplifiedPinch";
import { ApiCatalogTab } from "./tabs/ApiCatalogTab";
import { TransformsTab } from "./tabs/TransformsTab";
import { FlowsTab } from "./tabs/FlowsTab";
import { ScenariosTab } from "./tabs/ScenariosTab";
import { RunsTab } from "./tabs/RunsTab";
import { SettingsTab } from "./tabs/SettingsTab";
import { ProjectNotesModal } from "./ProjectNotesModal";
import { CredentialsModal } from "./CredentialsModal";
import { RenameProjectModal } from "./RenameProjectModal";
import { registerSystemBridge, snapshotOf } from "@/lib/ai/systemBridge";
import { systemNodeTypes } from "./flowRender";
import { toFlowEdges, toFlowNodes } from "@/lib/system-design/flow";
import { TemplatesModal } from "./TemplatesModal";
import { RisksDialog } from "../risks/RisksDialog";
import { ViewsDialog } from "../c4/ViewsDialog";
import { hiddenNodeIds, type C4View } from "@/lib/c4/views";
import { ImpactSection } from "../graph/ImpactSection";
import {
  looksLikeSecret,
  type CredVault,
} from "@/lib/system-design/credentials";

function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function sdPngFileName(scale: 2 | 3): string {
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  return `system-design-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}@${scale}x.png`;
}

const CRED_VAULT_KEY = "sd_cred_vault";

function loadCredVault(): CredVault {
  try {
    const raw = sessionStorage.getItem(CRED_VAULT_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: CredVault = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "string" && v) out[k] = v;
      }
      return out;
    }
  } catch {
    /* corrupted vault never blocks the canvas */
  }
  return {};
}
import type { CanvasTodo } from "@/lib/inbox/types";

type SubTab = "canvas" | "flow" | "api" | "transform" | "scenarios" | "runs" | "settings";

const SUB_TABS: { id: SubTab; label: string; icon: LucideIcon }[] = [
  { id: "canvas", label: "Canvas", icon: Expand },
  { id: "flow", label: "Flow Lab", icon: Play },
  { id: "api", label: "API Catalog", icon: Plug },
  { id: "transform", label: "Transformations", icon: Shuffle },
  { id: "scenarios", label: "Scenarios", icon: FlaskConical },
  { id: "runs", label: "Runs & Observability", icon: SquareTerminal },
  { id: "settings", label: "Settings", icon: Settings },
];

interface Snapshot {
  systems: SystemNode[];
  connections: SystemConnection[];
  canvasNotes: SystemCanvasNote[]
  canvasImages: SystemCanvasImage[]
}

const snapOf = (p: SystemProject): Snapshot => ({
  systems: JSON.parse(JSON.stringify(p.systems)) as SystemNode[],
  connections: JSON.parse(JSON.stringify(p.connections)) as SystemConnection[],
  canvasNotes: JSON.parse(JSON.stringify(p.canvasNotes)) as SystemCanvasNote[],
  canvasImages: JSON.parse(JSON.stringify(p.canvasImages)) as SystemCanvasImage[],
});

function DesignerCanvas({
  project,
  onMoveSystems,
  onDragStartNode,
  onConnectSystems,
  onSelect,
  selEdgeId,
  onDropTemplate,
  emptyAction,
  present,
  onTogglePresent,
  runVis,
  miniMapOn,
  onToggleMiniMap,
  onOpenRisks,
  onOpenViews,
  hiddenIds,
  editingNoteId,
  selNoteId,
  selIds,
  onBeginNoteEdit,
  onCommitNoteText,
  onCancelNoteEdit,
  onWriteAt,
  appendTargetId,
  onAppendChar,
  onPasteImage,
  onResizeImage,
  onToggleSelect,
  onMarqueeSelect,
  canGroup,
  canUngroup,
  onGroup,
  onUngroup,
  canDelete,
  onDeleteSelection,
  onRebalance,
}: {
  project: SystemProject;
  onMoveSystems: (moves: { id: string; x: number; y: number }[]) => void;
  onDragStartNode: () => void;
  onConnectSystems: (sourceId: string, targetId: string) => void;
  onSelect: (nodeId: string | null, edgeId: string | null) => void;
  selEdgeId: string | null;
  onDropTemplate: (t: SystemTemplate, at: { x: number; y: number }) => void;
  emptyAction: () => void;
  present: boolean;
  onTogglePresent: () => void;
  runVis: Record<string, "running" | "ok" | "failed">;
  miniMapOn: boolean;
  onToggleMiniMap: () => void;
  onOpenRisks: () => void;
  onOpenViews: () => void;
  hiddenIds: Set<string>;
  editingNoteId: string | null;
  selNoteId: string | null;
  selIds: string[];
  onBeginNoteEdit: (id: string) => void;
  onCommitNoteText: (id: string, text: string) => void;
  onCancelNoteEdit: (id: string) => void;
  onWriteAt: (pos: { x: number; y: number }, initial: string) => void;
  appendTargetId: string | null;
  onAppendChar: (id: string, ch: string) => void;
  onPasteImage: (file: File, pos: { x: number; y: number }) => void;
  onResizeImage: (id: string, width: number, height: number) => void;
  onToggleSelect: (id: string) => void;
  onMarqueeSelect: (ids: string[]) => void;
  canGroup: boolean;
  canUngroup: boolean;
  onGroup: () => void;
  onUngroup: () => void;
  canDelete: boolean;
  onDeleteSelection: () => void;
  onRebalance: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView, getNodes, getNodesBounds } = useReactFlow();
  const rfInstance = useReactFlow();
  const rfRef = useRef<ReactFlowInstance | null>(null);
  useEffect(() => {
    rfRef.current = rfInstance;
  }, [rfInstance]);
  // 4x-feel pinch zoom (trackpad + touch); the native 1x handler stays off.
  useAmplifiedPinch(containerRef, { instanceRef: rfRef, minZoom: 0.15, maxZoom: 4 });
  // ERD pattern: nodes live in React Flow local state (useNodesState) so
  // drags track the pointer with zero global churn; the project commits
  // once on drag stop. baseNodes rebuilds from the project; the sync
  // below applies it whenever we are not mid-drag.
  const baseNodes = useMemo(() => {
    const base = toFlowNodes(project).map((n) => (hiddenIds.has(n.id) ? { ...n, hidden: true } : n));
    const marks = [
      ...project.canvasNotes.map((n) => ({
        id: n.id,
        type: 'note',
        position: n.position,
        data: {
          text: n.text,
          editing: n.id === editingNoteId,
          onBeginEdit: () => onBeginNoteEdit(n.id),
          onCommit: (text: string) => onCommitNoteText(n.id, text),
          onCancel: () => onCancelNoteEdit(n.id),
        },
        selected: n.id === selNoteId,
      })),
      ...project.canvasImages.map((g) => ({
        id: g.id,
        type: 'canvas-image',
        position: g.position,
        width: g.width,
        height: g.height,
        data: {
          blobId: g.blobId,
          name: g.name,
          onResize: (width: number, height: number) => onResizeImage(g.id, width, height),
        },
        selected: g.id === selNoteId,
      })),
    ];
    return [...base, ...marks].map((n) => ({ ...n, selected: selIds.includes(n.id) }));
  }, [project, hiddenIds, editingNoteId, selNoteId, selIds, onBeginNoteEdit, onCommitNoteText, onCancelNoteEdit, onResizeImage]);
  const [nodes, setNodes, onNodesChange] = useNodesState(baseNodes);
  const draggingRef = useRef(false);
  const shiftSkipRef = useRef(0);
  // draw.io tools: Select (click, marquee, shift adds) or Pan. Touch
  // always pans - marquee is a mouse gesture.
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  // Empty-canvas overlay dismissal: Start drops it to a blank canvas without
  // forcing a template. Resets per project so a fresh canvas explains itself.
  const [started, setStarted] = useState(false);
  useEffect(() => {
    setStarted(false);
  }, [project.id]);
  const isTouchOrPen = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  useEffect(() => {
    if (draggingRef.current) return;
    setNodes((prev) => {
      if (prev.length !== baseNodes.length) return baseNodes;
      for (let i = 0; i < prev.length; i++) {
        const a = prev[i];
        const b = baseNodes[i];
        const ah = (a as { hidden?: unknown }).hidden;
        const bh = (b as { hidden?: unknown }).hidden;
        if (a.id !== b.id || a.selected !== b.selected || a.position !== b.position || ah !== bh) return baseNodes;
      }
      return prev;
    });
  }, [baseNodes, setNodes]);
  const edges = useMemo(
    () => toFlowEdges(project, runVis).filter((e) => !hiddenIds.has(e.source) && !hiddenIds.has(e.target)),
    [project, runVis, hiddenIds]
  );
  const selEdges = useMemo(
    () =>
      edges.map((e) => {
        const isSelected = e.id === selEdgeId;
        return {
          ...e,
          selected: isSelected,
          style: isSelected
            ? { ...e.style, stroke: "#9A7653", strokeWidth: 2.5 }
            : e.style,
        };
      }),
    [edges, selEdgeId]
  );

  // draw.io entry: the pointer rests anywhere on the canvas and the first
  // keystroke opens a text box there with that character already inside.
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onKeyWrite = (e: KeyboardEvent) => {
      if (editingNoteId) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      if (document.querySelector('[role=dialog]')) return;
      if (appendTargetId) { e.preventDefault(); onAppendChar(appendTargetId, e.key); return; }
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      const m = mouseRef.current ?? (rect ? { x: rect.width / 2, y: rect.height / 2 } : { x: 400, y: 300 });
      onWriteAt(screenToFlowPosition({ x: m.x, y: m.y }), e.key);
    };
    window.addEventListener('keydown', onKeyWrite);
    return () => window.removeEventListener('keydown', onKeyWrite);
  }, [editingNoteId, onWriteAt, appendTargetId, onAppendChar, screenToFlowPosition]);

  // Pasting a screenshot drops it at the viewport center. Text fields
  // keep the paste; open dialogs defer to the dialog.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (document.querySelector('[role=dialog]')) return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => isPastesableImage(f));
      if (!file) return;
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      onPasteImage(file, screenToFlowPosition({ x: cx - (rect?.left ?? 0), y: cy - (rect?.top ?? 0) }));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onPasteImage, screenToFlowPosition]);

  // Groups: member id -> whole member list, for live move-together.
  const groupOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of project.groups) for (const id of g.memberIds) m.set(id, g.memberIds);
    return m;
  }, [project.groups]);

  // Dragging one member shifts its siblings by the same delta, live in
  // local state; the project commits on drag stop (see below).
  const groupedOnChange: typeof onNodesChange = (changes) => {
    const extra: Parameters<typeof onNodesChange>[0] = [];
    for (const c of changes) {
      if (c.type !== 'position' || !c.position || !c.dragging) continue;
      const members = groupOf.get(c.id);
      if (!members || members.length < 2) continue;
      const cur = nodes.find((n) => n.id === c.id);
      if (!cur) continue;
      const dx = c.position.x - cur.position.x;
      const dy = c.position.y - cur.position.y;
      if (dx === 0 && dy === 0) continue;
      for (const mid of members) {
        if (mid === c.id) continue;
        const mcur = nodes.find((n) => n.id === mid);
        if (!mcur) continue;
        extra.push({ type: 'position', id: mid, position: { x: mcur.position.x + dx, y: mcur.position.y + dy }, dragging: true });
      }
    }
    onNodesChange(extra.length > 0 ? [...changes, ...extra] : changes);
  };

  // Snapshot PNG export — ported from ErdCanvas.
  // Uses the React Flow instance's getNodesBounds (resolves through nodeLookup
  // for measured width/height) and unions with the edge SVG bounding box so
  // arrows, curves and labels are never clipped.
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const doExport = useCallback(
    async (scale: 2 | 3) => {
      setExporting(true);
      setExportError(null);
      try {
        const viewportEl = containerRef.current?.querySelector(".react-flow__viewport");
        if (!viewportEl) throw new Error("Canvas not ready");

        // Instance getNodesBounds resolves through nodeLookup — measured dims.
        const measured = getNodes();
        const nodeBounds = getNodesBounds(measured);

        // Union with edge SVG bbox so arrows and curves are included.
        let bounds = { ...nodeBounds };
        const edgesGroup = containerRef.current?.querySelector(".react-flow__edges > g");
        if (edgesGroup instanceof SVGGraphicsElement) {
          try {
            const eb = edgesGroup.getBBox();
            if (eb.width > 0 && eb.height > 0) {
              const minX = Math.min(bounds.x, eb.x);
              const minY = Math.min(bounds.y, eb.y);
              const maxX = Math.max(bounds.x + bounds.width, eb.x + eb.width);
              const maxY = Math.max(bounds.y + bounds.height, eb.y + eb.height);
              bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
            }
          } catch {
            // getBBox can throw if SVG is not rendered; node bounds still work.
          }
        }

        // Generous padding: arrow markers (18px) + edge labels + breathing room.
        const PAD = 100;
        const imgW = Math.max(1200, bounds.width + PAD * 2);
        const imgH = Math.max(800, bounds.height + PAD * 2);
        const { x, y, zoom } = getViewportForBounds(
          bounds,
          imgW,
          imgH,
          0.1,
          2,
          PAD / Math.min(imgW, imgH),
        );
        const dataUrl = await toPng(viewportEl as HTMLElement, {
          backgroundColor: "#FAF8F2",
          pixelRatio: scale,
          cacheBust: true,
          width: imgW,
          height: imgH,
          style: {
            width: `${imgW}px`,
            height: `${imgH}px`,
            transform: `translate(${x}px, ${y}px) scale(${zoom})`,
          },
          filter: (n) =>
            !(n instanceof HTMLElement) ||
            !n.classList.contains("react-flow__handle"),
        });
        downloadDataUrl(dataUrl, sdPngFileName(scale));
      } catch (err) {
        setExportError(err instanceof Error ? err.message : "PNG export failed");
      } finally {
        setExporting(false);
      }
    },
    [getNodes, getNodesBounds],
  );

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[420px] w-full overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)]"
      onDrop={(e) => {
        e.preventDefault();
        const raw = e.dataTransfer.getData("application/sd-system");
        if (!raw) return;
        const t = SYSTEM_TEMPLATES.find((x) => x.systemType === raw);
        if (!t) return;
        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
        onDropTemplate(t, screenToFlowPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top }));
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onMouseMove={(e) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }}
    >
      <div className='absolute left-3 top-3 z-10 flex gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-sm' role='toolbar' aria-label='Canvas tools'>
        <button
          type='button'
          title='Select - click, drag a box, shift adds'
          aria-pressed={tool === 'select'}
          onClick={() => setTool('select')}
          className={tool === 'select'
            ? 'rounded-md border border-ivory-950 bg-ivory-950 p-1.5 text-ivory-100'
            : 'rounded-md border border-transparent p-1.5 text-ivory-600 hover:border-[var(--color-line)] hover:text-ivory-950 cursor-pointer'}
        >
          <MousePointer2 size={13} aria-hidden='true' />
        </button>
        <button
          type='button'
          title='Pan - drag to move around'
          aria-pressed={tool === 'pan'}
          onClick={() => setTool('pan')}
          className={tool === 'pan'
            ? 'rounded-md border border-ivory-950 bg-ivory-950 p-1.5 text-ivory-100'
            : 'rounded-md border border-transparent p-1.5 text-ivory-600 hover:border-[var(--color-line)] hover:text-ivory-950 cursor-pointer'}
        >
          <Hand size={13} aria-hidden='true' />
        </button>
        <span className='mx-0.5 w-px self-stretch bg-[var(--color-line)]' aria-hidden='true' />
        <button
          type='button'
          title='Group selection (Ctrl+G)'
          aria-label='Group selection'
          onClick={onGroup}
          disabled={!canGroup}
          className='rounded-md border border-transparent p-1.5 text-ivory-600 hover:border-[var(--color-line)] hover:text-ivory-950 cursor-pointer disabled:cursor-default disabled:opacity-40 disabled:hover:border-transparent disabled:hover:text-ivory-600'
        >
          <Group size={13} aria-hidden='true' />
        </button>
        <button
          type='button'
          title='Ungroup selection (Ctrl+Shift+G)'
          aria-label='Ungroup selection'
          onClick={onUngroup}
          disabled={!canUngroup}
          className='rounded-md border border-transparent p-1.5 text-ivory-600 hover:border-[var(--color-line)] hover:text-ivory-950 cursor-pointer disabled:cursor-default disabled:opacity-40 disabled:hover:border-transparent disabled:hover:text-ivory-600'
        >
          <Ungroup size={13} aria-hidden='true' />
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={selEdges}
        nodeTypes={systemNodeTypes}
        connectionMode={ConnectionMode.Loose}
        onNodesChange={groupedOnChange}
        onNodeDragStart={() => { draggingRef.current = true; onDragStartNode(); }}
        onNodeDragStop={(_, node) => { draggingRef.current = false; const members = groupOf.get(node.id) ?? [node.id]; const live = new Map(getNodes().map((n) => [n.id, n.position])); const moves: { id: string; x: number; y: number }[] = []; for (const id of members) { const pos = live.get(id); if (pos) moves.push({ id, x: pos.x, y: pos.y }); } if (moves.length > 0) onMoveSystems(moves); }}
        onConnect={(c: Connection) => {
          if (c.source && c.target && c.source !== c.target) onConnectSystems(c.source, c.target);
        }}
        onNodeClick={(e, node) => { if (e.shiftKey) { shiftSkipRef.current = Date.now(); onToggleSelect(node.id); } else onSelect(node.id, null); }}
        onEdgeClick={(_, edge) => onSelect(null, edge.id)}
        onPaneClick={() => onSelect(null, null)}
        onSelectionChange={({ nodes: sn }) => {
          // Marquee is the only writer here: single clicks stay with the
          // click handlers (no select-echo loop), shift-clicks with
          // toggleMultiSelect for a beat after the click.
          if (Date.now() - shiftSkipRef.current < 250) return;
          const ids = sn.map((n) => n.id);
          if (ids.length >= 2) onMarqueeSelect(ids);
        }}
        minZoom={0.15}
        zoomOnScroll={false}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnPinch={false}
        panOnDrag={isTouchOrPen ? false : tool === 'select' ? [1, 2] : [0, 1, 2]}
        selectionOnDrag={tool === 'select' && !isTouchOrPen}
        selectionMode={SelectionMode.Partial}
        fitView
      >
        <Background gap={22} size={1.2} color="#DDD3BC" bgColor="#FAF8F2" />
        {miniMapOn && (
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeColor="#D9CFB6"
            nodeStrokeColor="#9A7653"
            style={{ background: "#FFFFFF", border: "1px solid #DDD3BC", borderRadius: 8 }}
            maskColor="rgba(250, 248, 242, 0.75)"
          />
        )}
        <Controls position="bottom-left" />
      </ReactFlow>
      {project.systems.length === 0 && !started && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-6 pointer-events-none">
          <div className="pointer-events-auto max-w-sm rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-6 py-5 text-center shadow-[0_12px_36px_-16px_rgba(24,20,12,0.4)]">
            <svg width="300" height="120" viewBox="0 0 300 120" fill="none" aria-hidden="true" className="mx-auto h-auto w-full max-w-[280px]">
              <rect x="14" y="36" width="72" height="48" rx="10" fill="#FFFFFF" stroke="#9A7653" strokeWidth="1.5" />
              <circle cx="50" cy="52" r="7" fill="#C9A86A" />
              <line x1="26" y1="68" x2="62" y2="68" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
              <line x1="26" y1="77" x2="74" y2="77" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
              <rect x="114" y="28" width="72" height="64" rx="10" fill="#27241F" />
              <circle cx="150" cy="48" r="7" fill="#C9A86A" />
              <line x1="126" y1="64" x2="162" y2="64" stroke="#C9A86A" strokeWidth="4" strokeLinecap="round" />
              <line x1="126" y1="74" x2="174" y2="74" stroke="#6B655C" strokeWidth="4" strokeLinecap="round" />
              <rect x="214" y="36" width="72" height="48" rx="10" fill="#FFFFFF" stroke="#9A7653" strokeWidth="1.5" />
              <circle cx="250" cy="52" r="7" fill="none" stroke="#9A7653" strokeWidth="2" />
              <circle cx="250" cy="52" r="2.5" fill="#9A7653" />
              <line x1="226" y1="68" x2="262" y2="68" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
              <line x1="226" y1="77" x2="274" y2="77" stroke="#E3D9C6" strokeWidth="4" strokeLinecap="round" />
              <line x1="86" y1="60" x2="114" y2="60" stroke="#C9A86A" strokeWidth="1.5" strokeDasharray="4 4" />
              <circle cx="100" cy="60" r="3" fill="#C9A86A" />
              <line x1="186" y1="60" x2="214" y2="60" stroke="#C9A86A" strokeWidth="1.5" strokeDasharray="4 4" />
              <circle cx="200" cy="60" r="3" fill="#C9A86A" />
              <text x="50" y="106" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="9" fontWeight="700" fill="#A39B8E">SOURCE</text>
              <text x="150" y="106" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="9" fontWeight="700" fill="#A39B8E">HUB</text>
              <text x="250" y="106" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="9" fontWeight="700" fill="#A39B8E">TARGET</text>
            </svg>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-[1.8px] text-[var(--color-accent-dark)]">
              System Design
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ivory-700">
              Drag a system in from the inventory - or start from a template.
            </p>
            <p className="mt-2.5 text-[11px] text-ivory-500">⌘/Ctrl+Z undo · Del removes · drag between nodes to connect</p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <Button size="sm" onClick={() => setStarted(true)}>
                Start
              </Button>
              <Button size="sm" variant="secondary" onClick={emptyAction}>
                Browse templates
              </Button>
            </div>
          </div>
        </div>
      )}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onDeleteSelection}
          disabled={!canDelete}
          title="Delete selection (Del)"
          aria-label="Delete selection"
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 text-ivory-700 transition-colors cursor-pointer hover:border-red-400 hover:text-red-700 disabled:cursor-default disabled:opacity-40 disabled:hover:border-[var(--color-line)] disabled:hover:text-ivory-700"
        >
          <Trash2 size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onRebalance}
          disabled={project.systems.length === 0}
          title="Rebalance layout - flow sources left, sinks right"
          aria-label="Rebalance layout"
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 text-ivory-700 transition-colors cursor-pointer hover:border-[var(--color-accent)] hover:text-ivory-950 disabled:cursor-default disabled:opacity-40"
        >
          <Shuffle size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onTogglePresent}
          aria-label={present ? "Exit full screen" : "Enter full screen"}
          title={present ? "Exit full screen" : "Full screen: hide header, footer and bars for presenting"}
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950 transition-colors cursor-pointer"
        >
          {present ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => fitView({ padding: 0.18, maxZoom: 1 })}
          title="Fit canvas to view"
          aria-label="Fit view"
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950 transition-colors cursor-pointer"
        >
          <Maximize size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToggleMiniMap}
          aria-pressed={miniMapOn}
          title={miniMapOn ? "Hide the overview map" : "Show the overview map"}
          aria-label="Map"
          className={`rounded-lg border p-1.5 transition-colors cursor-pointer ${miniMapOn ? "border-bronze-500 bg-bronze-100 text-bronze-700" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950"}`}
        >
          <MapIcon size={13} aria-hidden="true" />
        </button>
        {exportError && (
          <span className="rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-700" role="alert">
            {exportError}
          </span>
        )}
        <button
          type="button"
          onClick={() => doExport(2)}
          disabled={exporting || nodes.length === 0}
          title="Download the full diagram as PNG (2x)"
          aria-label="Snapshot PNG"
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950 transition-colors cursor-pointer disabled:opacity-40"
        >
          {exporting ? "Exporting…" : <Camera size={13} aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => doExport(3)}
          disabled={exporting || nodes.length === 0}
          title="Download the full diagram as hi-res PNG (3x) for decks"
          aria-label="3x Hi-Res"
          className="rounded-lg border border-ivory-950 bg-ivory-950 p-1.5 text-ivory-100 hover:bg-bronze-600 hover:border-bronze-600 transition-colors cursor-pointer disabled:opacity-40"
        >
          <Download size={13} aria-hidden="true" />
        </button>
        <a
          href="/console"
          title="Open Console - track this design as tasks with two-way TODO sync"
          aria-label="Console"
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950 transition-colors cursor-pointer"
        >
          <Terminal size={13} aria-hidden="true" />
        </a>
        <button
          type="button"
          onClick={onOpenViews}
          title="C4 views - context, container, component projections of this canvas"
          aria-label="Views"
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950 transition-colors cursor-pointer"
        >
          <Layers size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onOpenRisks}
          title="Risk lens - deterministic findings over this design"
          aria-label="Risks"
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950 transition-colors cursor-pointer"
        >
          <TriangleAlert size={13} aria-hidden="true" />
        </button>
      </div>
      {project.systems.length > 0 && project.connections.length === 0 && (
        <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
          <p className="rounded-full border border-bronze-300 bg-bronze-100 px-3 py-1.5 text-[11px] font-semibold text-bronze-700 shadow-sm">
            Drag from a bronze dot to another node - or pick Connect to… in the inspector
          </p>
        </div>
      )}
    </div>
  );
}

/** Collapsed-inspector jump targets. Missing groups fall back to panel top. */
type InspectorSection = "identity" | "connect" | "operations" | "test" | "mock" | "mapping";
const INSPECTOR_JUMP: Record<InspectorSection, { node: string; edge: string }> = {
  identity: { node: "identity", edge: "identity" },
  connect: { node: "connect", edge: "connect" },
  // Test buttons live on operation rows, so node test lands on operations.
  operations: { node: "operations", edge: "connect" },
  test: { node: "operations", edge: "test" },
  // Mocks are per-operation; edges have none and fall back to panel top.
  mock: { node: "mock", edge: "mock" },
  mapping: { node: "mapping", edge: "mapping" },
};
const INSPECTOR_ICONS: Record<InspectorSection, typeof Zap> = {
  identity: IdCard,
  connect: Plug,
  operations: Zap,
  test: Play,
  mock: FlaskConical,
  mapping: Shuffle,
};
const INSPECTOR_STRIP: { id: InspectorSection; label: string; title: string }[] = [
  { id: "identity", label: "Identity", title: "Identity - expand and jump to it" },
  { id: "connect", label: "Connect", title: "Connect - expand and jump to it" },
  { id: "operations", label: "Operations", title: "Operations - expand and jump to them" },
  { id: "test", label: "Test", title: "Test - expand and jump to it" },
  { id: "mock", label: "Mock", title: "Mock - expand and jump to it" },
  { id: "mapping", label: "Mapping", title: "Mapping - expand and jump to it" },
];
/** Resolve a jump anchor, seeing through display:contents wrappers. */
function resolveJumpBox(el: Element | null): Element | null {
  if (!el) return null;
  if (el instanceof HTMLElement && getComputedStyle(el).display === "contents") return el.firstElementChild;
  return el;
}

/** Validate a stored record, then backfill default interfaces for systems
 * that have none - vintage projects open with a working catalog. Every
 * load path uses this instead of validateProject directly. */
function validateStoredProject(raw: unknown): ReturnType<typeof validateProject> {
  const { project, issues } = validateProject(raw);
  return { project: project ? pruneCanvasGroups(ensureDefaultInterfaces(project)) : null, issues };
}

export function SystemDesigner() {
  const [project, setProject] = useState<SystemProject | null>(null);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [selNodeId, setSelNodeId] = useState<string | null>(null);
  const [selEdgeId, setSelEdgeId] = useState<string | null>(null);
  const [selNoteId, setSelNoteId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [selIds, setSelIds] = useState<string[]>([]);
  const [subTab, setSubTab] = useState<SubTab>("canvas");
  /** Catalog "Bind" flow: operation picked in API Catalog, awaiting an edge click. */
  const [pendingBindOpId, setPendingBindOpId] = useState<string | null>(null);
  const [testOpId, setTestOpId] = useState<string | null>(null);
  const [runChainEdgeId, setRunChainEdgeId] = useState<string | null>(null);
  const [runChainScenarioId, setRunChainScenarioId] = useState<string | null>(null);
  /** Ephemeral execution paint: edgeId -> run status. Cleared on close/rerun. */
  const [runVis, setRunVis] = useState<Record<string, "running" | "ok" | "failed">>({});
  const [notesOpen, setNotesOpen] = useState(false);
  const [credOpen, setCredOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  /** Overview map: hidden by default, toggle lives on the canvas. Choice persists per browser. */
  const [miniMapOn, setMiniMapOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem("sd_minimap") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("sd_minimap", miniMapOn ? "1" : "0");
    } catch {
      /* private mode - session default stands */
    }
  }, [miniMapOn]);
  /** Session credential vault: tab memory + sessionStorage mirror, never in IDB/projects/exports. */
  const [vault, setVault] = useState<CredVault>(() => loadCredVault());
  useEffect(() => {
    try {
      if (Object.keys(vault).length === 0) sessionStorage.removeItem(CRED_VAULT_KEY);
      else sessionStorage.setItem(CRED_VAULT_KEY, JSON.stringify(vault));
    } catch {
      /* private mode etc - memory still holds the tab session */
    }
  }, [vault]);
  const [runEdgeId, setRunEdgeId] = useState<string | null>(null);
  const [present, setPresent] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("sf-present", present);
    return () => {
      document.body.classList.remove("sf-present");
    };
  }, [present]);
  const [inventoryOpen, setInventoryOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const inspectorBodyRef = useRef<HTMLDivElement | null>(null);
  const [risksOpen, setRisksOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [c4View, setC4View] = useState<C4View>("all");
  const hiddenIds = useMemo(() => (project ? hiddenNodeIds(project, c4View) : new Set<string>()), [project, c4View]);
  const [inventorySearch, setInventorySearch] = useState("");
  const [showList, setShowList] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [projectList, setProjectList] = useState<{ id: string; name: string; updatedAt: number }[]>([]);
  const [importIssues, setImportIssues] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Autosave: debounced IDB write on every change + flush on tab hide/close,
  // so refresh never loses canvas work. Explicit Save stays for certainty +
  // project-list refresh. Guards: never before the initial load completes.
  const readyRef = useRef(false);
  const projectRef = useRef<SystemProject | null>(null);
  projectRef.current = project;

  // Initial load: most recent project, else a fresh one (unsaved until Save).
  useEffect(() => {
    void (async () => {
      // Collaboration entry: ?share=<id> imports the shared project as a
      // local copy. Consumed once; the key is cleared either way.
      try {
        const q = new URLSearchParams(window.location.search);
        const shareId = q.get("share")?.trim() || null;
        if (shareId) {
          syncDeepParam("share", null);
          try {
            const res = await fetch(`/api/share/${encodeURIComponent(shareId)}`);
            const raw: unknown = await res.json().catch(() => null);
            const env = validateShareEnvelope(raw);
            if (res.ok && env && env.kind === "system-project") {
              const { project: imported, issues } = importProject(env.data);
              const valid = imported ? ensureDefaultInterfaces(imported) : null;
              if (valid) {
                try { sessionStorage.removeItem(SYSTEM_DRAFT_KEY); } catch { /* ignore */ }
                setProject({ ...valid, id: newId("proj"), name: `${valid.name} (shared)`, updatedAt: Date.now() });
                setPast([]);
                setFuture([]);
                setSelNodeId(null);
                setSelEdgeId(null);
                setSaveState("dirty");
                setProjectList(await listSystemProjects());
                return;
              }
              void issues;
              setImportIssues(["$: Shared project failed validation - link ignored."]);
            } else {
              setImportIssues(["$: Share link expired, invalid, or not a system project."]);
            }
          } catch {
            setImportIssues(["$: Could not read that share link."]);
          }
        }
      } catch {
        /* non-browser or blocked query - normal load */
      }
      try {
        const raw = sessionStorage.getItem(SYSTEM_DRAFT_KEY);
        if (raw) {
          sessionStorage.removeItem(SYSTEM_DRAFT_KEY);
          const { project: valid } = validateStoredProject(JSON.parse(raw));
          if (valid) {
            setProject({ ...valid, updatedAt: Date.now() });
            setPast([]);
            setFuture([]);
            setSelNodeId(null);
            setSelEdgeId(null);
            setSaveState("dirty");
            setProjectList(await listSystemProjects());
            return;
          }
        }
      } catch {
        /* corrupted handoff - fall through to the normal load */
      }
      const list = await listSystemProjects();
      setProjectList(list);
      let deepProject: string | null = null;
      let deepSelect: string | null = null;
      try {
        const q = new URLSearchParams(window.location.search);
        deepProject = q.get("project")?.trim() || null;
        deepSelect = q.get("select")?.trim() || null;
      } catch {
        /* non-browser or blocked query - normal load */
      }
      if (deepProject && list.some((p) => p.id === deepProject)) {
        const deepLoaded = await loadSystemProject(deepProject);
        if (deepLoaded) {
          const { project: deepValid } = validateStoredProject(deepLoaded);
          if (deepValid) {
            setProject(deepValid);
            if (deepSelect) {
              if (deepValid.systems.some((s) => s.id === deepSelect)) {
                setSelNodeId(deepSelect);
                setSelEdgeId(null);
              } else if (deepValid.connections.some((c) => c.id === deepSelect)) {
                setSelEdgeId(deepSelect);
                setSelNodeId(null);
              }
            }
            return;
          }
        }
      }
      if (list.length > 0) {
        const loaded = await loadSystemProject(list[0].id);
        if (loaded) {
          const { project: valid, issues } = validateStoredProject(loaded);
          if (valid) {
            setProject(valid);
            return;
          }
          void issues;
        }
      }
      setProject(newProject());
    })();
    readyRef.current = true;
  }, []);

  // Keep the URL on the saved project so canvases are linkable and a reload
  // restores them. Unsaved drafts clear the key instead of advertising an id
  // that resolves nowhere.
  useEffect(() => {
    if (!project) return;
    syncDeepParam("project", projectList.some((p) => p.id === project.id) ? project.id : null);
  }, [project, projectList]);

  // Debounced autosave: every mutation persists ~800ms later. Guards keep the
  // initial load from ever being overwritten by a blank state.
  useEffect(() => {
    if (!readyRef.current || !project) return;
    const t = window.setTimeout(() => {
      const p = projectRef.current;
      if (!p) return;
      void (async () => {
        try {
          await saveSystemProject(p);
          setSaveState((s) => (s === "dirty" ? "saved" : s));
          setProjectList(await listSystemProjects());
        } catch {
          setSaveState("error");
          setSaveError("Autosave failed - hit Save to retry (IndexedDB unavailable or quota exceeded).");
        }
      })();
    }, 800);
    return () => window.clearTimeout(t);
  }, [project]);

  // Flush on tab hide/close so the last strokes survive.
  useEffect(() => {
    const flush = () => {
      const p = projectRef.current;
      if (p && readyRef.current) void saveSystemProject(p).catch(() => {});
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const pushHistory = useCallback((p: SystemProject | null) => {
    if (!p) return;
    setPast((prev) => [...prev.slice(-49), snapOf(p)]);
    setFuture([]);
  }, []);

  const mutate = useCallback((fn: (p: SystemProject) => SystemProject) => {    setProject((prev) => {
      if (!prev) return prev;
      pushHistory(prev);
      const next = fn({ ...prev, systems: [...prev.systems], connections: [...prev.connections] });
      return next;
    });
    setSaveState("dirty");
  }, [pushHistory]);

  /** App-modal replacement for window.confirm: one pending action at a time. */
  const [pendingAction, setPendingAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    danger?: boolean;
    run: () => void;
  } | null>(null);

  /** Active environment + production guard: PROD targets confirm every run. */
  const activeEnv = project?.environments.find((e) => e.id === project.activeEnvironmentId) ?? null;
  const guardProd = (action: () => void): void => {
    if (activeEnv?.isProduction) {
      setPendingAction({
        title: `"${activeEnv.name}" is marked PRODUCTION.`,
        message: "This run hits live systems. Confirm to proceed.",
        confirmLabel: "Run anyway",
        danger: true,
        run: action,
      });
      return;
    }
    action();
  };
  const openTestOp = (opId: string): void => guardProd(() => setTestOpId(opId));
  const openEdgeRun = (edgeId: string): void => guardProd(() => setRunEdgeId(edgeId));
  const openChainRun = (edgeId: string): void => guardProd(() => {
    setRunChainEdgeId(edgeId);
    setRunChainScenarioId(null);
    setRunVis({});
  });
  const locateSystem = (systemId: string): void => {
    setSubTab("canvas");
    setSelNodeId(systemId);
    setSelEdgeId(null);
  };
  const bindOperation = (opId: string): void => {
    setPendingBindOpId(opId);
    setSubTab("canvas");
  };
  const pendingBindOp = project?.operations.find((o) => o.id === pendingBindOpId) ?? null;
  // Catalog Bind: the next clicked edge auto-binds on the operation's end.
  useEffect(() => {
    if (!selEdgeId || !pendingBindOpId) return;
    const p = projectRef.current;
    const op = p?.operations.find((o) => o.id === pendingBindOpId);
    const conn = p?.connections.find((c) => c.id === selEdgeId);
    const iface = p?.interfaces.find((f) => f.id === op?.interfaceId);
    if (op && conn && iface && (iface.systemId === conn.sourceId || iface.systemId === conn.targetId)) {
      const patch = iface.systemId === conn.sourceId ? { sourceOperationId: op.id } : { targetOperationId: op.id };
      mutate((prev) => ({
        ...prev,
        connections: prev.connections.map((c) => (c.id === selEdgeId ? { ...c, ...patch } : c)),
      }));
    }
    setPendingBindOpId(null);
  }, [selEdgeId, pendingBindOpId, mutate]);
  /** Flow Lab: apply the named sequence as chain scope and open the runner. */
  const runFlow = (flow: FlowDef): void => {
    guardProd(() => {
      mutate((p) => ({ ...p, runScope: { startEdgeId: flow.startEdgeId, lanes: [...flow.lanes], opByEdge: { ...flow.opByEdge } } }));
      setSubTab("canvas");
      setRunChainEdgeId(flow.startEdgeId);
      setRunChainScenarioId(null);
      setRunVis({});
    });
  };
  /** Scenarios: apply mocks, seed the start payload, set env + scope, run. */
  const runScenario = (s: ScenarioDef): void => {
    const flow = project?.flows.find((f) => f.id === s.flowId);
    if (!project || !flow) return;
    const mockCount = Object.keys(s.mockOverrides).length;
    const fire = (): void => guardProd(() => {
      mutate((p) => {
        const startEdge = p.connections.find((c) => c.id === flow.startEdgeId);
        const operations = p.operations.map((o) => {
          let next = o;
          const ov = s.mockOverrides[o.id];
          if (ov) next = { ...next, mock: { ...ov } };
          if (startEdge && o.id === startEdge.sourceOperationId && s.inputPayload.trim()) {
            next = { ...next, sampleBody: s.inputPayload };
          }
          return next;
        });
        return {
          ...p,
          operations,
          runScope: { startEdgeId: flow.startEdgeId, lanes: [...flow.lanes], opByEdge: { ...flow.opByEdge } },
          activeEnvironmentId:
            s.environmentId && p.environments.some((e) => e.id === s.environmentId) ? s.environmentId : p.activeEnvironmentId,
        };
      });
      setSubTab("canvas");
      setRunChainEdgeId(flow.startEdgeId);
      setRunChainScenarioId(s.id);
      setRunVis({});
    });
    if (mockCount > 0) {
      setPendingAction({
        title: `Apply ${mockCount} mock override${mockCount === 1 ? "" : "s"} and run?`,
        message: "Existing mocks on those operations are replaced, the start payload is seeded, and the chain runner opens.",
        confirmLabel: "Apply and run",
        run: fire,
      });
      return;
    }
    fire();
  };

  const undo = useCallback(() => {
    setPast((prevPast) => {
      if (prevPast.length === 0 || !project) return prevPast;
      setFuture((prevFuture) => [snapOf(project), ...prevFuture].slice(0, 50));
      const last = prevPast[prevPast.length - 1];
      setProject((prev) => (prev ? { ...prev, systems: last.systems, connections: last.connections, canvasNotes: last.canvasNotes, canvasImages: last.canvasImages } : prev));
      setSaveState("dirty");
      setSelNodeId(null);
      setSelEdgeId(null);
      setSelNoteId(null);
      setEditingNoteId(null);
      return prevPast.slice(0, -1);
    });
  }, [project]);

  const redo = useCallback(() => {
    setFuture((prevFuture) => {
      if (prevFuture.length === 0 || !project) return prevFuture;
      setPast((prevPast) => [...prevPast.slice(-49), snapOf(project)]);
      const [next, ...rest] = prevFuture;
      setProject((prev) => (prev ? { ...prev, systems: next.systems, connections: next.connections, canvasNotes: next.canvasNotes, canvasImages: next.canvasImages } : prev));
      setSaveState("dirty");
      setSelNodeId(null);
      setSelEdgeId(null);
      setSelNoteId(null);
      setEditingNoteId(null);
      return rest;
    });
  }, [project]);

  /** Group the current selection (buttons + Ctrl+G share this). */
  const groupSelection = useCallback((): boolean => {
    if (!project) return false;
    const members = selIds.filter((id) => project.systems.some((x) => x.id === id) || project.canvasNotes.some((x) => x.id === id) || project.canvasImages.some((x) => x.id === id));
    if (members.length < 2) return false;
    const dupe = project.groups.some((g) => g.memberIds.length === members.length && members.every((m) => g.memberIds.includes(m)));
    if (dupe) return false;
    mutate((p) => ({ ...p, groups: [...p.groups, { id: newId('group'), memberIds: members }] }));
    return true;
  }, [project, selIds, mutate]);

  /** Ungroup every group touching the selection (buttons + Ctrl+Shift+G/U). */
  const ungroupSelection = useCallback((): boolean => {
    if (!project) return false;
    if (!project.groups.some((g) => g.memberIds.some((m) => selIds.includes(m)))) return false;
    mutate((p) => ({ ...p, groups: p.groups.filter((g) => !g.memberIds.some((m) => selIds.includes(m))) }));
    return true;
  }, [project, selIds, mutate]);

  // Shared by the Del key and the canvas toolbar delete button.
  // Multi-delete: every selected node goes; edges touching them go too.
  const deleteSelection = useCallback(() => {
    if (!(selNodeId || selEdgeId || selNoteId || selIds.length > 0)) return;
    const sysDel = new Set(selIds.filter((id) => project?.systems.some((x) => x.id === id)));
    if (selNodeId) sysDel.add(selNodeId);
    const eid = selEdgeId;
    const markDel = new Set(
      selIds.filter(
        (id) => project?.canvasNotes.some((n) => n.id === id) || project?.canvasImages.some((g) => g.id === id)
      )
    );
    if (selNoteId) markDel.add(selNoteId);
    const doomedBlobs = project?.canvasImages.filter((g) => markDel.has(g.id)).map((g) => g.blobId) ?? [];
    mutate((p) =>
      pruneCanvasGroups({
        ...p,
        systems: p.systems.filter((x) => !sysDel.has(x.id)),
        connections: p.connections.filter(
          (c) => c.id !== eid && !sysDel.has(c.sourceId) && !sysDel.has(c.targetId)
        ),
        canvasNotes: p.canvasNotes.filter((n) => !markDel.has(n.id)),
        canvasImages: p.canvasImages.filter((g) => !markDel.has(g.id)),
      })
    );
    for (const b of doomedBlobs) void deleteCanvasBlob(b);
    setSelIds([]);
    setSelNodeId(null);
    setSelEdgeId(null);
    setSelNoteId(null);
    setEditingNoteId(null);
  }, [selNodeId, selEdgeId, selNoteId, selIds, mutate, project]);

  // Keyboard: delete selection, undo/redo, escape clears.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g" && !e.shiftKey) {
        e.preventDefault();
        groupSelection();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && ((e.key.toLowerCase() === "g" && e.shiftKey) || (e.shiftKey && e.key.toLowerCase() === "u"))) {
        e.preventDefault();
        ungroupSelection();
        return;
      }
      if (e.key === "Escape") {
        setSelIds([]);
        setSelNodeId(null);
        setSelEdgeId(null);
        setSelNoteId(null);
        setEditingNoteId(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && (selNodeId || selEdgeId || selNoteId || selIds.length > 0)) {
        e.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selNodeId, selEdgeId, selNoteId, selIds, mutate, undo, redo, project, groupSelection, ungroupSelection, deleteSelection]);

  const expandGroup = useCallback((id: string): string[] => {
    const g = project?.groups.find((gg) => gg.memberIds.includes(id));
    return g ? [...g.memberIds] : [id];
  }, [project]);

  const handleSelect = useCallback((nodeId: string | null, edgeId: string | null) => {
    if (!project) {
      setSelIds([]); setSelNodeId(null); setSelEdgeId(null); setSelNoteId(null);
      return;
    }
    if (nodeId) {
      // Clicking a grouped member selects the whole group.
      const ids = [...new Set([nodeId, ...expandGroup(nodeId)])];
      setSelIds(ids);
      const sysFirst = ids.find((x) => project.systems.some((x2) => x2.id === x)) ?? null;
      setSelNodeId(sysFirst);
      setSelEdgeId(null);
      setSelNoteId(sysFirst ? null : (ids[0] ?? null));
      if (sysFirst) setInspectorOpen(true);
      return;
    }
    setSelIds([]);
    setSelNoteId(null);
    setSelNodeId(null);
    setSelEdgeId(edgeId);
    // A collapsed inspector must never swallow selection: picking an edge
    // reopens it so APIs stay one click away.
    if (edgeId) setInspectorOpen(true);
  }, [project, expandGroup]);

  /** Shift-click toggles one node in the id set (group-aware): the only
   * multi-select writer. Nothing reads selection back, so no echo loop. */
  const toggleMultiSelect = useCallback((id: string) => {
    if (!project) return;
    const next = selIds.includes(id) ? selIds.filter((x) => x !== id) : [...selIds, ...expandGroup(id)];
    const uniq = [...new Set(next)];
    setSelIds(uniq);
    const sysFirst = uniq.find((x) => project.systems.some((x2) => x2.id === x)) ?? null;
    setSelNodeId(sysFirst);
    setSelEdgeId(null);
    const markFirst = uniq.find((x) => project.canvasNotes.some((x2) => x2.id === x) || project.canvasImages.some((x2) => x2.id === x)) ?? null;
    setSelNoteId(sysFirst ? null : markFirst);
  }, [project, selIds, expandGroup]);

  /** Marquee/box select adopts the React Flow set, group-aware, and
   * opens the inspector multi panel. Single clicks never reach here,
   * so the old select-echo loop cannot recur. */
  const handleMarqueeSelect = useCallback((ids: string[]) => {
    if (!project || ids.length < 2) return;
    const expanded = [...new Set(ids.flatMap((id) => expandGroup(id)))];
    setSelIds((prev) => (prev.length === expanded.length && expanded.every((id) => prev.includes(id)) ? prev : expanded));
    const sysFirst = expanded.find((x) => project.systems.some((x2) => x2.id === x)) ?? null;
    setSelNodeId(sysFirst);
    setSelEdgeId(null);
    const markFirst = expanded.find((x) => project.canvasNotes.some((x2) => x2.id === x) || project.canvasImages.some((x2) => x2.id === x)) ?? null;
    setSelNoteId(sysFirst ? null : markFirst);
    setInspectorOpen(true);
  }, [project, expandGroup]);



  /** Expand a collapsed inspector and jump to a section (or panel top). */
  const jumpInspector = (section: InspectorSection) => {
    setInspectorOpen(true);
    const target = INSPECTOR_JUMP[section][selEdgeId ? "edge" : "node"];
    window.setTimeout(() => {
      const root = inspectorBodyRef.current;
      if (!root) return;
      const box = resolveJumpBox(root.querySelector(`[data-insp="${target}"]`));
      (box ?? root).scrollIntoView({ block: "start", behavior: "smooth" });
    }, 30);
  };

  const addSystem = useCallback((t: SystemTemplate, at?: { x: number; y: number }) => {
    mutate((p) => {
      const n = p.systems.filter((s) => s.systemType === t.systemType).length + 1;
      const pos = at ?? { x: 120 + (p.systems.length % 5) * 60, y: 120 + (p.systems.length % 5) * 60 };
      // A dropped system is immediately operable: it carries a default
      // REST interface so the catalog and edge binding just work.
      const sys = newSystemFromTemplate(t, pos, n);
      return { ...p, systems: [...p.systems, sys], interfaces: [...p.interfaces, defaultInterfaceFor(sys.id)] };
    });
  }, [mutate]);

  /** Canvas marks: double-click writes, paste drops images. Marks ride
   * mutate (autosave + undo) exactly like systems. */
  const writeNoteAt = useCallback((pos: { x: number; y: number }, initial: string) => {
    // Note body is w-52 (~208px): land its center on the cursor, not its corner.
    const id = newId('note');
    const now = Date.now();
    mutate((p) => ({ ...p, canvasNotes: [...p.canvasNotes, { id, position: { x: pos.x - 104, y: pos.y - 20 }, text: initial, createdAt: now, updatedAt: now }] }));
    setSelNoteId(id);
    setSelNodeId(null);
    setSelEdgeId(null);
    setEditingNoteId(id);
  }, [mutate]);

  const beginNoteEdit = useCallback((id: string) => {
    setSelNoteId(id);
    setSelNodeId(null);
    setSelEdgeId(null);
    setEditingNoteId(id);
  }, []);

  const commitNoteText = useCallback((id: string, text: string) => {
    setEditingNoteId(null);
    // Blank saves remove the note so abandoned doubles never litter.
    mutate((p) => ({
      ...p,
      canvasNotes: text.trim()
        ? p.canvasNotes.map((n) => (n.id === id ? { ...n, text, updatedAt: Date.now() } : n))
        : p.canvasNotes.filter((n) => n.id !== id),
    }));
    if (!text.trim()) setSelNoteId(null);
  }, [mutate]);

  const cancelNoteEdit = useCallback((id: string) => {
    setEditingNoteId(null);
    if (project?.canvasNotes.some((n) => n.id === id && n.text === '')) {
      mutate((p) => ({ ...p, canvasNotes: p.canvasNotes.filter((n) => n.id !== id) }));
      setSelNoteId(null);
    }
  }, [mutate, project]);

  /** Delete one canvas mark (panel button mirrors the Del key). */
  const deleteMark = useCallback((id: string) => {
    const blob = project?.canvasImages.find((g) => g.id === id)?.blobId;
    mutate((p) =>
      pruneCanvasGroups({
        ...p,
        canvasNotes: p.canvasNotes.filter((n) => n.id !== id),
        canvasImages: p.canvasImages.filter((g) => g.id !== id),
      })
    );
    if (blob) void deleteCanvasBlob(blob);
    setSelIds((prev) => prev.filter((x) => x !== id));
    setSelNoteId(null);
    setEditingNoteId(null);
  }, [project, mutate]);

  const appendTargetId = selNoteId && selIds.length === 1 && selIds[0] === selNoteId && project?.canvasNotes.some((n) => n.id === selNoteId) ? selNoteId : null;

  /** Typing with exactly one note selected appends into it (draw.io)
   * instead of spawning a new note. */
  const appendNoteChar = useCallback((id: string, ch: string) => {
    mutate((p) => ({ ...p, canvasNotes: p.canvasNotes.map((n) => (n.id === id ? { ...n, text: n.text + ch, updatedAt: Date.now() } : n)) }));
    setEditingNoteId(id);
  }, [mutate]);

  const resizeCanvasImage = useCallback((id: string, width: number, height: number) => {
    mutate((p) => ({ ...p, canvasImages: p.canvasImages.map((g) => (g.id === id ? { ...g, width, height } : g)) }));
  }, [mutate]);

  const pasteImageAt = useCallback((file: File, pos: { x: number; y: number }) => {
    if (!isPastesableImage(file)) return;
    void (async () => {
      try {
        const dims = await probeImageSize(file);
        const width = Math.min(Math.max(16, dims.width), 560);
        const height = Math.max(16, Math.round((dims.height * width) / Math.max(1, dims.width)));
        const blobId = newBlobId();
        await putCanvasBlob({ id: blobId, mime: file.type, bytes: file, width: dims.width, height: dims.height, createdAt: Date.now() });
        const id = newId('cimg');
        mutate((p) => ({
          ...p,
          canvasImages: [...p.canvasImages, { id, position: pos, width, height, blobId, name: file.name || 'Pasted image', createdAt: Date.now() }],
        }));
        setSelNoteId(id);
        setSelNodeId(null);
        setSelEdgeId(null);
      } catch {
        // Quota or unreadable file - canvas unchanged.
      }
    })();
  }, [mutate]);

  const connectSystems = useCallback((sourceId: string, targetId: string, label = "") => {
    if (!project || !project.systems.some((s) => s.id === sourceId) || !project.systems.some((s) => s.id === targetId)) return;
    const id = newId("conn");
    mutate((p) => ({
      ...p,
      connections: [...p.connections, { id, sourceId, targetId, label, status: "draft" as const }],
    }));
    // Reveal the new edge in the inspector immediately: label it, bind
    // operations, watch readiness flip. A drawn edge is topology - it never
    // creates interfaces; those are defined per system and bound explicitly.
    setSelEdgeId(id);
    setSelNodeId(null);
  }, [mutate, project]);

  // Blank-canvas loader shared by the UI New action and the sys.new bridge
  // command. Declared above the bridge context so the memo can close over it.
  const loadBuilt = useCallback((build: () => SystemProject) => {
    setPendingAction(null);
    setProject(build());
    setPast([]);
    setFuture([]);
    setSelNodeId(null);
    setSelEdgeId(null);
    setSaveState("dirty");
  }, []);

  // Rebalance: layered auto-layout (sources left, sinks right) with undo
  // via the mutate path. Declared above the bridge context like loadBuilt.
  const rebalanceCanvas = useCallback(() => {
    const p = projectRef.current;
    if (!p || p.systems.length === 0) return 0;
    const spots = rebalanceLayout(p);
    mutate((prev) => ({
      ...prev,
      systems: prev.systems.map((s) => {
        const at = spots.get(s.id);
        return at ? { ...s, position: { ...at } } : s;
      }),
    }));
    return p.systems.length;
  }, [mutate]);

  // Live agent bridge (sys.* commands): the tab-side context mirroring the
  // ERD bridge. projectRef (declared with the other refs) keeps handlers
  // fresh; registration re-runs when the stable callbacks change.
  const systemBridgeCtx = useMemo<SystemBridgeContext>(() => ({
    getProject: () => projectRef.current,
    newBlankProject: (name) => {
      const clean = (name ?? "").trim().slice(0, 80);
      const p = newProject(clean || undefined);
      loadBuilt(() => p);
      return { id: p.id, name: p.name };
    },
    placeSystems: (specs) => {
      const p = projectRef.current;
      if (!p) throw new Error("No system project open - open or create one in System Design first.");
      // Validate every type before mutating so failures save nothing.
      const templates = specs.map((s) => {
        const { templateIndex } = resolveSystemType(s.type);
        return SYSTEM_TEMPLATES[templateIndex];
      });
      const systems = [...p.systems];
      const interfaces = [...p.interfaces];
      const placed: string[] = [];
      templates.forEach((template, i) => {
        const s = specs[i];
        const n = systems.filter((x) => x.systemType === template.systemType).length + 1;
        // Agent-placed nodes land in a readable left-to-right row: 360px
        // pitch clears the ~260px node cards so draft edges stay visible.
        // The canvas pans, so later rows drop well below instead of crowding.
        const pos = {
          x: s.x ?? 120 + (systems.length % 5) * 360,
          y: s.y ?? 160 + Math.floor(systems.length / 5) * 280,
        };
        const sys = newSystemFromTemplate(template, pos, n);
        if (s.name) sys.name = s.name;
        systems.push(sys);
        interfaces.push(defaultInterfaceFor(sys.id));
        placed.push(sys.name);
      });
      mutate((prev) => ({ ...prev, systems: [...prev.systems, ...systems.slice(p.systems.length)], interfaces: [...prev.interfaces, ...interfaces.slice(p.interfaces.length)] }));
      return { placed };
    },
    connectByName: (from, to, label) => {
      const p = projectRef.current;
      if (!p) throw new Error("No system project open - open or create one in System Design first.");
      const a = resolveSystemByName(p.systems, from);
      const b = resolveSystemByName(p.systems, to);
      if (a.id === b.id) throw new Error("Cannot connect a system to itself.");
      connectSystems(a.id, b.id, label ?? "");
      return { from: a.name, to: b.name };
    },
    removeByName: (names) => {
      const p = projectRef.current;
      if (!p) throw new Error("No system project open - open or create one in System Design first.");
      // Resolve all first so an unknown name removes nothing.
      const doomed = names.map((n) => resolveSystemByName(p.systems, n));
      const gone = new Set(doomed.map((s) => s.id));
      mutate((prev) => ({
        ...prev,
        systems: prev.systems.filter((s) => !gone.has(s.id)),
        connections: prev.connections.filter((c) => !gone.has(c.sourceId) && !gone.has(c.targetId)),
      }));
      setSelIds((prevIds) => prevIds.filter((id) => !gone.has(id)));
      if (selNodeId && gone.has(selNodeId)) setSelNodeId(null);
      return { removed: doomed.map((s) => s.name) };
    },
    rebalance: () => ({ moved: rebalanceCanvas() }),
  }), [mutate, connectSystems, selNodeId, loadBuilt, rebalanceCanvas]);

  useEffect(() => {
    const handlers = buildSystemBridgeHandlers(systemBridgeCtx);
    for (const [kind, fn] of Object.entries(handlers)) registerBridgeHandler(kind, fn);
    return () => {
      for (const kind of Object.keys(handlers)) unregisterBridgeHandler(kind);
    };
  }, [systemBridgeCtx]);

  const moveSystems = useCallback((moves: { id: string; x: number; y: number }[]) => {
    setProject((prev) => {
      if (!prev) return prev;
      const byId = new Map(moves.map((m) => [m.id, m]));
      let changed = false;
      const systems = prev.systems.map((s) => {
        const m = byId.get(s.id);
        if (!m) return s;
        if (s.position.x === m.x && s.position.y === m.y) return s;
        changed = true;
        return { ...s, position: { x: m.x, y: m.y } };
      });
      // Canvas marks drag exactly like systems (same end-of-drag commit).
      const moveMark = <T extends { id: string; position: { x: number; y: number } }>(arr: T[]): T[] =>
        arr.map((m) => {
          const mv = byId.get(m.id);
          if (!mv) return m;
          if (m.position.x === mv.x && m.position.y === mv.y) return m;
          changed = true;
          return { ...m, position: { x: mv.x, y: mv.y } };
        });
      const canvasNotes = moveMark(prev.canvasNotes);
      const canvasImages = moveMark(prev.canvasImages);
      if (!changed) return prev;
      return { ...prev, systems, canvasNotes, canvasImages };
    });
    setSaveState("dirty");
  }, []);

  /** AI agent bridge: headless tools read/apply through the canvas mutate path. */
  useEffect(() => {
    registerSystemBridge({
      getSnapshot: () => snapshotOf(project, saveState === "dirty"),
      getProject: () => project,
      apply: (fn) => {
        mutate(fn);
        return { ok: true };
      },
    });
    return () => registerSystemBridge(null);
  }, [project, mutate, saveState]);

  const save = useCallback(async () => {
    if (!project) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      await saveSystemProject(project);
      setSaveState("saved");
      setProjectList(await listSystemProjects());
    } catch (err) {
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    }
  }, [project]);

  const replaceCanvas = useCallback((label: string, build: () => SystemProject) => {
    if (project && (project.systems.length > 0 || saveState === "dirty")) {
      setPendingAction({
        title: `Replace the current canvas with ${label}?`,
        message: "Unsaved work will be lost. This cannot be undone.",
        confirmLabel: "Replace canvas",
        run: () => loadBuilt(build),
      });
      return;
    }
    loadBuilt(build);
  }, [project, saveState, loadBuilt]);

  const loadDemo = useCallback(() => replaceCanvas("the demo architecture", buildDemoProject), [replaceCanvas]);

  const loadTmfSample = useCallback(() => replaceCanvas("the order-flow sample", buildTmfSampleProject), [replaceCanvas]);

  const loadGroqSample = useCallback(() => replaceCanvas("the GROQ chat sample", buildGroqSampleProject), [replaceCanvas]);

  const loadSample = useCallback((label: string, build: () => SystemProject) => replaceCanvas(label, build), [replaceCanvas]);
  const loadFanoutSample = useCallback(() => loadSample("the TMF fan-out sample", buildOrderFanoutProject), [loadSample]);
  const loadRevenueSample = useCallback(() => loadSample("the Revenue Cloud sample", buildRevenueCloudProject), [loadSample]);
  const loadCdcSample = useCallback(() => loadSample("the CDC sync sample", buildCdcSyncProject), [loadSample]);
  const loadFlowSample = useCallback(() => loadSample("the retry + fallback sample", buildRetryFallbackProject), [loadSample]);

  const newCanvas = useCallback(() => replaceCanvas("a blank canvas", newProject), [replaceCanvas]);

  const openProject = useCallback(async (id: string) => {
    const loaded = await loadSystemProject(id);
    if (!loaded) return;
    const { project: valid } = validateStoredProject(loaded);
    if (!valid) return;
    setProject(valid);
    setPast([]);
    setFuture([]);
    setSelNodeId(null);
    setSelEdgeId(null);
    setSaveState("saved");
  }, []);

  const removeProject = useCallback(async (id: string) => {
    await deleteSystemProject(id);
    const list = await listSystemProjects();
    setProjectList(list);
    if (project?.id === id) {
      const next = list.length > 0 ? await loadSystemProject(list[0].id) : null;
      setProject(next ? validateStoredProject(next).project ?? newProject() : newProject());
      setPast([]);
      setFuture([]);
      setSaveState("saved");
    }
  }, [project]);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmDeleteName = confirmDeleteId ? projectList.find((x) => x.id === confirmDeleteId)?.name ?? "this project" : null;

  const doExport = useCallback(() => {
    if (!project) return;
    const blob = new Blob([JSON.stringify(exportProject(project), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = projectFileName(project.name);
    a.click();
    URL.revokeObjectURL(url);
  }, [project]);

  const doImportFile = useCallback(async (file: File) => {
    setImportIssues(null);
    try {
      const raw = JSON.parse(await file.text());
      const { project: imported, issues } = importProject(raw);
      const valid = imported ? ensureDefaultInterfaces(imported) : null;
      if (!valid) {
        setImportIssues(issues.map((i) => `${i.path}: ${i.message}`));
        return;
      }
      // Fresh id on import: never clobber an existing saved project.
      const named = { ...valid, id: newId("proj"), name: `${valid.name} (imported)` };
      setProject(named);
      setPast([]);
      setFuture([]);
      setSelNodeId(null);
      setSelEdgeId(null);
      setSaveState("dirty");
    } catch {
      setImportIssues(["$: File is not valid JSON."]);
    }
  }, []);

  const filteredTemplates = useMemo(() => {
    const q = inventorySearch.trim().toLowerCase();
    if (!q) return SYSTEM_TEMPLATES;
    return SYSTEM_TEMPLATES.filter(
      (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)
    );
  }, [inventorySearch]);

  const selNode = project?.systems.find((s) => s.id === selNodeId) ?? null;
  const selEdge = project?.connections.find((c) => c.id === selEdgeId) ?? null;
  const selNote = project?.canvasNotes.find((n) => n.id === selNoteId) ?? project?.canvasImages.find((g) => g.id === selNoteId) ?? null;
  const selIsImage = selNote ? "blobId" in selNote : false;
  const selNames = project ? selIds.map((id) => project.systems.find((x) => x.id === id)?.name ?? project.canvasNotes.find((x) => x.id === id)?.text.slice(0, 24) ?? project.canvasImages.find((x) => x.id === id)?.name ?? id) : [];
  const touchingGroups = project?.groups.filter((g) => g.memberIds.some((m) => selIds.includes(m))) ?? [];
  const exactGroup = touchingGroups.length === 1 && touchingGroups[0].memberIds.length === selIds.length && selIds.every((m) => touchingGroups[0].memberIds.includes(m));
  const groupableCount = project ? selIds.filter((id) => project.systems.some((x) => x.id === id) || project.canvasNotes.some((x) => x.id === id) || project.canvasImages.some((x) => x.id === id)).length : 0;
  const canGroupSelection = groupableCount >= 2 && !exactGroup;
  const edgeName = (id: string) => project?.systems.find((s) => s.id === id)?.name ?? id;
  const testOp = testOpId ? project?.operations.find((o) => o.id === testOpId) ?? null : null;
  const testIface = testOp ? project?.interfaces.find((i) => i.id === testOp.interfaceId) ?? null : null;
  const testSystem = testIface ? project?.systems.find((s) => s.id === testIface.systemId) ?? null : null;
  const runEdge = runEdgeId ? project?.connections.find((c) => c.id === runEdgeId) ?? null : null;
  const openTodoCount = project?.todos.filter((t) => t.status !== "done").length ?? 0;

  const patchProjectTodo = useCallback((id: string, patch: Partial<CanvasTodo>) => {
    mutate((p) => ({
      ...p,
      todos: p.todos.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)),
    }));
  }, [mutate]);

  const addProjectTodo = useCallback((): string => {
    const id = newId("todo");
    const now = Date.now();
    mutate((p) => ({
      ...p,
      todos: [{ id, title: "", status: "open" as const, createdAt: now, updatedAt: now }, ...p.todos],
    }));
    return id;
  }, [mutate]);

  if (!project) {
    return (
      <div className="arch-card px-6 py-12 text-center text-sm text-ivory-600">
        Loading System Design workspace…
      </div>
    );
  }

  return (
    <div className={present ? "" : "space-y-0.5"}>
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
      {project && (
        <RenameProjectModal
          open={renameOpen}
          currentName={project.name}
          onClose={() => setRenameOpen(false)}
          onRename={(name) => {
            if (name !== project.name) mutate((p) => ({ ...p, name }));
          }}
        />
      )}
      {/* Project bar */}
      {!present && (
      <>
      <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={project.id}
            disabled={!projectList.some((p) => p.id !== project.id)}
            onChange={(e) => void openProject(e.target.value)}
            onDoubleClick={() => setRenameOpen(true)}
            aria-label="Open project"
            title={!projectList.some((p) => p.id !== project.id) ? "Project name - save to add it to your library" : "Open a saved project - double-click to rename"}
            className={!projectList.some((p) => p.id !== project.id) ? "max-w-[220px] appearance-none truncate bg-transparent px-2 py-1.5 text-xs font-semibold text-ivory-950 disabled:opacity-100" : "max-w-[220px] cursor-pointer truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 text-xs font-semibold text-ivory-950"}
          >
            {projectList.every((p) => p.id !== project.id) && (
              <option value={project.id}>{project.name} (unsaved)</option>
            )}
            {projectList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setRenameOpen(true)}
            title="Rename this project"
            aria-label="Rename this project"
            className="rounded p-1 text-ivory-400 transition-colors cursor-pointer hover:text-ivory-950"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </button>
          <span
            title={saveState === "saved" ? "All changes saved" : saveState === "dirty" ? "Unsaved changes" : saveState === "saving" ? "Saving…" : "Save failed"}
            aria-label={saveState === "saved" ? "Saved" : "Unsaved changes"}
            className={`h-2 w-2 rounded-full ${saveState === "saved" ? "bg-green-600" : saveState === "error" ? "bg-red-600" : saveState === "saving" ? "bg-amber-500 animate-pulse" : "bg-amber-500"}`}
          />
          <Button size="sm" onClick={() => void save()} disabled={saveState === "saving"} style={{ fontSize: 11 }}>
            {saveState === "saving" ? "Saving…" : (<span className="inline-flex items-center gap-1.5"><Save size={12} aria-hidden="true" /> Save</span>)}
          </Button>
          <Button size="sm" variant="secondary" onClick={newCanvas} title="Start a blank canvas" style={{ fontSize: 11 }}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={12} aria-hidden="true" />
              New
            </span>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setTplOpen(true)} title="Browse starter canvases - demo architecture and runnable samples" style={{ fontSize: 11 }}>
            <span className="inline-flex items-center gap-1.5">
              <LayoutTemplate size={12} aria-hidden="true" />
              Templates
            </span>
          </Button>
          <Button size="sm" variant="secondary" onClick={doExport} title="Download the project as portable JSON (no secrets exist in this slice)" style={{ fontSize: 11 }}>
            <span className="inline-flex items-center gap-1.5">
              <Upload size={12} aria-hidden="true" />
              Export
            </span>
          </Button>
          <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} title="Import a project file - validated before anything changes" style={{ fontSize: 11 }}>
            <span className="inline-flex items-center gap-1.5">
              <Download size={12} aria-hidden="true" />
              Import
            </span>
          </Button>
          <DeepLinkButton path="/system" param="project" value={projectList.some((p) => p.id === project.id) ? project.id : null} />
          <ShareButton kind="system-project" name={project.name} getPayload={() => exportProject(project)} />
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label="Import project file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void doImportFile(f);
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            style={{ fontSize: 11 }}
            onClick={() => setCredOpen(true)}
            title="Session credentials ($env.NAME) - one-time setup, kept for this tab only"
          >
            <span className="inline-flex items-center gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <rect x="4" y="10" width="16" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
              Credentials
              {Object.keys(vault).length > 0 && (
                <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-bronze-500 px-1 text-[9px] font-bold text-white">
                  {Object.keys(vault).length}
                </span>
              )}
            </span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            style={{ fontSize: 11 }}
            onClick={() => setNotesOpen(true)}
            title="Project design notes and TODOs (markdown, autosaved with the project)"
          >
            <span className="inline-flex items-center gap-1.5">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z" />
                <path d="m13.5 6.5 3 3" />
              </svg>
              Notes
              {openTodoCount > 0 ? (
                <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                  {openTodoCount}
                </span>
              ) : project.notes.trim() ? (
                <span className="h-2 w-2 rounded-full bg-bronze-500" aria-hidden="true" />
              ) : null}
            </span>
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => setConfirmDeleteId(project.id)}
            title="Delete this saved project"
            style={{ fontSize: 11 }}>
            <span className="inline-flex items-center gap-1.5">
              <Trash2 size={12} aria-hidden="true" />
              Delete
            </span>
          </Button>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={undo} disabled={past.length === 0} title="Undo (Ctrl+Z)" style={{ fontSize: 11 }}>
            <span className="inline-flex items-center gap-1.5">
              <Undo2 size={12} aria-hidden="true" />
              Undo
            </span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={redo}
            disabled={future.length === 0}
            title="Redo (Ctrl+Shift+Z)"
            style={{ fontSize: 11 }}
          >
            <span className="inline-flex items-center gap-1.5">
              <Redo2 size={12} aria-hidden="true" />
              Redo
            </span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            style={{ fontSize: 11 }}
            onClick={() => setShowList((v) => !v)}
            aria-pressed={showList}
            title="Toggle an accessible list view of systems and connections"
          >
            {showList ? (<span className="inline-flex items-center gap-1.5"><Expand size={12} aria-hidden="true" /> Canvas</span>) : (<span className="inline-flex items-center gap-1.5"><List size={12} aria-hidden="true" /> List</span>)}
          </Button>
        </div>
        {saveState === "error" && saveError && (
          <p className="mt-1.5 text-xs text-red-700" role="alert">{saveError}</p>
        )}
        {importIssues && (
          <div className="mt-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-2" role="alert">
            <p className="text-xs font-semibold text-red-700">Import blocked - nothing changed:</p>
            <ul className="mt-1 space-y-0.5">
              {importIssues.map((m) => (
                <li key={m} className="font-mono text-[11px] text-red-700">{m}</li>
              ))}
            </ul>
            <button type="button" onClick={() => setImportIssues(null)} className="mt-1 text-[11px] text-ivory-600 underline cursor-pointer">
              Dismiss
            </button>
          </div>
        )}
      </div>

            {/* Secondary navigation */}
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="System Design sections">
        {SUB_TABS.map((t) => {
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSubTab(t.id)}
              className={
                active
                  ? "inline-flex items-center gap-1.5 rounded-lg border border-ivory-950 bg-ivory-950 px-3 py-1.5 text-[12px] font-semibold text-ivory-100"
                  : "inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-1.5 text-[12px] font-medium text-ivory-600 hover:border-bronze-500 hover:text-ivory-950 cursor-pointer"
              }
            >
              <t.icon size={12} aria-hidden="true" />
              {t.label}
            </button>
          );
        })}
        {activeEnv?.isProduction && (
          <span title="Runs against this environment confirm first" className="rounded-lg border border-red-700 bg-red-700/10 px-2 py-1 font-mono text-[10px] font-bold text-red-700">
            PROD · {activeEnv.name}
          </span>
        )}
      </div>
      {pendingBindOp && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-bronze-500/50 bg-bronze-500/5 px-3 py-1.5 text-[11px] text-ivory-800" role="status">
          <span>
            Binding <strong className="font-mono">{pendingBindOp.method} {pendingBindOp.name}</strong> - click a connection on the canvas and it attaches to the matching end automatically.
          </span>
          <button type="button" onClick={() => setPendingBindOpId(null)} className="ml-auto font-semibold text-ivory-600 underline hover:text-ivory-950 cursor-pointer">
            Cancel
          </button>
        </div>
      )}
      </>
      )}

      {/* Workbench */}
      {subTab === "canvas" ? (
      <div className="flex gap-0.5" style={present ? { height: "calc(100vh - 12px)" } : { height: "calc(100vh - 200px)", minHeight: 480 }}>
        {inventoryOpen ? (
          <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]" aria-label="Systems inventory">
            <div className="flex items-center gap-2 border-b border-[var(--color-line-soft)] px-3.5 py-2">
              <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-ivory-950">Systems Inventory</h2>
              <button
                type="button"
                onClick={() => setInventoryOpen(false)}
                aria-label="Collapse inventory"
                title="Collapse inventory"
                className="shrink-0 rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="m14 6-6 6 6 6" />
                </svg>
              </button>
            </div>
            <div className="border-b border-[var(--color-line-soft)] px-3.5 py-2">
              <Input
                placeholder="Search systems…"
                value={inventorySearch}
                onChange={(e) => setInventorySearch(e.target.value)}
                aria-label="Search systems inventory"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
              {filteredTemplates.length === 0 && (
                <p className="px-1 py-3 text-xs text-ivory-600">No systems match.</p>
              )}
              <ul className="space-y-1.5">
                {filteredTemplates.map((t) => (
                  <li
                    key={t.systemType}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("application/sd-system", t.systemType);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    className="flex cursor-grab items-center gap-2.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] p-2.5 hover:border-bronze-500 transition-colors active:cursor-grabbing"
                    title="Drag onto the canvas, or use Add"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bronze-100 text-bronze-700">
                      <SystemGlyph iconKey={t.iconKey} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold text-ivory-950">{t.name}</span>
                      <span className="block truncate text-[10px] text-ivory-600">{t.description}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => addSystem(t)}
                      aria-label={`Add ${t.name} to canvas`}
                      title={`Add ${t.name} to canvas`}
                      className="shrink-0 rounded-lg bg-ivory-950 px-2 py-1 text-[11px] font-semibold text-ivory-100 hover:bg-bronze-600 transition-colors cursor-pointer"
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        ) : (
          <div className="flex w-10 shrink-0 flex-col items-center overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] py-2" aria-label="Inventory collapsed">
            <button
              type="button"
              onClick={() => setInventoryOpen(true)}
              aria-label="Expand inventory"
              title="Expand inventory"
              className="shrink-0 rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="m10 6 6 6-6 6" />
              </svg>
            </button>
            <div className="h-px w-6 shrink-0 bg-[var(--color-line-soft)]" aria-hidden="true" />
            <div className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto scroll-smooth px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {SYSTEM_TEMPLATES.map((t) => (
                <button
                  key={t.systemType}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/sd-system", t.systemType);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => addSystem(t)}
                  aria-label={`Add ${t.name} to canvas`}
                  title={`${t.name} - click to add, drag onto canvas`}
                  className="shrink-0 rounded-lg p-1.5 text-bronze-700 hover:bg-bronze-100 transition-colors cursor-grab active:cursor-grabbing"
                >
                  <SystemGlyph iconKey={t.iconKey} />
                </button>
              ))}
            </div>
          </div>
          )}

        <div className="min-w-0 min-h-0 flex-1">
          <ReactFlowProvider>
            {showList ? (
              <div className="grid h-full min-h-0 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-2">
                <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-ivory-700">
                    Systems ({project.systems.length})
                  </h3>
                  {project.systems.length === 0 ? (
                    <p className="mt-2 text-xs text-ivory-600">No systems yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {project.systems.map((s) => (
                        <li key={s.id} className="flex items-center gap-2 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-2.5 py-1.5">
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ivory-950">
                            {s.name} <span className="font-mono font-normal text-ivory-500">· {s.systemType}</span>
                          </span>
                          <Button size="sm" variant="ghost" onClick={() => handleSelect(s.id, null)}>
                            Select
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-ivory-700">
                    Connections ({project.connections.length})
                  </h3>
                  {project.connections.length === 0 ? (
                    <p className="mt-2 text-xs text-ivory-600">No connections yet - drag between nodes on the canvas.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {project.connections.map((c) => (
                        <li key={c.id} className="flex items-center gap-2 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-2.5 py-1.5">
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ivory-800">
                            {edgeName(c.sourceId)} → {edgeName(c.targetId)}
                            {c.label ? <span className="text-ivory-600"> · {c.label}</span> : null}
                          </span>
                          <Badge variant={connectionReadiness(c, project) === "ready" ? "success" : connectionReadiness(c, project) === "partial" ? "warning" : "default"}>
                            {connectionReadiness(c, project)}
                          </Badge>
                          <Button size="sm" variant="ghost" onClick={() => handleSelect(null, c.id)}>
                            Select
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <DesignerCanvas
                project={project}
                onMoveSystems={moveSystems}
                onDragStartNode={() => pushHistory(project)}
                onConnectSystems={connectSystems}
                onSelect={handleSelect}
                selEdgeId={selEdgeId}
                onDropTemplate={(t, at) => addSystem(t, at)}
                emptyAction={() => setTplOpen(true)}
                present={present}
                onTogglePresent={() => setPresent((v) => !v)}
                runVis={runVis}
                miniMapOn={miniMapOn}
                onToggleMiniMap={() => setMiniMapOn((v) => !v)}
                onOpenRisks={() => setRisksOpen(true)}
                onOpenViews={() => setViewsOpen(true)}
                hiddenIds={hiddenIds}
                editingNoteId={editingNoteId}
                selNoteId={selNoteId}
                selIds={selIds}
                onBeginNoteEdit={beginNoteEdit}
                onCommitNoteText={commitNoteText}
                onCancelNoteEdit={cancelNoteEdit}
                onWriteAt={writeNoteAt}
                appendTargetId={appendTargetId}
                onAppendChar={appendNoteChar}
                onPasteImage={pasteImageAt}
                onResizeImage={resizeCanvasImage}
                onToggleSelect={toggleMultiSelect}
                onMarqueeSelect={handleMarqueeSelect}
                canGroup={canGroupSelection}
                canUngroup={touchingGroups.length > 0}
                onGroup={() => { groupSelection(); }}
                onUngroup={() => { ungroupSelection(); }}
                canDelete={Boolean(selNodeId || selEdgeId || selNoteId || selIds.length > 0)}
                onDeleteSelection={deleteSelection}
                onRebalance={rebalanceCanvas}
              />
            )}
          </ReactFlowProvider>
          </div>

        {inspectorOpen ? (
        <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)]" aria-label="Inspector">
          <div className="flex items-center gap-2 border-b border-[var(--color-line-soft)] px-3.5 py-2">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-bold text-ivory-950">Inspector</h2>
              <p className="truncate font-mono text-[10px] text-ivory-600">
                {selNode ? selNode.name : selEdge ? `edge · ${selEdge.id.slice(-6)}` : `${project.systems.length} systems · ${project.connections.length} links`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setInspectorOpen(false)}
              aria-label="Collapse inspector"
              title="Collapse inspector - canvas goes full width"
              className="shrink-0 rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="m10 6 6 6-6 6" />
              </svg>
            </button>
          </div>
          {(() => {
            const conns = project.connections;
            const ready = conns.filter((c) => connectionReadiness(c, project) === "ready").length;
            return (
              <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--color-line-soft)] px-3.5 py-1.5 font-mono text-[10px] text-ivory-600" aria-label="Link status">
                {conns.length === 0 ? (
                  <span>No links yet</span>
                ) : (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span>{ready} ready</span>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                    <span>{conns.length - ready} draft</span>
                  </>
                )}
              </div>
            );
          })()}
          <div className="min-h-0 flex-1 overflow-y-auto p-3.5" ref={inspectorBodyRef}>
            {selIds.length > 1 ? (
              <div>
                <p className="text-xs font-bold text-ivory-950">{selIds.length} selected</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ivory-600">{selNames.slice(0, 6).join(" · ")}{selNames.length > 6 ? ` +${selNames.length - 6} more` : ""}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {!exactGroup && (
                    <Button size="sm" onClick={() => { groupSelection(); }} title="Group the selection (Ctrl+G)">
                      <span className="inline-flex items-center gap-1.5"><Group size={12} aria-hidden="true" /> Group</span>
                    </Button>
                  )}
                  {touchingGroups.length > 0 && (
                    <Button size="sm" variant="secondary" onClick={() => { ungroupSelection(); }} title="Ungroup (Ctrl+Shift+G)">
                      <span className="inline-flex items-center gap-1.5"><Ungroup size={12} aria-hidden="true" /> Ungroup</span>
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => handleSelect(null, null)}>Clear</Button>
                </div>
                <p className="mt-2 text-[10px] text-ivory-500">Shift+click adds · drag a box in Select mode · Del removes all</p>
              </div>
            ) : selNote ? (
              <div>
                <p className="text-xs font-bold text-ivory-950">{selIsImage ? "Canvas image" : "Canvas note"}</p>
                {!selIsImage && (
                  <textarea
                    key={selNote.id}
                    defaultValue={(selNote as SystemCanvasNote).text}
                    onBlur={(e) => commitNoteText(selNote.id, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") { e.currentTarget.value = (selNote as SystemCanvasNote).text; e.currentTarget.blur(); } }}
                    rows={5}
                    aria-label="Canvas note text"
                    className="mt-2 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-ivory-950 focus:border-bronze-500 focus:outline-none"
                  />
                )}
                {selIsImage && (
                  <p className="mt-1 text-[11px] text-ivory-600">{(selNote as SystemCanvasImage).name} · {(selNote as SystemCanvasImage).width}×{(selNote as SystemCanvasImage).height}px</p>
                )}
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => deleteMark(selNote.id)}>Delete</Button>
                </div>
                <p className="mt-2 text-[10px] text-ivory-500">Double-click the canvas note to edit inline · Del removes</p>
              </div>
            ) : selNode ? (
              <NodeInspector
                node={selNode}
                project={project}                onPatch={(patch) => mutate((p) => ({
                  ...p,
                  systems: p.systems.map((s) => (s.id === selNode.id ? { ...s, ...patch } : s)),
                }))}
                onMutateProject={(fn) => mutate(fn)}
                onTestOperation={(opId) => openTestOp(opId)}
                onConnectTo={(targetId) => connectSystems(selNode.id, targetId)}
                onDuplicate={() => {
                  mutate((p) => {
                    const sysId = newId("sys");
                    // Interfaces (and their operations) belong to the new
                    // copy under fresh ids - edge bindings stay with the original.
                    const ifaceMap = new Map<string, string>();
                    const interfaces = [...p.interfaces];
                    for (const f of p.interfaces.filter((f) => f.systemId === selNode.id)) {
                      const nid = newId("iface");
                      ifaceMap.set(f.id, nid);
                      interfaces.push({ ...f, id: nid, systemId: sysId });
                    }
                    const operations = [...p.operations];
                    for (const o of p.operations.filter((o) => ifaceMap.has(o.interfaceId))) {
                      const ni = ifaceMap.get(o.interfaceId);
                      if (!ni) continue;
                      operations.push({ ...o, id: newId("op"), interfaceId: ni });
                    }
                    return {
                      ...p,
                      systems: [
                        ...p.systems,
                        { ...selNode, id: sysId, name: `${selNode.name} copy`, position: { x: selNode.position.x + 120, y: selNode.position.y + 80 } },
                      ],
                      interfaces,
                      operations,
                    };
                  });
                }}
                onDelete={() => {
                  mutate((p) =>
                    pruneCanvasGroups({
                      ...p,
                      systems: p.systems.filter((s) => s.id !== selNode.id),
                      connections: p.connections.filter((c) => c.sourceId !== selNode.id && c.targetId !== selNode.id),
                    })
                  );
                  setSelIds([]);
                  setSelNodeId(null);
                }}
                onSelectEdge={(edgeId) => handleSelect(null, edgeId)}
              />
            ) : selEdge ? (
              <EdgeInspector
                edge={selEdge}
                project={project}
                sourceName={edgeName(selEdge.sourceId)}
                targetName={edgeName(selEdge.targetId)}
              onPatch={(patch) => mutate((p) => ({
                ...p,
                connections: p.connections.map((c) => (c.id === selEdge.id ? { ...c, ...patch } : c)),
              }))}
              onRun={() => openEdgeRun(selEdge.id)}
              onRunChain={() => openChainRun(selEdge.id)}
              runReady={connectionReadiness(selEdge, project) === "ready"}
              onDelete={() => {
                mutate((p) => ({ ...p, connections: p.connections.filter((c) => c.id !== selEdge.id) }));
                setSelEdgeId(null);
              }}
            />
            ) : (
              <div>
                <p className="text-xs leading-relaxed text-ivory-700">
                  Select a system or connection to edit it. Links turn green once both ends bind
                  operations - then they run end-to-end or as full chains.
                </p>
                <div className="mt-3 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-2.5 font-mono text-[11px] text-ivory-700">
                  {project.systems.length} systems · {project.connections.length} connections ·{" "}
                  {project.connections.filter((c) => c.label.trim()).length} labeled ·{" "}
                  {project.connections.filter((c) => connectionReadiness(c, project) === "ready").length} ready
                </div>
                {project.connections.length > 0 && (
                  <div className="mt-2.5">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                      Links - click to inspect and run
                    </p>
                    <ul className="space-y-1">
                      {project.connections.map((c) => {
                        const ready = connectionReadiness(c, project) === "ready";
                        const sName = project.systems.find((s) => s.id === c.sourceId)?.name ?? "?";
                        const tName = project.systems.find((s) => s.id === c.targetId)?.name ?? "?";
                        return (
                          <li key={c.id}>
                            <button
                              type="button"
                              onClick={() => handleSelect(null, c.id)}
                              title={ready ? "Inspect and run this link" : "Inspect - bind both ends to run"}
                              className="flex w-full items-center gap-1.5 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-2 py-1.5 text-left hover:border-bronze-500 transition-colors cursor-pointer"
                            >
                              <span
                                aria-hidden="true"
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${ready ? "bg-[#32815B]" : "bg-amber-500"}`}
                              />
                              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-ivory-950">
                                {c.label || "Unlabeled link"}
                                <span className="font-mono font-normal text-ivory-500"> · {sName} → {tName}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
                <div className="mt-2.5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                      Environment
                    </p>
                    <button
                      type="button"
                      onClick={() => mutate((p) => {
                        const env = { id: newId("env"), name: `Env ${p.environments.length + 1}`, baseUrl: "", baseUrlOverrides: {} };
                        return { ...p, environments: [...p.environments, env], activeEnvironmentId: p.activeEnvironmentId ?? env.id };
                      })}
                      className="text-[11px] font-semibold text-bronze-600 hover:text-bronze-700 cursor-pointer"
                    >
                      + Environment
                    </button>
                  </div>
                  {project.environments.length === 0 ? (
                    <p className="text-[11px] text-ivory-500">No environments - runs use each system URL as stored on its node.</p>
                  ) : (
                    <div className="space-y-1.5">
                      <select
                        value={project.activeEnvironmentId ?? ""}
                        onChange={(e) => mutate((p) => ({ ...p, activeEnvironmentId: e.target.value || null }))}
                        aria-label="Active environment"
                        title="Active environment - runs resolve every system URL through this"
                        className="w-full cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 text-xs font-semibold text-ivory-950"
                      >
                        <option value="">No active environment</option>
                        {project.environments.map((e) => (
                          <option key={e.id} value={e.id}>{e.name}</option>
                        ))}
                      </select>
                      {project.environments.map((e) => (
                        <div key={e.id} className="space-y-1">
                          <div className="flex items-center gap-1">
                          <input
                            value={e.name}
                            onChange={(ev) => mutate((p) => ({
                              ...p,
                              environments: p.environments.map((x) => (x.id === e.id ? { ...x, name: ev.target.value } : x)),
                            }))}
                            spellCheck={false}
                            aria-label="Environment name"
                            className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 text-[11px] font-semibold text-ivory-950 focus:border-bronze-500 focus:outline-none"
                          />
                          <input
                            value={e.baseUrl}
                            onChange={(ev) => mutate((p) => ({
                              ...p,
                              environments: p.environments.map((x) => (x.id === e.id ? { ...x, baseUrl: ev.target.value } : x)),
                            }))}
                            placeholder="https://…"
                            spellCheck={false}
                            aria-label="Environment base URL"
                            className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 font-mono text-[10px] text-ivory-800 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => mutate((p) => ({
                              ...p,
                              environments: p.environments.filter((x) => x.id !== e.id),
                              activeEnvironmentId: p.activeEnvironmentId === e.id ? null : p.activeEnvironmentId,
                            }))}
                            aria-label={`Delete environment ${e.name}`}
                            title="Delete environment"
                            className="rounded p-1 text-ivory-400 hover:text-red-700 hover:bg-red-500/10 transition-colors cursor-pointer"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                              <path d="M6 6l12 12M18 6 6 18" />
                            </svg>
                          </button>
                          </div>
                          {project.systems.length > 0 && (
                            <details className="rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-canvas)] px-2 py-1">
                              <summary
                                className="cursor-pointer text-[10px] font-semibold text-ivory-600 hover:text-ivory-950"
                                title="Per-system URLs for this environment win over each system's own URL - empty falls through to the system URL, then the environment fallback"
                              >
                                Per-system URLs · {Object.keys(e.baseUrlOverrides ?? {}).length} set
                              </summary>
                              <div className="mt-1 space-y-1 pb-1">
                                {project.systems.map((sys) => (
                                  <label key={sys.id} className="block text-[10px] font-semibold text-ivory-600">
                                    {sys.name}
                                    <input
                                      value={(e.baseUrlOverrides ?? {})[sys.id] ?? ""}
                                      onChange={(ev) => mutate((pr) => ({
                                        ...pr,
                                        environments: pr.environments.map((x) => {
                                          if (x.id !== e.id) return x;
                                          const next = { ...(x.baseUrlOverrides ?? {}) };
                                          if (ev.target.value.trim()) next[sys.id] = ev.target.value;
                                          else delete next[sys.id];
                                          return { ...x, baseUrlOverrides: next };
                                        }),
                                      }))}
                                      placeholder={sys.baseUrl?.trim() || e.baseUrl.trim() || "https://…"}
                                      spellCheck={false}
                                      aria-label={`${sys.name} URL in ${e.name}`}
                                      className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 font-mono text-[10px] text-ivory-800 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                                    />
                                  </label>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      ))}
                      <p className="text-[10px] text-ivory-500">Base URLs only - secrets are referenced at runtime, never stored. Switching environments retargets every system at once.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>
        ) : (
          <div className="flex w-10 shrink-0 flex-col items-center gap-1 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] py-2" aria-label="Inspector collapsed">
            <button
              type="button"
              onClick={() => setInspectorOpen(true)}
              aria-label="Expand inspector"
              title="Expand inspector"
              className="shrink-0 rounded-md p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="m14 6-6 6 6 6" />
              </svg>
            </button>
            <div className="h-px w-6 shrink-0 bg-[var(--color-line-soft)]" aria-hidden="true" />
            <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto scroll-smooth px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {INSPECTOR_STRIP.map((s) => {
                const Icon = INSPECTOR_ICONS[s.id];
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => jumpInspector(s.id)}
                    aria-label={s.label}
                    title={s.title}
                    className="shrink-0 rounded-lg p-1.5 text-ivory-500 hover:text-ivory-950 hover:bg-ivory-300 transition-colors cursor-pointer"
                  >
                    <Icon size={14} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
          )}
      </div>
      ) : (
        project && (
        <div className="flex gap-0.5" style={present ? { height: "calc(100vh - 12px)" } : { height: "calc(100vh - 200px)", minHeight: 480 }}>
          {subTab === "flow" && (
            <FlowsTab project={project} mutate={mutate} onRunFlow={runFlow} />
          )}
          {subTab === "api" && (
            <ApiCatalogTab project={project} mutate={mutate} onTest={openTestOp} onLocate={locateSystem} onBind={bindOperation} />
          )}
          {subTab === "transform" && (
            <TransformsTab project={project} mutate={mutate} />
          )}
          {subTab === "scenarios" && (
            <ScenariosTab project={project} mutate={mutate} onRunScenario={runScenario} />
          )}
          {subTab === "runs" && (
            <RunsTab project={project} mutate={mutate} />
          )}
          {subTab === "settings" && (
            <SettingsTab project={project} mutate={mutate} />
          )}
        </div>
        )
      )}

      {testOp && testIface && testSystem && project && (
        <TestRunner
          operation={testOp}
          iface={testIface}
          system={testSystem}
          environments={project.environments}
          activeEnvironmentId={project.activeEnvironmentId}
          vault={vault}
          onClose={() => setTestOpId(null)}
        />
      )}

      {risksOpen && project && (
        <RisksDialog
          project={project}
          onClose={() => setRisksOpen(false)}
          onSelectNode={(id) => handleSelect(id, null)}
          onAddScenario={(draft) =>
            mutate((p) => ({
              ...p,
              scenarios: [
                ...p.scenarios,
                {
                  id: newId("scn"),
                  name: draft.name,
                  flowId: draft.flowId && p.flows.some((f) => f.id === draft.flowId) ? draft.flowId : null,
                  environmentId: null,
                  inputPayload: draft.inputPayload,
                  mockOverrides: draft.mockOverrides,
                  expectStatus: draft.expectStatus,
                  validates: draft.validates,
                },
              ],
            }))
          }
        />
      )}

      {viewsOpen && project && (
        <ViewsDialog
          project={project}
          view={c4View}
          onViewChange={setC4View}
          onMutate={mutate}
          onClose={() => setViewsOpen(false)}
        />
      )}

      {runEdge && project && (
        <RunEdgeDialog
          edge={runEdge}
          project={project}
          environments={project.environments}
          activeEnvironmentId={project.activeEnvironmentId}
          vault={vault}
          onClose={() => setRunEdgeId(null)}
          onSaveSample={(opId, body) => mutate((p) => ({
            ...p,
            operations: p.operations.map((o) => (o.id === opId ? { ...o, sampleBody: body } : o)),
          }))}
        />
      )}

      {runChainEdgeId && project && (
        <ChainRunDialog
          onSaveScope={(scope) => mutate((p) => ({ ...p, runScope: scope }))}
          startEdgeId={runChainEdgeId}
          scenarioId={runChainScenarioId}
          expectStatus={runChainScenarioId ? (project.scenarios.find((s) => s.id === runChainScenarioId)?.expectStatus ?? null) : null}
          project={project}
          environments={project.environments}
          activeEnvironmentId={project.activeEnvironmentId}
          vault={vault}
          onClose={() => {
            setRunChainEdgeId(null);
            setRunChainScenarioId(null);
            setRunVis({});
          }}
          onVisUpdate={(edgeId, status) => {
            if (status === null) {
              setRunVis((prev) => {
                const next = { ...prev };
                delete next[edgeId];
                return next;
              });
              return;
            }
            setRunVis((prev) => ({ ...prev, [edgeId]: status }));
          }}
        />
      )}

      {pendingAction && (
        <ConfirmDialog
          title={pendingAction.title}
          message={pendingAction.message}
          confirmLabel={pendingAction.confirmLabel}
          tone={pendingAction.danger ? "danger" : "default"}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => {
            const run = pendingAction.run;
            setPendingAction(null);
            run();
          }}
        />
      )}
      {confirmDeleteId && (
        <div className="modal-overlay" onClick={() => setConfirmDeleteId(null)}>
          <div className="modal-card max-w-sm flex flex-col" role="dialog" aria-modal="true" aria-label="Delete project" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 pt-5">
              <p className="text-[10px] font-semibold uppercase tracking-[2px] text-[var(--color-accent-dark)]">Delete project</p>
              <p className="mt-1 text-sm font-bold text-ivory-950">Delete {confirmDeleteName}?</p>
              <p className="mt-1 text-xs leading-relaxed text-ivory-600">The canvas, runs, and credentials refs leave this browser. This cannot be undone.</p>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4">
              <Button size="sm" variant="secondary" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
              <Button size="sm" variant="danger" onClick={() => { if (confirmDeleteId) void removeProject(confirmDeleteId); setConfirmDeleteId(null); }}>Delete</Button>
            </div>
          </div>
        </div>
      )}

      {project && (
        <TemplatesModal
          open={tplOpen}
          onClose={() => setTplOpen(false)}
          onLoadDemo={loadDemo}
          onLoadGroq={loadGroqSample}
          onLoadTmf={loadTmfSample}
          onLoadFanout={loadFanoutSample}
          onLoadRevenue={loadRevenueSample}
          onLoadCdc={loadCdcSample}
      onLoadFlow={loadFlowSample}
        />
      )}

      {project && (
        <CredentialsModal
          open={credOpen}
          onClose={() => setCredOpen(false)}
          vault={vault}
          onSet={(name, value) => setVault((v) => ({ ...v, [name]: value }))}
          onRemove={(name) =>
            setVault((v) => {
              const next = { ...v };
              delete next[name];
              return next;
            })
          }
          onClear={() => setVault({})}
        />
      )}

      {project && (
        <ProjectNotesModal
          open={notesOpen}
          onClose={() => setNotesOpen(false)}
          projectName={project.name}
          notes={systemNotesToNote(project)}
          todos={project.todos}
          onNotes={(b) => mutate((p) => ({ ...p, ...noteToSystemNotes(b) }))}
          onAddTodo={addProjectTodo}
          onPatchTodo={patchProjectTodo}
          onDeleteTodo={(id) => mutate((p) => ({ ...p, todos: p.todos.filter((t) => t.id !== id) }))}
        />
      )}
    </div>
  );
}

function NodeInspector({
  node,
  project,
  onPatch,
  onMutateProject,
  onTestOperation,
  onConnectTo,
  onDuplicate,
  onDelete,
  onSelectEdge,
}: {
  node: SystemNode;
  project: SystemProject;
  onPatch: (patch: Partial<SystemNode>) => void;
  onMutateProject: (fn: (p: SystemProject) => SystemProject) => void;
  onTestOperation: (opId: string) => void;
  onConnectTo: (targetId: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSelectEdge: (edgeId: string) => void;
}) {
  const groups = operationsForSystem(project, node.id);
  const opCount = groups.reduce((n, g) => n + g.ops.length, 0);
  const [connectTarget, setConnectTarget] = useState<string>("");
  const connectables = project.systems.filter((s) => s.id !== node.id);
  return (
    <div className="space-y-2.5">
      <div data-insp="identity" className="flex items-center gap-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bronze-100 text-bronze-700">
          <SystemGlyph iconKey={node.iconKey} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-ivory-950">{node.name}</p>
          <p className="font-mono text-[10px] text-ivory-500">{node.id}</p>
        </div>
      </div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
        Name
        <input
          value={node.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          spellCheck={false}
          className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 text-xs font-medium normal-case tracking-normal text-ivory-950 focus:border-bronze-500 focus:outline-none"
        />
      </label>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
        Type
        <select
          value={node.systemType}
          onChange={(e) => {
            const t = SYSTEM_TEMPLATES.find((x) => x.systemType === e.target.value);
            onPatch({ systemType: e.target.value as SystemNode["systemType"], iconKey: t?.iconKey ?? "plus" });
          }}
          className="mt-0.5 w-full cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 text-xs font-medium normal-case tracking-normal text-ivory-950"
        >
          {SYSTEM_TEMPLATES.map((t) => (
            <option key={t.systemType} value={t.systemType}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
        Description
        <textarea
          value={node.description}
          onChange={(e) => onPatch({ description: e.target.value })}
          rows={3}
          spellCheck={false}
          className="mt-0.5 w-full resize-y rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-2 text-xs leading-relaxed text-ivory-950 focus:border-bronze-500 focus:outline-none"
        />
      </label>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
        Base URL
        <input
          value={node.baseUrl ?? ""}
          onChange={(e) => onPatch({ baseUrl: e.target.value })}
          placeholder="https://… (falls back to environment)"
          spellCheck={false}
          aria-label="System base URL"
          className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 font-mono text-[11px] normal-case tracking-normal text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
        />
      </label>
      <div className="flex gap-1.5">
        <Button size="sm" variant="secondary" onClick={onDuplicate} className="flex-1">
          Duplicate
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} className="flex-1">
          Delete
        </Button>
      </div>
      <div data-insp="connect">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ivory-600" title="Or drag from the bronze dot on the node's right edge to another node">
          Connect to…
        </p>
        {connectables.length === 0 ? (
          <p className="text-[11px] text-ivory-500">Add another system first.</p>
        ) : (
          <div className="flex gap-1.5">
            <select
              value={connectTarget}
              onChange={(e) => setConnectTarget(e.target.value)}
              aria-label="Target system to connect"
              className="min-w-0 flex-1 cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 text-xs font-medium text-ivory-950"
            >
              <option value="">Pick a system…</option>
              {connectables.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={!connectTarget}
              onClick={() => {
                if (connectTarget) {
                  onConnectTo(connectTarget);
                  setConnectTarget("");
                }
              }}
            >
              Link
            </Button>
          </div>
        )}
      </div>
      <div data-insp="operations">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
            Interfaces · {groups.length} · {opCount} ops
          </p>
          <button
            type="button"
            onClick={() => onMutateProject((p) => ({
              ...p,
              interfaces: [...p.interfaces, {
                id: newId("iface"), systemId: node.id, name: "REST API",
                protocol: "REST" as const, basePath: "",
              }],
            }))}
            className="text-[11px] font-semibold text-bronze-600 hover:text-bronze-700 cursor-pointer"
          >
            + Interface
          </button>
        </div>
        {groups.length === 0 && (
          <p className="text-[11px] text-ivory-500">No interfaces yet - add one to expose operations for edge binding.</p>
        )}
        <div className="space-y-2">
          {groups.map(({ iface, ops }) => (
            <div key={iface.id} className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-2">
              <div className="flex items-center gap-1.5">
                <input
                  value={iface.name}
                  onChange={(e) => onMutateProject((p) => ({
                    ...p,
                    interfaces: p.interfaces.map((f) => (f.id === iface.id ? { ...f, name: e.target.value } : f)),
                  }))}
                  spellCheck={false}
                  aria-label="Interface name"
                  className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-xs font-bold text-ivory-950 hover:border-[var(--color-line)] focus:border-bronze-500 focus:outline-none"
                />
                <select
                  value={iface.protocol}
                  onChange={(e) => onMutateProject((p) => ({
                    ...p,
                    interfaces: p.interfaces.map((f) => (f.id === iface.id ? { ...f, protocol: e.target.value as SystemInterface["protocol"] } : f)),
                  }))}
                  aria-label="Interface protocol"
                  className="cursor-pointer rounded-md border border-[var(--color-line)] bg-white px-1 py-1 font-mono text-[10px] text-ivory-800"
                >
                  {(["REST", "GraphQL", "SOAP", "Events", "Other"] as const).map((pr) => (
                    <option key={pr} value={pr}>{pr}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onMutateProject((p) => ({
                    ...p,
                    interfaces: p.interfaces.filter((f) => f.id !== iface.id),
                    operations: p.operations.filter((o) => o.interfaceId !== iface.id),
                  }))}
                  aria-label={`Delete interface ${iface.name}`}
                  title="Delete interface and its operations (edge bindings to them read as unbound)"
                  className="rounded p-1 text-ivory-400 hover:text-red-700 hover:bg-red-500/10 transition-colors cursor-pointer"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13h10l1-13" />
                  </svg>
                </button>
              </div>
              <input
                value={iface.basePath}
                onChange={(e) => onMutateProject((p) => ({
                  ...p,
                  interfaces: p.interfaces.map((f) => (f.id === iface.id ? { ...f, basePath: e.target.value } : f)),
                }))}
                placeholder="Base path, e.g. /services/data/v66.0"
                spellCheck={false}
                aria-label="Interface base path"
                className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[10px] text-ivory-800 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
              />
              <ul className="mt-1.5 space-y-1">
                {ops.map((op) => (
                  <li key={op.id} className="rounded-md border border-transparent">
                    <div className="flex items-center gap-1">
                    <select
                      value={op.method}
                      onChange={(e) => onMutateProject((p) => ({
                        ...p,
                        operations: p.operations.map((o) => (o.id === op.id ? { ...o, method: e.target.value as OperationMethod } : o)),
                      }))}
                      aria-label={`Method for ${op.name}`}
                      className="cursor-pointer rounded-md border border-[var(--color-line)] bg-white px-1 py-1 font-mono text-[10px] font-bold text-ivory-800"
                    >
                      {(["GET", "POST", "PUT", "PATCH", "DELETE", "EVENT", "QUERY"] as const).map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                    <input
                      value={op.name}
                      onChange={(e) => onMutateProject((p) => ({
                        ...p,
                        operations: p.operations.map((o) => (o.id === op.id ? { ...o, name: e.target.value } : o)),
                      }))}
                      spellCheck={false}
                      aria-label="Operation name"
                      placeholder="Operation name"
                      className="min-w-0 flex-1 rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 text-[11px] font-semibold text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                    />
                    <input
                      value={op.path}
                      onChange={(e) => onMutateProject((p) => ({
                        ...p,
                        operations: p.operations.map((o) => (o.id === op.id ? { ...o, path: e.target.value } : o)),
                      }))}
                      spellCheck={false}
                      aria-label="Operation path"
                      placeholder="/path"
                      className="w-24 rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[10px] text-ivory-800 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => onMutateProject((p) => ({
                        ...p,
                        operations: p.operations.filter((o) => o.id !== op.id),
                      }))}
                      aria-label={`Delete operation ${op.name}`}
                      title="Delete operation (edge bindings to it read as unbound)"
                      className="rounded p-1 text-ivory-400 hover:text-red-700 hover:bg-red-500/10 transition-colors cursor-pointer"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => onTestOperation(op.id)}
                      aria-label={`Test operation ${op.name}`}
                      title="Run this operation in Test mode (preflight + redacted history)"
                      className="shrink-0 rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[10px] font-bold text-bronze-700 hover:border-bronze-500 transition-colors cursor-pointer"
                    >
                      {op.mock ? "Test (mock)" : "Test"}
                    </button>
                    </div>
                    <OperationHttpConfig
                      op={op}
                      nodeId={node.id}
                      project={project}
                      onMutateProject={onMutateProject}
                      onSelectEdge={onSelectEdge}
                    />
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => onMutateProject((p) => ({
                  ...p,
                  operations: [...p.operations, {
                    id: newId("op"), interfaceId: iface.id, name: "New operation",
                    method: "GET" as const, path: "/", version: "v1",
                  }],
                }))}
                className="mt-1 text-[11px] font-semibold text-bronze-600 hover:text-bronze-700 cursor-pointer"
              >
                + Operation
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OperationHttpConfig({
  op,
  nodeId,
  project,
  onMutateProject,
  onSelectEdge,
}: {
  op: SystemOperation;
  nodeId: string;
  project: SystemProject;
  onMutateProject: (fn: (p: SystemProject) => SystemProject) => void;
  onSelectEdge: (edgeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const headerCount = (op.headers ?? []).length;
  const isEvent = op.method === "EVENT";
  const incoming = project.connections.find(
    (c) => c.targetId === nodeId && (c.targetOperationId === op.id || !c.targetOperationId)
  );

  const patchOp = (patch: Partial<SystemOperation>) =>
    onMutateProject((p) => ({
      ...p,
      operations: p.operations.map((o) => (o.id === op.id ? { ...o, ...patch } : o)),
    }));

  const setHeader = (i: number, patch: Partial<{ key: string; value: string }>) =>
    patchOp({ headers: (op.headers ?? []).map((h, j) => (j === i ? { ...h, ...patch } : h)) });

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={isEvent ? "Seed payload for chain runs starting here" : "Stored headers and sample body - sent by every runner"}
        className="flex items-center gap-1 text-[10px] font-bold text-bronze-700 hover:text-bronze-800 cursor-pointer"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        {isEvent ? "Seed payload" : "Headers & body"}
        {headerCount > 0 && (
          <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-bronze-500 px-1 text-[9px] font-bold text-white">
            {headerCount}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-1 space-y-1.5 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-2">
          {!isEvent && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                Headers - stored on the operation, sent by every runner
              </p>
              <div className="space-y-1">
                {(op.headers ?? []).map((h, i) => (
                  <div key={i}>
                    <div className="flex gap-1">
                    <input
                      value={h.key}
                      onChange={(e) => setHeader(i, { key: e.target.value })}
                      placeholder="Header"
                      spellCheck={false}
                      aria-label={`Stored header ${i + 1} name`}
                      className="w-28 rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[10px] text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                    />
                    <input
                      value={h.value}
                      onChange={(e) => setHeader(i, { value: e.target.value })}
                      placeholder="Value or $env.NAME"
                      spellCheck={false}
                      aria-label={`Stored header ${i + 1} value`}
                      className="min-w-0 flex-1 rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[10px] text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => patchOp({ headers: (op.headers ?? []).filter((_, j) => j !== i) })}
                      aria-label="Remove stored header"
                      className="rounded p-1 text-ivory-400 hover:text-red-700 transition-colors cursor-pointer"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                    </div>
                    {looksLikeSecret(h.value) && (
                      <p className="mt-0.5 rounded-md border border-red-300 bg-red-50 px-1.5 py-1 text-[10px] leading-snug text-red-700" role="alert">
                        Looks like a literal secret - it saves and exports with the project. Replace with{" "}
                        <span className="font-mono font-bold">$env.NAME</span> from Credentials and rotate this key.
                      </p>
                    )}
                    {["authorization", "cookie", "set-cookie", "proxy-authorization"].includes(h.key.trim().toLowerCase()) && (
                      <p className="mt-0.5 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-1 text-[10px] leading-snug text-amber-800" role="alert">
                        Never forwarded - the execution backend drops auth headers from stored config. Auth travels
                        per run via the Bearer token field (+ vault).
                      </p>
                    )}
                  </div>
                ))}
                {(op.headers ?? []).length < 20 && (
                  <button
                    type="button"
                    onClick={() => patchOp({ headers: [...(op.headers ?? []), { key: "", value: "" }] })}
                    className="text-[11px] font-semibold text-bronze-600 hover:text-bronze-700 cursor-pointer"
                  >
                    + Header
                  </button>
                )}
              </div>
              <p className="mt-1 text-[10px] text-ivory-500">
                $env.NAME resolves at send time. Auth/cookie headers are never forwarded - use the run token
                field. Values export with the project - never paste secrets, use the vault.
              </p>
            </div>
          )}
          <ImpactSection key={op.id} query={{ surface: "system", id: op.id }} caption={`${op.method} ${op.path}`} />
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ivory-600" title="Resilience policy for this operation. Unstated means unchecked - the risk lens only cites what is written.">
              Policy
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                Timeout s
                <input
                  type="number"
                  min={0}
                  max={86400}
                  value={op.policy?.timeoutSecs ?? ""}
                  onChange={(e) => patchOp({ policy: { ...op.policy, timeoutSecs: e.target.value === "" ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0) } })}
                  placeholder="30"
                  aria-label="Timeout seconds"
                  className="mt-0.5 w-full rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[10px] text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                />
              </label>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                Retries
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={op.policy?.retryAttempts ?? ""}
                  onChange={(e) => patchOp({ policy: { ...op.policy, retryAttempts: e.target.value === "" ? undefined : Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0)) } })}
                  placeholder="3"
                  aria-label="Retry attempts"
                  className="mt-0.5 w-full rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[10px] text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
                />
              </label>
              <label className="flex cursor-pointer items-end gap-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ivory-600" title="Safe to retry: idempotency key or idempotent receiver">
                <input
                  type="checkbox"
                  checked={!!op.policy?.idempotency}
                  onChange={(e) => patchOp({ policy: { ...op.policy, idempotency: e.target.checked || undefined } })}
                  aria-label="Idempotent"
                  className="h-3.5 w-3.5 cursor-pointer accent-[#7A5C3A]"
                />
                Idempotent
              </label>
            </div>
          </div>
          {!isEvent && (
            <div data-insp="mock">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-ivory-800 select-none">
                <input
                  type="checkbox"
                  checked={!!op.mock}
                  onChange={(e) =>
                    patchOp(
                      e.target.checked
                        ? { mock: { status: 200, body: '{\n  "mock": true\n}', latencyMs: 300 } }
                        : { mock: undefined }
                    )
                  }
                  className="h-3.5 w-3.5 accent-[#7A5C3A] cursor-pointer"
                />
                Mock - canned response, zero network
              </label>
              {op.mock && (
                <div className="mt-1.5 space-y-1.5 rounded-lg border border-bronze-200 bg-bronze-100/40 p-2">
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                      Status
                      <input
                        type="number"
                        value={op.mock.status}
                        onChange={(e) =>
                          patchOp({ mock: { ...op.mock!, status: Number(e.target.value) || 0, body: op.mock!.body, latencyMs: op.mock!.latencyMs } })
                        }
                        aria-label="Mock status code"
                        className="mt-0.5 w-full rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[10px] text-ivory-950 focus:border-bronze-500 focus:outline-none"
                      />
                    </label>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                      Latency ms
                      <input
                        type="number"
                        value={op.mock.latencyMs}
                        onChange={(e) =>
                          patchOp({ mock: { ...op.mock!, status: op.mock!.status, body: op.mock!.body, latencyMs: Number(e.target.value) || 0 } })
                        }
                        aria-label="Mock latency milliseconds"
                        className="mt-0.5 w-full rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[10px] text-ivory-950 focus:border-bronze-500 focus:outline-none"
                      />
                    </label>
                  </div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                    Canned body
                    <textarea
                      value={op.mock.body}
                      onChange={(e) =>
                        patchOp({ mock: { ...op.mock!, status: op.mock!.status, body: e.target.value, latencyMs: op.mock!.latencyMs } })
                      }
                      spellCheck={false}
                      rows={4}
                      aria-label="Mock response body"
                      className="mt-0.5 w-full rounded-md border border-[var(--color-line)] bg-white px-1.5 py-1 font-mono text-[10px] text-ivory-950 focus:border-bronze-500 focus:outline-none"
                    />
                  </label>
                  {looksLikeSecret(op.mock.body) && (
                    <p className="rounded-md border border-red-300 bg-red-50 px-1.5 py-1 text-[10px] leading-snug text-red-700" role="alert">
                      Looks like a literal secret - mocks save and export with the project. Use the vault ($env.NAME) or fake data.
                    </p>
                  )}
                  <p className="text-[10px] text-ivory-500">
                    Served by Test and chain runners instead of the network. Canned bodies export with the project.
                  </p>
                </div>
              )}
            </div>
          )}
          {op.method !== "GET" && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
                {isEvent ? "Seed payload - prefills chain runs starting here" : "Sample body - prefills test and edge runs"}
              </p>
              <textarea
                value={op.sampleBody ?? ""}
                onChange={(e) => patchOp({ sampleBody: e.target.value })}
                spellCheck={false}
                rows={3}
                aria-label={isEvent ? "Seed payload" : "Sample body"}
                placeholder={isEvent ? '{ "prompt": "Ask anything…" }' : '{ "key": "value" }'}
                className="w-full resize-y rounded-md border border-[var(--color-line)] bg-white p-1.5 font-mono text-[10px] leading-relaxed text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
              />
            </div>
          )}
          {!isEvent && (
            <div data-insp="mapping" className="rounded-md bg-[var(--color-canvas)] px-2 py-1.5">
              {incoming ? (
                <button
                  type="button"
                  onClick={() => onSelectEdge(incoming.id)}
                  title="Open the link that feeds this operation - its mapping builds this step's body from previous outputs"
                  className="text-left text-[11px] font-semibold text-bronze-700 hover:text-bronze-800 cursor-pointer"
                >
                  Body from previous step → edit incoming mapping
                  <span className="block font-mono font-normal text-ivory-500">
                    {incoming.label || "unlabeled link"} · {incoming.mapping ? incoming.mapping.mode : "no mapping yet (passthrough)"}
                  </span>
                </button>
              ) : (
                <p className="text-[10px] text-ivory-500">
                  No incoming link feeds this operation yet - link another system to it and the edge mapping will
                  build this step&apos;s body from previous outputs ({"{{response}}, {{seed}}, {{steps.*}}"}).
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VariableChips({
  project,
  edge,
  onInsert,
}: {
  project: SystemProject;
  edge: SystemConnection;
  onInsert: (ref: string) => void;
}) {
  const upstream = useMemo(() => {
    const names: { id: string; name: string }[] = [];
    const seen = new Set<string>([edge.targetId]);
    const queue = [edge.sourceId];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      const sys = project.systems.find((s) => s.id === cur);
      if (sys) names.push({ id: sys.id, name: sys.name });
      for (const c of project.connections) {
        if (c.targetId === cur) queue.push(c.sourceId);
      }
    }
    return names;
  }, [project, edge]);

  const chip = (label: string, ref: string, title: string) => (
    <button
      key={ref}
      type="button"
      onClick={() => onInsert(ref)}
      title={`${title} - click to insert`}
      className="rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[10px] text-ivory-800 hover:border-bronze-500 hover:text-ivory-950 transition-colors cursor-pointer"
    >
      {label}
    </button>
  );

  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
        Variables available here - click to insert
      </p>
      <div className="flex flex-wrap gap-1">
        {chip("response", "{{response}}", "Previous hop output")}
        {chip("seed", "{{seed}}", "Flow seed payload")}
        {upstream.map((u) => chip(u.name, `{{steps.${u.id}}}`, `Output of the hop targeting ${u.name}`))}
        {chip("request", "{{request}}", "Body just sent to the previous hop - replay it past a bare ack ({{requests.<id>}} for any hop)")}
        {chip("$env", "$env.", "Session credential prefix")}
      </div>
    </div>
  );
}

function EdgeInspector({
  edge,
  project,
  sourceName,
  targetName,
  onPatch,
  onDelete,
  onRun,
  onRunChain,
  runReady,
}: {
  edge: SystemConnection;
  project: SystemProject;
  sourceName: string;
  targetName: string;
  onPatch: (patch: Partial<SystemConnection>) => void;
  onDelete: () => void;
  onRun: () => void;
  onRunChain: () => void;
  runReady: boolean;
}) {
  const tplRef = useRef<HTMLTextAreaElement>(null);
  const readiness = connectionReadiness(edge, project);
  const sourceGroups = operationsForSystem(project, edge.sourceId);
  const targetGroups = operationsForSystem(project, edge.targetId);
  const opLabel = (ifaceName: string, opName: string, method: string) => `${method} ${opName} (${ifaceName})`;
  const bindSelect = (
    side: "source" | "target",
    value: string | undefined,
    groups: { iface: SystemInterface; ops: SystemOperation[] }[],
    ownerName: string
  ) => (
    <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
      {side === "source" ? `Source op · ${ownerName}` : `Target op · ${ownerName}`}
      <select
        value={value ?? ""}
        onChange={(e) => onPatch(side === "source"
          ? { sourceOperationId: e.target.value || undefined }
          : { targetOperationId: e.target.value || undefined })}
        className="mt-0.5 w-full cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-1.5 py-1.5 text-xs font-medium normal-case tracking-normal text-ivory-950"
      >
        <option value="">Unbound</option>
        {groups.map((g) => (
          <optgroup key={g.iface.id} label={g.iface.name}>
            {g.ops.map((o) => (
              <option key={o.id} value={o.id}>{opLabel(g.iface.name, o.name, o.method)}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
  return (
    <div className="space-y-2.5">
      <div data-insp="identity" className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)] p-2.5 font-mono text-[11px] text-ivory-800">
        {sourceName} → {targetName}
      </div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-ivory-600">
        Label
        <input
          value={edge.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          placeholder="e.g. Lead created event"
          spellCheck={false}
          className="mt-0.5 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 text-xs font-medium normal-case tracking-normal text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
        />
      </label>
      <div className="flex items-center gap-1.5">
        <Badge variant={readiness === "ready" ? "success" : readiness === "partial" ? "warning" : "default"}>
          {readiness}
        </Badge>
        <p className="text-[11px] leading-relaxed text-ivory-600">
          {readiness === "ready"
            ? "Both ends bound - executable once a runner exists (Phase 3)."
            : readiness === "partial"
              ? "One end bound - bind the other to finish this edge."
              : "Not executable - bind operations to run this edge (Phase 2)."}
        </p>
      </div>
      <div data-insp="connect" className="contents">
      {bindSelect("source", edge.sourceOperationId, sourceGroups, sourceName)}
      {bindSelect("target", edge.targetOperationId, targetGroups, targetName)}
      </div>
      <details data-insp="mapping" className="rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-canvas)]">
        <summary className="cursor-pointer px-2.5 py-2 text-[11px] font-semibold text-ivory-900 hover:text-ivory-950">
          Mapping {edge.mapping ? `· ${edge.mapping.mode}` : "· none (passthrough at run)"}
        </summary>
        <div className="space-y-1.5 border-t border-[var(--color-line-soft)] p-2.5">
          <div className="flex gap-1.5" role="radiogroup" aria-label="Mapping mode">
            {(["passthrough", "template"] as const).map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={(edge.mapping?.mode ?? "passthrough") === m}
                onClick={() => onPatch({ mapping: { mode: m, template: edge.mapping?.template ?? '{\n  "data": {{response}}\n}' } })}
                className={`rounded-lg border px-2 py-1 text-[11px] font-semibold capitalize transition-colors cursor-pointer ${((edge.mapping?.mode ?? "passthrough") === m) ? "bg-ivory-950 text-ivory-100 border-ivory-950" : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-600 hover:text-ivory-950"}`}
              >
                {m === "passthrough" ? "Pass-through" : "Template"}
              </button>
            ))}
          </div>
          {(edge.mapping?.mode ?? "passthrough") === "template" && (
            <>
              <VariableChips
                project={project}
                edge={edge}
                onInsert={(ref) => {
                  const ta = tplRef.current;
                  const cur = edge.mapping?.template ?? "";
                  if (!ta) {
                    onPatch({ mapping: { mode: "template", template: cur + ref } });
                    return;
                  }
                  const start = ta.selectionStart ?? cur.length;
                  const end = ta.selectionEnd ?? cur.length;
                  const next = cur.slice(0, start) + ref + cur.slice(end);
                  onPatch({ mapping: { mode: "template", template: next } });
                  const caret = start + ref.length;
                  window.setTimeout(() => {
                    tplRef.current?.focus();
                    tplRef.current?.setSelectionRange(caret, caret);
                  }, 0);
                }}
              />
              <textarea
                ref={tplRef}
                value={edge.mapping?.template ?? ""}
              onChange={(e) => onPatch({ mapping: { mode: "template", template: e.target.value } })}
              spellCheck={false}
              rows={4}
              aria-label="Mapping template"
              placeholder={'{\n  "x": {{field}}\n}'}
              className="w-full resize-y rounded-lg border border-[var(--color-line)] bg-white p-2 font-mono text-[11px] leading-relaxed text-ivory-950 placeholder-ivory-400 focus:border-bronze-500 focus:outline-none"
              />
            </>
          )}
          <p className="text-[10px] text-ivory-500">
            Stored on the edge - chains run unattended. {"{{response}}"} is the previous hop, {"{{seed}}"} the
            flow input, {"{{steps.<system>}}"} any earlier hop output.
          </p>
        </div>
      </details>
      <div data-insp="test" className="contents">
      <Button
        size="sm"
        onClick={onRun}
        disabled={!runReady}
        title={runReady ? "Run this edge end-to-end: source call → mapping → target call, with trace" : "Bind both ends first - only ready edges run"}
        className="w-full"
      >
        Run edge end-to-end
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={onRunChain}
        disabled={!runReady}
        title={runReady ? "Run the full downstream flow from this edge - every branch, with trace on canvas" : "Bind both ends first - chains start from ready edges"}
        className="w-full"
      >
        Run chain from here
      </Button>
      </div>
      <Button size="sm" variant="ghost" onClick={onDelete} className="w-full">
        Delete connection
      </Button>
    </div>
  );
}

