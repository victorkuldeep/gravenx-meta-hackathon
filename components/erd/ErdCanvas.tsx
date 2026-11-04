"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useStore,
  getNodesBounds,
  getViewportForBounds,
  PanOnScrollMode,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toPng } from "html-to-image";
import type { ErdNodeData, GraphBubbleData } from "@/lib/erd/graph";
import { ErdTableNode } from "./ErdTableNode";
import { ErdEdge } from "./ErdEdge";
import { GraphBubbleNode } from "./GraphBubbleNode";
import { LaserLayer } from "../laser/LaserLayer";
import { useAmplifiedPinch } from "../canvas/useAmplifiedPinch";

const nodeTypes = { erdTable: ErdTableNode, graphBubble: GraphBubbleNode } as const;
const edgeTypes = { erdEdge: ErdEdge } as const;

export interface ErdCanvasHandle {
  getNodes: () => Node<ErdNodeData | GraphBubbleData>[];
  /** Smooth-pan the node to canvas center, keeping the current zoom. */
  focusNode: (apiName: string) => boolean;
}

interface ErdCanvasProps {
  nodes: Node<ErdNodeData | GraphBubbleData>[];
  edges: Edge[];
  onNodeClick?: (id: string) => void;
  /** Fires with the edge id when a relationship link is clicked. */
  onEdgeClick?: (id: string) => void;
  onPaneClick?: () => void;
  onViewportMove?: () => void;
  onNodeDragStop?: (id: string, position: { x: number; y: number }) => void;
  /** Bump to force a fresh auto-layout. Unchanged revisions preserve drag positions. */
  layoutRev: number;
  /** Explicit positions (snapshot restore) applied on top of the fresh layout. */
  enforcedPositions?: Map<string, { x: number; y: number }> | null;
  /** Restored viewport (zoom memory across view switches). Omit to fit. */
  storedViewport?: { x: number; y: number; zoom: number } | null;
  onViewportChange?: (v: { x: number; y: number; zoom: number }) => void;
  /** Drag-only lock, owned by the parent toolbar button. Pan/zoom unaffected. */
  nodesLocked?: boolean;
  /** Schema authoring: live connection grips + edge drawing for relationships. */
  connectable?: boolean;
  /** Fires on a completed drag-connect with node API names (source, target). */
  onConnectNodes?: (sourceApi: string, targetApi: string) => void;
  /** Reports the built-in OOB lock state upward (for mutual exclusion). */
  onOobLockChange?: (locked: boolean) => void;
  /** Reset view from the canvas toolbar - parent re-runs layout, canvas re-fits. */
  onResetView?: () => void;
  /** Field dictionary export (ERD view) - parent owns describes + download. */
  onExportDictionary?: () => void | Promise<void>;
}

function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function pngFileName(scale: 2 | 3): string {
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  return `salesforce-erd-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}@${scale}x.png`;
}

