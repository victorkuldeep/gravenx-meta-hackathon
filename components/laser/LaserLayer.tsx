"use client";

import { memo, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  LASER_LIFETIME_MS,
  LASER_MAX_PTS,
  LASER_MAX_STROKES,
  appendPoint,
  opacityForAge,
  type LaserPoint,
} from "@/lib/laser/strokes";

interface LaserStroke {
  id: number;
  pts: LaserPoint[];
  /** Last time a point landed: the group melts HOLD_MS after this clock. */
  lastTouch: number;
}

function findScroller(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let el = walker.nextNode() as HTMLElement | null;
  while (el) {
    if (el.scrollHeight > el.clientHeight + 4) return el;
    el = walker.nextNode() as HTMLElement | null;
  }
  return null;
}

/**
 * Shared laser pointer layer (ERD + JSON studio), Excalidraw rule: the live
 * stroke NEVER dies while you draw - only the tail behind it melts. Opacity
 * is a sliding window over each group's last touch (rAF clock), so holding
 * the button/finger and moving for 10s keeps painting; ~1s after you stop,
 * the trail melts away.
 *
 * Activation is cursor-only: entering laser mode shows the pencil and lets
 * you roam freely. Painting starts on press (click-drag, finger down) and
 * stops on release; the next press opens a fresh stroke while the previous
 * group keeps melting. Pointer capture sits on the immortal svg root (never
 * a stroke polyline - capturing a melting trail kills the gesture when it
 * unmounts) and is re-acquired on lostpointercapture. All state lives
 * inside this memoized component, so the canvas underneath never
 * re-renders mid-stroke.
 */
