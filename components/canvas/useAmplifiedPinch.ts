import { useEffect, type RefObject } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import {
  DEFAULT_PINCH_AMPLIFICATION,
  DEFAULT_WHEEL_COEFFICIENT,
  scaleForTouchRatio,
  scaleForWheelDelta,
  zoomAtPoint,
} from "@/lib/canvas/pinchZoom";

interface AmplifiedPinchOptions {
  instanceRef: RefObject<ReactFlowInstance | null>;
  minZoom?: number;
  maxZoom?: number;
  /** Exponent on the gesture ratio (touch). 4 ≈ four times the native feel. */
  amplification?: number;
  /** Per-deltaY coefficient (trackpad). Native ≈ 0.002, ours quadrupled. */
  wheelCoefficient?: number;
}

/**
 * Bigger-feel pinch zoom for trackpads (ctrl/meta+wheel) and touch screens
 * (two-finger spread). Attach to the div wrapping <ReactFlow> and set
 * zoomOnPinch={false} on the canvas so the native 1x handler never
 * double-applies. Plain wheel scroll still pans (panOnScroll); single-finger
 * drag still pans. Zoom anchors at the gesture point and respects bounds.
 */
export function useAmplifiedPinch(
  wrapRef: RefObject<HTMLDivElement | null>,
  {
    instanceRef,
    minZoom = 0.15,
    maxZoom = 4,
    amplification = DEFAULT_PINCH_AMPLIFICATION,
    wheelCoefficient = DEFAULT_WHEEL_COEFFICIENT,
  }: AmplifiedPinchOptions
): void {
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const zoomAt = (clientX: number, clientY: number, nextZoom: number): void => {
      const rf = instanceRef.current;
      if (!rf) return;
      const vp = rf.getViewport();
      const rect = el.getBoundingClientRect();
      const next = zoomAtPoint(
        vp,
        clientX - rect.left,
        clientY - rect.top,
        nextZoom,
        minZoom,
        maxZoom,
      );
      if (next.zoom === vp.zoom) return;
      rf.setViewport(next);
    };

    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      e.stopPropagation();
      const rf = instanceRef.current;
      if (!rf) return;
      zoomAt(e.clientX, e.clientY, rf.getViewport().zoom * scaleForWheelDelta(e.deltaY, wheelCoefficient));
    };

    let gesture: { startDist: number; zoom: number } | null = null;
    const pairDist = (t: TouchList): number =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 2) {
        gesture = null;
        return;
      }
      // Capture-phase + stop: ReactFlow's own handlers (on the pane below)
      // never see the two-finger gesture, so nothing double-applies.
      e.stopPropagation();
      const rf = instanceRef.current;
      if (!rf) return;
      gesture = { startDist: Math.max(1, pairDist(e.touches)), zoom: rf.getViewport().zoom };
    };
    const onTouchMove = (e: TouchEvent): void => {
      if (!gesture || e.touches.length !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      const rf = instanceRef.current;
      if (!rf) return;
      const ratio = pairDist(e.touches) / gesture.startDist;
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomAt(midX, midY, gesture.zoom * scaleForTouchRatio(Math.max(0.01, ratio), amplification));
    };
    const endTouch = (e: TouchEvent): void => {
      if (e.touches.length < 2) gesture = null;
    };

    el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false, capture: true });
    el.addEventListener("touchend", endTouch);
    el.addEventListener("touchcancel", endTouch);
    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true });
      el.removeEventListener("touchstart", onTouchStart, { capture: true });
      el.removeEventListener("touchmove", onTouchMove, { capture: true });
      el.removeEventListener("touchend", endTouch);
      el.removeEventListener("touchcancel", endTouch);
    };
  }, [wrapRef, instanceRef, minZoom, maxZoom, amplification, wheelCoefficient]);
}