const ErdFlow = forwardRef<ErdCanvasHandle, ErdCanvasProps>(function ErdFlow(
  { nodes: propNodes, edges: propEdges, onNodeClick, onEdgeClick, onPaneClick, onViewportMove, onNodeDragStop, layoutRev, enforcedPositions, storedViewport, onViewportChange, nodesLocked = false, onOobLockChange, connectable = false, onConnectNodes, onResetView, onExportDictionary },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfInstance = useReactFlow();
  const rfRef = useRef<ReactFlowInstance | null>(null);
  useEffect(() => {
    rfRef.current = rfInstance;
  }, [rfInstance]);
  // 4x-feel pinch zoom (trackpad + touch); the native 1x handler stays off.
  useAmplifiedPinch(containerRef, { instanceRef: rfRef, minZoom: 0.15, maxZoom: 4 });
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ErdNodeData | GraphBubbleData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView, setCenter, getZoom, setViewport, getViewport } = useReactFlow();
  // Built-in OOB lock state, reported upward for mutual exclusion with the
  // parent-owned drag lock. nodesConnectable is hard-false here, so it is
  // excluded - otherwise the lock would read permanently engaged.
  const oobLocked = useStore((s) => !(s.nodesDraggable || s.elementsSelectable));
  useEffect(() => {
    onOobLockChange?.(oobLocked);
  }, [oobLocked, onOobLockChange]);
  const lastRev = useRef(layoutRev);
  // Refit only when the graph SHAPE changes (count, view type, explicit
  // re-layout) - never on data-only refreshes, so zoom is never stolen.
  const fitSig = useRef("");

  // Live mirror for snapshot saves (drag positions included)
  const nodesRef = useRef<Node<ErdNodeData | GraphBubbleData>[]>([]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useImperativeHandle(
    ref,
    () => ({
      getNodes: () => nodesRef.current,
      focusNode: (apiName: string) => {
        const n = nodesRef.current.find(
          (node) => node.id === apiName || (node.data as ErdNodeData | GraphBubbleData).apiName === apiName
        );
        if (!n) return false;
        const w = n.measured?.width ?? n.width ?? 300;
        const h = n.measured?.height ?? n.height ?? 200;
        setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: getZoom(), duration: 600 });
        return true;
      },
    }),
    [setCenter, getZoom]
  );

  const [laser, setLaser] = useState(false);
  const overlayRef = useRef<SVGSVGElement | null>(null);

  // Laser overlay covers the canvas, so the wheel never reaches React Flow.
  // Mirror the standard contract manually: plain wheel pans in every
  // direction, pinch (ctrl+wheel) zooms around the cursor. Non-passive so
  // the page underneath never scrolls mid-walkthrough.
  useEffect(() => {
    if (!laser) return;
    const el = overlayRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const unit = e.deltaMode === 1 ? 16 : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      const v = getViewport();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-dy * 0.015);
        const newZoom = Math.min(2.5, Math.max(0.15, v.zoom * factor));
        if (newZoom === v.zoom) return;
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const fx = (mx - v.x) / v.zoom;
        const fy = (my - v.y) / v.zoom;
        setViewport({ x: mx - fx * newZoom, y: my - fy * newZoom, zoom: newZoom });
      } else {
        setViewport({ x: v.x - dx, y: v.y - dy, zoom: v.zoom });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [laser, setViewport, getViewport]);

  const [exporting, setExporting] = useState(false);
  const [dictBusy, setDictBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (enforcedPositions) {
      // Snapshot restore: fresh layout underneath, saved drag positions on top
      setNodes(
        propNodes.map((n) => {
          const p = enforcedPositions.get(n.id);
          return p ? { ...n, position: { ...p } } : n;
        })
      );
      setEdges(propEdges);
      lastRev.current = layoutRev;
    } else if (lastRev.current !== layoutRev) {
      // Explicit re-layout (discover, reset, fresh add)
      lastRev.current = layoutRev;
      setNodes(propNodes);
      setEdges(propEdges);
    } else {
      // Same revision (e.g. metadata refresh): keep every dragged position,
      // adopt fresh positions only for brand-new nodes
      setNodes((prev) => {
        const current = new Map(prev.map((p) => [p.id, p.position] as const));
        return propNodes.map((n) => {
          const p = current.get(n.id);
          return p ? { ...n, position: p } : n;
        });
      });
      setEdges(propEdges);
    }
    // Refit ONLY on view-type switch, explicit re-layout, or restore - NEVER
    // on node-count changes (adds, removes, filters, expansions) and never on
    // selection/spotlight: your zoom is sacred and stays put while scouting.
    // With a stored viewport (memory across switches) skip fitting entirely -
    // defaultViewport below restores it on mount.
    const sig = `${propNodes[0]?.type ?? ""}:${layoutRev}:${enforcedPositions ? "e" : ""}:${storedViewport ? "m" : "f"}`;
    if (sig !== fitSig.current) {
      fitSig.current = sig;
      if (storedViewport) return undefined;
      const t = window.setTimeout(() => fitView({ padding: 0.18, maxZoom: 1 }), 60);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [propNodes, propEdges, layoutRev, enforcedPositions, storedViewport, setNodes, setEdges, fitView]);

  // First nodes arriving post-mount (fresh canvas or async autosave /
  // snapshot restore): defaultViewport only applies at mount, so a restored
  // viewport would otherwise never land and the canvas sits stranded
  // top-left. Center once; later adds never steal the zoom back.
  const hadNodes = useRef(false);
  useEffect(() => {
    if (propNodes.length === 0) {
      hadNodes.current = false;
      return undefined;
    }
    if (!hadNodes.current) {
      hadNodes.current = true;
      const t = window.setTimeout(() => fitView({ padding: 0.18, maxZoom: 1 }), 60);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [propNodes.length, fitView]);

  useEffect(() => {
    if (!laser) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLaser(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [laser]);

  // "L" toggles the laser (Excalidraw-style): press to present, Esc to exit.
  // Scroll moves and pinch zooms even while lasering - no toggle dance.
  // Ignored while typing or with modifier keys held. ⌘K stays as object find.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() !== "l") return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      e.preventDefault();
      setLaser((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const doExport = useCallback(
    async (scale: 2 | 3) => {
      setExporting(true);
      setExportError(null);
      try {
        const viewportEl = containerRef.current?.querySelector(".react-flow__viewport");
        if (!viewportEl) throw new Error("Canvas not ready");
        const bounds = getNodesBounds(nodes);
        const PAD = 60;
        const imgW = Math.max(1200, bounds.width + PAD * 2);
        const imgH = Math.max(800, bounds.height + PAD * 2);
        const { x, y, zoom } = getViewportForBounds(
          bounds,
          imgW,
          imgH,
          0.1,
          2,
          PAD / Math.min(imgW, imgH)
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
            (!n.classList.contains("react-flow__handle") &&
              !n.classList.contains("erd-laser-layer")),
        });
        downloadDataUrl(dataUrl, pngFileName(scale));
      } catch (err) {
        setExportError(err instanceof Error ? err.message : "PNG export failed");
      } finally {
        setExporting(false);
      }
    },
    [nodes]
  );

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[420px] w-full overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)]"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => onNodeClick?.(node.id)}
        onEdgeClick={(_, edge) => onEdgeClick?.(edge.id)}
        onPaneClick={() => onPaneClick?.()}
        onNodeDragStop={(_, node) => onNodeDragStop?.(node.id, { ...node.position })}
        onMoveStart={() => onViewportMove?.()}
        onMoveEnd={(_, viewport) => onViewportChange?.({ ...viewport })}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        panOnDrag={!laser}
        zoomOnScroll={false}
        panOnScroll
        panOnScrollMode={PanOnScrollMode.Free}
        zoomOnPinch={false}
        nodesDraggable={!laser && !nodesLocked}
        nodesConnectable={!laser && connectable}
        onConnect={(c) => {
          if (c.source && c.target && c.source !== c.target) onConnectNodes?.(c.source, c.target);
        }}
        elementsSelectable={!laser}
        minZoom={0.15}
        fitView={storedViewport ? false : true}
        defaultViewport={storedViewport ?? undefined}
      >
        <Background gap={22} size={1.2} color="#DDD3BC" bgColor="#FAF8F2" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          nodeColor="#D9CFB6"
          nodeStrokeColor="#9A7653"
          style={{ background: "#FFFFFF", border: "1px solid #DDD3BC", borderRadius: 8 }}
          maskColor="rgba(250, 248, 242, 0.75)"
        />
        <Controls position="bottom-left" showInteractive={!nodesLocked} />
      </ReactFlow>

      {/* Shared laser layer: hover paints, tail melts, canvas never re-renders.
          Keeps the erd-laser-layer class so PNG export keeps filtering it. */}
      <LaserLayer
        active={laser}
        className="erd-laser-layer absolute inset-0 h-full w-full touch-none"
        zIndex={20}
        svgRef={overlayRef}
      />

      {/* Empty canvas: guidance card (pan still works around it) */}
      {propNodes.length === 0 && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-6 pointer-events-none">
          <div className="pointer-events-auto max-w-sm rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] px-6 py-5 text-center shadow-[0_12px_36px_-16px_rgba(24,20,12,0.4)]">
            <p className="text-[11px] font-bold uppercase tracking-[1.8px] text-[var(--color-accent-dark)]">
              Map your data model
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ivory-700">
              Add an object from the panel on the left - links to objects
              already on canvas draw automatically.
            </p>
            <p className="mt-2.5 text-[11px] text-ivory-500">
              ⌘K find · L laser · drag to pan · scroll to move · pinch to zoom
            </p>
          </div>
        </div>
      )}

      {/* Top-left: counts + laser */}
      <div className="absolute left-3 top-3 z-30 flex flex-wrap items-center gap-1.5">
        <span className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[11px] font-medium text-ivory-700">
          <button
          type="button"
          onClick={() => {
            fitView({ padding: 0.18, maxZoom: 1 });
            onResetView?.();
          }}
          title="Reset view - re-run auto-layout and re-fit, keeps every node"
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[11px] font-semibold text-ivory-700 transition-colors cursor-pointer hover:border-[var(--color-accent)] hover:text-ivory-950"
        >
          Reset view
        </button>
          {nodes.length} objects · {edges.length} links
        </span>
        <button
          type="button"
          onClick={() => setLaser((v) => !v)}
          aria-pressed={laser}
          title={laser ? "Exit laser pointer (Esc)" : "Laser walkthrough - press L to present, Esc to exit (scroll moves, pinch zooms)"}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
            laser
              ? "bg-[#ef4444] border-[#dc2626] text-white shadow-[0_0_12px_rgba(239,68,68,0.5)]"
              : "bg-[var(--color-surface)] border-[var(--color-line)] text-ivory-700 hover:border-red-400 hover:text-red-600"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${laser ? "bg-white" : "bg-[#ef4444]"}`} aria-hidden="true" />
          {laser ? "Laser • Esc to exit" : "Laser"}
        </button>
      </div>

      {/* Top-right: snapshot export - always visible */}
      <div className="absolute right-3 top-3 z-30 flex items-center gap-1.5">
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
          className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[11px] font-semibold text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950 transition-colors cursor-pointer disabled:opacity-40"
        >
          {exporting ? "Exporting…" : "Snapshot PNG"}
        </button>
        <button
          type="button"
          onClick={() => doExport(3)}
          disabled={exporting || nodes.length === 0}
          title="Download the full diagram as hi-res PNG (3x) for decks"
          className="rounded-lg border border-ivory-950 bg-ivory-950 px-2.5 py-1.5 text-[11px] font-semibold text-ivory-100 hover:bg-bronze-600 hover:border-bronze-600 transition-colors cursor-pointer disabled:opacity-40"
        >
          3x Hi-Res
        </button>
        {onExportDictionary && (
          <button
            type="button"
            onClick={() => {
              setDictBusy(true);
              void Promise.resolve()
                .then(() => onExportDictionary())
                .finally(() => setDictBusy(false));
            }}
            disabled={dictBusy || nodes.length === 0}
            title="Download the field dictionary - one sheet per object plus relationships"
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[11px] font-semibold text-ivory-700 hover:border-[var(--color-accent)] hover:text-ivory-950 transition-colors cursor-pointer disabled:opacity-40"
          >
            {dictBusy ? "Building…" : "Dictionary (.xlsx)"}
          </button>
        )}
      </div>
    </div>
  );
});

export const ErdCanvas = forwardRef<ErdCanvasHandle, ErdCanvasProps>(function ErdCanvas(props, ref) {
  return (
    <ReactFlowProvider>
      <ErdFlow {...props} ref={ref} />
    </ReactFlowProvider>
  );
});