export const LaserLayer = memo(function LaserLayer({
  active,
  className,
  color = "#ef4444",
  zIndex = 30,
  svgRef,
  scrollHostRef,
}: {
  active: boolean;
  className?: string;
  color?: string;
  zIndex?: number;
  svgRef?: RefObject<SVGSVGElement | null>;
  /** When set, wheel forwards to the inner scroll container (JSON panes). */
  scrollHostRef?: RefObject<HTMLElement | null>;
}) {
  const [strokes, setStrokes] = useState<LaserStroke[]>([]);
  const [pencil, setPencil] = useState<LaserPoint | null>(null);
  const [now, setNow] = useState(0);
  const strokeId = useRef(0);
  /** Open group receiving points, or null between strokes. */
  const currentId = useRef<number | null>(null);
  const pending = useRef<LaserPoint[]>([]);
  const raf = useRef(0);
  const aliveRef = useRef(false);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const localRef = useRef<SVGSVGElement | null>(null);

  const setRefs = useCallback(
    (el: SVGSVGElement | null) => {
      localRef.current = el;
      if (svgRef) svgRef.current = el;
    },
    [svgRef]
  );

  // Fresh activation, fresh sheet.
  useEffect(() => {
    if (active) {
      setStrokes([]);
      setPencil(null);
      setNow(0);
      currentId.current = null;
      pending.current = [];
      aliveRef.current = false;
    } else {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
      setStrokes([]);
      setPencil(null);
    }
    scrollerRef.current = null;
  }, [active]);

  useEffect(
    () => () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    },
    []
  );

  // Melt clock: while any stroke is alive, tick the time and prune groups
  // older than the lifetime. Idle with no strokes: the loop spins but
  // writes nothing, so zero re-renders.
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      if (!aliveRef.current) return;
      const t = performance.now();
      setNow(t);
      setStrokes((prev) => {
        if (prev.length === 0) {
          aliveRef.current = false;
          return prev;
        }
        const next = prev.filter((s) => t - s.lastTouch < LASER_LIFETIME_MS);
        if (next.length === 0) aliveRef.current = false;
        return next.length === prev.length ? prev : next;
      });
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [active]);

  // Wheel scrolls the inner pane (JSON studio). ERD instead drives the
  // viewport itself through svgRef + its own native listener.
  useEffect(() => {
    const svg = localRef.current;
    if (!svg || !active || !scrollHostRef) return;
    const onWheel = (e: WheelEvent) => {
      if (!scrollerRef.current) scrollerRef.current = findScroller(scrollHostRef.current);
      const scroller = scrollerRef.current;
      if (!scroller) return;
      e.preventDefault();
      scroller.scrollTop += e.deltaY;
      scroller.scrollLeft += e.deltaX;
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [active, scrollHostRef]);

  const flush = useCallback(() => {
    raf.current = 0;
    const batch = pending.current;
    pending.current = [];
    if (batch.length === 0) return;
    const t = performance.now();
    let id = currentId.current;
    let fresh = false;
    if (id === null) {
      id = ++strokeId.current;
      currentId.current = id;
      fresh = true;
    }
    const strokeIdNow: number = id;
    aliveRef.current = true;
    setStrokes((prev) => {
      if (fresh || prev.length === 0 || prev[prev.length - 1].id !== strokeIdNow) {
        let pts: LaserPoint[] = [];
        for (const p of batch) pts = appendPoint(pts, p, LASER_MAX_PTS);
        return [...prev.slice(-(LASER_MAX_STROKES - 1)), { id: strokeIdNow, pts, lastTouch: t }];
      }
      const last = prev[prev.length - 1];
      let pts = last.pts;
      for (const p of batch) pts = appendPoint(pts, p, LASER_MAX_PTS);
      return [...prev.slice(0, -1), { ...last, pts, lastTouch: t }];
    });
  }, []);

  const queue = useCallback(
    (p: LaserPoint) => {
      pending.current.push(p);
      setPencil(p);
      if (!raf.current) raf.current = requestAnimationFrame(flush);
    },
    [flush]
  );

  const relPos = useCallback((clientX: number, clientY: number) => {
    const rect = localRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  /** Close the open group: its melt clock starts, the next move opens fresh. */
  const closeStroke = useCallback(() => {
    currentId.current = null;
  }, []);

  if (!active) return null;

  return (
    <svg
      ref={setRefs}
      className={className ?? "absolute inset-0 h-full w-full touch-none"}
      style={{ cursor: "none", zIndex }}
      onPointerDown={(e) => {
        // Capture the svg root itself: it never unmounts mid-gesture, unlike
        // a stroke polyline whose group can melt away underneath the pointer.
        try {
          e.currentTarget.setPointerCapture?.(e.pointerId);
        } catch {
          /* pointer already released - the move path still paints */
        }
        // Fresh stroke on every press - the previous group keeps melting.
        closeStroke();
        const natives: PointerEvent[] =
          typeof (e.nativeEvent as PointerEvent).getCoalescedEvents === "function"
            ? (e.nativeEvent as PointerEvent).getCoalescedEvents()
            : [e.nativeEvent as PointerEvent];
        for (const n of natives) queue(relPos(n.clientX, n.clientY));
      }}
      onPointerMove={(e) => {
        // Cursor always tracks; paint only while pressed (buttons held).
        // Hover roams free, release stops the trail, next press opens fresh.
        const p = relPos(e.clientX, e.clientY);
        setPencil(p);
        if (e.buttons !== 0) queue(p);
      }}
      onLostPointerCapture={(e) => {
        // Capture died mid-gesture (pressed element unmounted, browser took
        // over): grab it back onto the root while contact continues.
        try {
          if (e.buttons > 0) localRef.current?.setPointerCapture?.(e.pointerId);
        } catch {
          /* pointer gone - the move path still paints */
        }
      }}
      onPointerUp={() => {
        // Finger/button up ends the stroke for every pointer type; the
        // group melts on its own clock while the cursor keeps roaming.
        closeStroke();
      }}
      onPointerCancel={() => {
        // Gesture aborted: close the group, but the next move/d press opens
        // fresh - drawing is never wedged shut.
        closeStroke();
      }}
      onPointerLeave={() => {
        closeStroke();
        setPencil(null);
      }}
    >
      {pencil && (
        <g transform={`translate(${pencil.x} ${pencil.y}) rotate(45)`} pointerEvents="none">
          <rect x="-3" y="-19" width="6" height="12" rx="1" fill="#A98450" />
          <polygon points="-3,-7 3,-7 0,0" fill="#E8DCC8" />
          <circle cx="0" cy="-1.5" r="1.6" fill={color} />
        </g>
      )}
      {strokes.map((s) => (
        <g key={s.id} opacity={opacityForAge(now - s.lastTouch)}>
          <polyline
            points={s.pts.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {s.pts.length > 0 && (
            <circle cx={s.pts[s.pts.length - 1].x} cy={s.pts[s.pts.length - 1].y} r="5" fill={color} />
          )}
        </g>
      ))}
    </svg>
  );
});
