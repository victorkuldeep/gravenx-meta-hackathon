"use client";

import { memo } from "react";
import {
  EdgeLabelRenderer,
  getBezierPath,
  Position,
  type EdgeProps,
} from "@xyflow/react";

const STROKE = "#8A8070";
/** Clicked relationship: deep burgundy, unmistakable at any zoom. */
const STROKE_LINKED = "#722F37";

function dirFor(pos: Position): { x: number; y: number } {
  if (pos === Position.Right) return { x: 1, y: 0 };
  if (pos === Position.Left) return { x: -1, y: 0 };
  if (pos === Position.Top) return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

/**
 * ERD relationship edge in crow's foot notation: parallel double bar at the
 * "one" (parent) end, hollow circle + three-line fan at the "many" end.
 * Glyphs are drawn from handle geometry (no marker refs) so they stay crisp
 * on curves; solid = master-detail, dotted = lookup.
 */
function ErdEdgeInner({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  selected,
  data,
}: EdgeProps) {
  // Self-lookup: hug the node's own left flank, header-left → footer-left.
  // Stacked loops stagger outward in lanes so they never share one path.
  const isLoop = source === target;
  const lane = (data as { loopLane?: number } | undefined)?.loopLane ?? 0;
  const LOOP = 44 + lane * 26;
  // Direction of travel at each end (drives the 1-bar / crow's-foot glyphs)
  const sd = isLoop ? { x: -1, y: 0 } : dirFor(sourcePosition);
  const td = isLoop
    ? { x: 1, y: 0 }
    : { x: -dirFor(targetPosition).x, y: -dirFor(targetPosition).y };
  const sp = { x: -sd.y, y: sd.x };
  const tp = { x: -td.y, y: td.x };
  // Glyph runway: the main line stops short of the box so the crow's foot
  // owns the last stretch - nothing grazes tangentially, nothing overlaps.
  // Clamped for stubby edges so the path can never invert.
  const span = Math.hypot(targetX - sourceX, targetY - sourceY);
  const TRIM = Math.min(12, span * 0.3);
  const tX = targetX - td.x * TRIM;
  const tY = targetY - td.y * TRIM;
  const bezier = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX: tX,
    targetY: tY,
    targetPosition,
  });
  const path = isLoop
    ? `M ${sourceX},${sourceY} C ${sourceX - LOOP},${sourceY} ${targetX - LOOP},${targetY} ${tX},${tY}`
    : bezier[0];
  const labelX = isLoop ? sourceX - LOOP * 0.55 : bezier[1];
  // Stacked loop labels step upward per lane so pills never collide.
  const labelY = isLoop ? (sourceY + targetY) / 2 - lane * 30 : bezier[2];

  // "One" end: parallel double bar across the line at the source end.
  // "Many" end: hollow circle (optional) + three-line crow's foot fanning
  // back from behind the circle. Glyphs stay solid even on dotted lookups.
  const BAR_HALF = 5;
  const BAR_GAP = 4;
  const tick = (bx: number, by: number) =>
    `M ${bx + sp.x * BAR_HALF},${by + sp.y * BAR_HALF} L ${bx - sp.x * BAR_HALF},${by - sp.y * BAR_HALF}`;
  const bar = `${tick(sourceX, sourceY)} ${tick(sourceX - sd.x * BAR_GAP, sourceY - sd.y * BAR_GAP)}`;

  // Crow's foot at the target end, drawn in the cleared runway: the main
  // line touches the circle's outer boundary, then three prongs exit the
  // far side - the middle one diametrically straight through to the box
  // edge, the other two flanking left and right. Feet land on the table.
  const CIRCLE_R = 4;
  const cc = { x: tX - td.x * CIRCLE_R, y: tY - td.y * CIRCLE_R };
  const FAN_HALF = 6;
  const foot = (side: number) => ({
    x: targetX + tp.x * side,
    y: targetY + tp.y * side,
  });
  const f1 = foot(FAN_HALF);
  const f2 = foot(0);
  const f3 = foot(-FAN_HALF);
  const fan = `M ${cc.x},${cc.y} L ${f1.x},${f1.y} M ${cc.x},${cc.y} L ${f2.x},${f2.y} M ${cc.x},${cc.y} L ${f3.x},${f3.y}`;

  // Solid = master-detail, dotted = lookup (kind travels in edge data).
  // Pending authoring sketches render amber + finely dashed.
  const edgeData = (data as { kind?: string; pending?: boolean } | undefined) ?? {};
  const isMd = edgeData.kind === "md";
  const pending = edgeData.pending === true;
  const stroke = pending ? "#B45309" : selected ? STROKE_LINKED : STROKE;
  const lineWidth = selected ? 2.4 : isMd ? 2 : 1.5;
  const dash = pending ? "4 3" : isMd ? undefined : "7 5";

  return (
    <>
      {/* Wide invisible hit-path so thin curves are easy to click */}
      <path d={path} fill="none" stroke="transparent" strokeWidth={16} style={{ pointerEvents: "stroke" }} />
      <path
        id={id}
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={lineWidth}
        strokeDasharray={dash}
      />
      <path d={bar} stroke={stroke} strokeWidth={2} strokeLinecap="round" />
      <circle cx={cc.x} cy={cc.y} r={CIRCLE_R} fill="#FAF8F2" stroke={stroke} strokeWidth={1.5} />
      <path d={fan} stroke={stroke} strokeWidth={1.5} strokeLinecap="round" fill="none" />
      {selected && label != null && String(label) !== "" && (
        <EdgeLabelRenderer>
          <div
            className="rounded border border-[#722F37] bg-white px-1.5 py-px font-mono text-[10px] font-semibold text-[#722F37] shadow-sm"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
          >
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const ErdEdge = memo(ErdEdgeInner);
