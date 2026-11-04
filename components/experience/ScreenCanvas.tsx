"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "../ui/Button";
import {
  clampRect,
  dragRect,
  fitViewport,
  normalizeRect,
  toSource,
  toView,
  zoomAbout,
  type Handle,
  type Rect,
  type Viewport,
} from "@/lib/experience/geometry";
import type { ScreenAnnotation } from "@/lib/experience/types";

type Tool = "select" | "draw" | "pan";

const HANDLE_CURSORS: Record<Handle, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", move: "move",
};

function handlesOf(r: Rect): { handle: Handle; x: number; y: number }[] {
  const { x, y, width, height } = r;
  return [
    { handle: "nw", x, y },
    { handle: "n", x: x + width / 2, y },
    { handle: "ne", x: x + width, y },
    { handle: "sw", x, y: y + height },
    { handle: "s", x: x + width / 2, y: y + height },
    { handle: "se", x: x + width, y: y + height },
    { handle: "w", x, y: y + height / 2 },
    { handle: "e", x: x + width, y: y + height / 2 },
  ];
}

/**
 * Screenshot canvas: HTML image + SVG overlay. Source pixels canonical;
 * viewport (zoom/pan) transient. Rectangle annotations only.
 */
export function ScreenCanvas({
  imageUrl,
  imageAlt,
  sourceW,
  sourceH,
  annotations,
  selectedId,
  onSelect,
  onCreate,
  onMove,
  onDelete,
  onLabel,
}: {
  imageUrl: string;
  imageAlt: string;
  sourceW: number;
  sourceH: number;
  annotations: ScreenAnnotation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (rect: Rect) => void;
  onMove: (id: string, rect: Rect) => void;
  onDelete: (id: string) => void;
  onLabel: (id: string, label: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState<Viewport>({ scale: 1, tx: 0, ty: 0 });
  const [tool, setTool] = useState<Tool>("select");
  const [showAll, setShowAll] = useState(true);
  const [draft, setDraft] = useState<Rect | null>(null);
  const gesture = useRef<null | { mode: "draw" | "pan" | "handle"; startPx: number; startPy: number; origVp?: Viewport; annId?: string; handle?: Handle; origRect?: Rect }>(null);

  // Fit on mount / image change / container resize.
  const refit = useCallback(() => {
    const el = containerRef.current;
    if (!el || !sourceW || !sourceH) return;
    setVp(fitViewport(sourceW, sourceH, el.clientWidth, Math.max(240, el.clientHeight)));
  }, [sourceW, sourceH]);

  useEffect(() => {
    refit();
  }, [refit, imageUrl]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => refit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [refit]);

  // Ctrl/cmd+wheel zooms about cursor; plain wheel pans vertically.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        setVp((v) => zoomAbout(v, e.deltaY < 0 ? 1.12 : 1 / 1.12, cx, cy));
      } else {
        setVp((v) => ({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const local = (e: React.PointerEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const { px, py } = local(e);
    if (tool === "pan") {
      gesture.current = { mode: "pan", startPx: px, startPy: py, origVp: vp };
      return;
    }
    if (tool === "draw") {
      const s = toSource(vp, px, py);
      gesture.current = { mode: "draw", startPx: s.x, startPy: s.y };
      setDraft({ x: Math.round(s.x), y: Math.round(s.y), width: 0, height: 0 });
      return;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const { px, py } = local(e);
    if (g.mode === "pan" && g.origVp) {
      setVp({ ...g.origVp, tx: g.origVp.tx + (px - g.startPx), ty: g.origVp.ty + (py - g.startPy) });
    } else if (g.mode === "draw") {
      const s = toSource(vp, px, py);
      setDraft(normalizeRect(g.startPx, g.startPy, s.x, s.y));
    } else if (g.mode === "handle" && g.annId && g.handle && g.origRect) {
      const s = toSource(vp, px, py);
      const start = toSource(vp, g.startPx, g.startPy);
      const moved = dragRect(g.origRect, g.handle, s.x - start.x, s.y - start.y);
      const clamped = clampRect(moved, sourceW, sourceH) ?? g.origRect;
      onMove(g.annId, clamped);
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.mode === "draw" && draft) {
      const clamped = clampRect(draft, sourceW, sourceH);
      setDraft(null);
      if (clamped) onCreate(clamped);
    }
  };

  const beginHandle = (e: React.PointerEvent, annId: string, handle: Handle) => {
    e.stopPropagation();
    onSelect(annId);
    const { px, py } = local(e);
    const ann = annotations.find((a) => a.id === annId);
    if (!ann) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    gesture.current = { mode: "handle", startPx: px, startPy: py, annId, handle, origRect: { ...ann.geometry } };
  };



  const showLabels = vp.scale > 0.55;

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Canvas tools">
        {(
          [["select", "Select"], ["draw", "Draw region"], ["pan", "Pan"]] as [Tool, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            onClick={() => setTool(t)}
            aria-pressed={tool === t}
            className={`rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer ${tool === t ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] bg-white text-[#777168] hover:text-[#27241F]"}`}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-[#E8E2D8]" aria-hidden="true" />
        <button type="button" onClick={() => setVp((v) => zoomAbout(v, 1 / 1.25, 200, 150))} aria-label="Zoom out" className="rounded-lg border border-[#E8E2D8] bg-white px-2 py-1 font-mono text-[11px] cursor-pointer hover:text-[#27241F] text-[#777168]">
          −
        </button>
        <span className="font-mono text-[11px] text-[#777168]" aria-live="polite">{Math.round(vp.scale * 100)}%</span>
        <button type="button" onClick={() => setVp((v) => zoomAbout(v, 1.25, 200, 150))} aria-label="Zoom in" className="rounded-lg border border-[#E8E2D8] bg-white px-2 py-1 font-mono text-[11px] cursor-pointer hover:text-[#27241F] text-[#777168]">
          +
        </button>
        <button type="button" onClick={refit} className="rounded-lg border border-[#E8E2D8] bg-white px-2 py-1 text-[11px] font-semibold cursor-pointer text-[#777168] hover:text-[#27241F]">
          Fit
        </button>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-pressed={showAll}
          className="rounded-lg border border-[#E8E2D8] bg-white px-2 py-1 text-[11px] font-semibold cursor-pointer text-[#777168] hover:text-[#27241F]"
        >
          {showAll ? "Hide regions" : "Show regions"}
        </button>
        <span className="ml-auto font-mono text-[10px] text-[#A39B8E]">
          {sourceW}×{sourceH}px · ctrl+wheel zooms
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onSelect(null);
            setDraft(null);
          }
          if ((e.key === "Delete" || e.key === "Backspace") && selectedId && document.activeElement === containerRef.current) {
            onDelete(selectedId);
          }
        }}
        tabIndex={0}
        role="application"
        aria-label={`Screenshot canvas for ${imageAlt}. ${annotations.length} annotated regions.`}
        className="relative h-[420px] touch-none overflow-hidden rounded-xl border border-[#E8E2D8] bg-[#F5F1E8] outline-none focus:border-[#A98450]"
        style={{ cursor: tool === "draw" ? "crosshair" : tool === "pan" ? "grab" : "default" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute select-none"
          style={{ left: vp.tx, top: vp.ty, width: sourceW * vp.scale, height: sourceH * vp.scale, maxWidth: "none" }}
        />
        <svg className="absolute inset-0 h-full w-full">
          {showAll &&
            annotations.map((a, i) => {
              const p = toView(vp, a.geometry.x, a.geometry.y);
              const w = a.geometry.width * vp.scale;
              const h = a.geometry.height * vp.scale;
              const isSel = a.id === selectedId;
              return (
                <g key={a.id}>
                  <rect
                    x={p.px}
                    y={p.py}
                    width={w}
                    height={h}
                    fill={isSel ? "rgba(169,132,80,0.18)" : "rgba(169,132,80,0.08)"}
                    stroke={isSel ? "#A98450" : "#8A6A2F"}
                    strokeWidth={isSel ? 2 : 1.25}
                    style={{ cursor: tool === "select" ? "move" : undefined }}
                    onPointerDown={(e) => {
                      if (tool !== "select") return;
                      e.stopPropagation();
                      onSelect(a.id);
                      const { px, py } = local(e as unknown as React.PointerEvent);
                      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                      gesture.current = { mode: "handle", startPx: px, startPy: py, annId: a.id, handle: "move", origRect: { ...a.geometry } };
                    }}
                  />
                  <g>
                    <rect x={p.px} y={Math.max(0, p.py - 18)} width={showLabels ? Math.min(220, a.label.length * 6.5 + 34) : 26} height={18} rx={4} fill={isSel ? "#211F1B" : "rgba(33,31,27,0.78)"} />
                    <text x={p.px + 5} y={Math.max(0, p.py - 18) + 13} fill="#fff" fontSize={11} fontFamily="monospace">
                      {i + 1}{showLabels ? ` ${a.label.slice(0, 28)}` : ""}
                    </text>
                  </g>
                  {isSel &&
                    handlesOf(a.geometry).map(({ handle, x, y }) => {
                      const hp = toView(vp, x, y);
                      return (
                        <rect
                          key={handle}
                          x={hp.px - 5}
                          y={hp.py - 5}
                          width={10}
                          height={10}
                          rx={2}
                          fill="#fff"
                          stroke="#A98450"
                          strokeWidth={1.5}
                          style={{ cursor: HANDLE_CURSORS[handle] }}
                          onPointerDown={(e) => beginHandle(e, a.id, handle)}
                        />
                      );
                    })}
                </g>
              );
            })}
          {draft && (
            <rect
              x={(draft.x * vp.scale + vp.tx)}
              y={(draft.y * vp.scale + vp.ty)}
              width={draft.width * vp.scale}
              height={draft.height * vp.scale}
              fill="rgba(169,132,80,0.15)"
              stroke="#A98450"
              strokeDasharray="5 3"
              strokeWidth={1.5}
            />
          )}
        </svg>
      </div>

      {/* Accessible annotation list (no-drag alternative) */}
      <div className="mt-2 rounded-xl border border-[#E8E2D8] bg-white">
        <p className="border-b border-[#F0EBE0] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
          Regions · {annotations.length}
        </p>
        {annotations.length === 0 ? (
          <p className="px-3 py-2 text-[12px] text-[#A39B8E]">No regions yet - choose Draw region and drag across the screenshot.</p>
        ) : (
          <ul className="max-h-[180px] divide-y divide-[#F0EBE0] overflow-y-auto">
            {annotations.map((a, i) => (
              <li key={a.id} className={`flex items-center gap-2 px-3 py-1.5 ${a.id === selectedId ? "bg-[#FAF3E3]" : ""}`}>
                <button
                  type="button"
                  onClick={() => onSelect(a.id === selectedId ? null : a.id)}
                  aria-pressed={a.id === selectedId}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#211F1B] font-mono text-[10px] text-white">{i + 1}</span>
                  <span className="truncate text-[12px] text-[#27241F]">{a.label || "(unnamed region)"}</span>
                  <span className="shrink-0 font-mono text-[10px] text-[#A39B8E]">
                    {a.geometry.x},{a.geometry.y} {a.geometry.width}×{a.geometry.height}
                  </span>
                </button>
                <input
                  value={a.label}
                  onChange={(e) => onLabel(a.id, e.target.value)}
                  aria-label={`Label for region ${i + 1}`}
                  placeholder="Component name"
                  spellCheck={false}
                  className="w-32 rounded-md border border-[#E8E2D8] px-1.5 py-0.5 text-[11px] focus:border-[#A98450] focus:outline-none"
                />
                <Button size="sm" variant="ghost" onClick={() => onDelete(a.id)} aria-label={`Delete region ${i + 1}`}>
                  ✕
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
