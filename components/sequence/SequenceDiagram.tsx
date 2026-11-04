"use client";

import { useMemo } from "react";
import { layoutSequence, SIDE_PAD } from "@/lib/sequence/layout";
import { resolveParticipant, type SequenceDocument } from "@/lib/sequence/model";

/**
 * Sequence diagram (EPIC 02): deterministic SVG projection of the
 * interaction model. Draws exactly what layoutSequence computes -
 * lifelines, arrows, block frames. Selection is a view concern.
 */

const INK = "#27241F";
const MUTED = "#A39B8E";
const BRONZE = "#9A7653";
const GOLD = "#C9A86A";

const FRAME_BG = "#FDFBF6";

export function SequenceDiagram({
  doc,
  selectedId,
  onSelect,
}: {
  doc: SequenceDocument;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const layout = useMemo(() => layoutSequence(doc.participants, doc.nodes), [doc]);
  const colX = useMemo(() => new Map(layout.columns.map((c) => [c.id, c.x])), [layout]);

  const msgX = (ref: string): number | null => {
    const p = resolveParticipant(doc, ref);
    return p ? (colX.get(p.id) ?? null) : null;
  };

  return (
    <svg
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={`Sequence diagram for ${doc.name}`}
      className="block bg-white"
    >
      <defs>
        <marker id="seq-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
          <path d="M0 0 L8 4.5 L0 9" fill="none" stroke={BRONZE} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
        <marker id="seq-async" markerWidth="13" markerHeight="9" refX="11" refY="4.5" orient="auto">
          <path d="M0 0 L6 4.5 L0 9 M5 0 L11 4.5 L5 9" fill="none" stroke={BRONZE} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>

      {/* Lifelines + participant headers */}
      {layout.columns.map((c) => (
        <g key={c.id}>
          <line x1={c.x} y1={46} x2={c.x} y2={layout.height - 12} stroke="#D8CFBB" strokeWidth="1.5" strokeDasharray="6 4" />
          <rect x={c.x - 80} y={8} width={160} height={30} rx={15} fill="#27241F" />
          <text x={c.x} y={27} textAnchor="middle" fontSize="11" fontWeight="700" fill="#F5F1E8">
            {c.name.length > 22 ? `${c.name.slice(0, 21)}…` : c.name}
          </text>
          <text x={c.x} y={60} textAnchor="middle" fontSize="9" fill={MUTED} fontFamily="ui-monospace, monospace">
            {c.kind}
          </text>
        </g>
      ))}

      {/* Block frames (behind messages) */}
      {layout.frames.map((f) => {
        const x0 = SIDE_PAD / 2 + f.depth * 8;
        const x1 = layout.width - SIDE_PAD / 2 - f.depth * 8;
        const sel = selectedId === f.id;
        return (
          <g key={f.id} onClick={() => onSelect?.(f.id)} className={onSelect ? "cursor-pointer" : undefined}>
            <rect
              x={x0} y={f.y0} width={x1 - x0} height={f.y1 - f.y0}
              rx={8} fill={FRAME_BG} stroke={sel ? BRONZE : GOLD} strokeWidth={sel ? 2 : 1.2}
            />
            <rect x={x0} y={f.y0} width={Math.min(x1 - x0, f.title.length * 7 + 28)} height={20} rx={6} fill={sel ? BRONZE : "#EFE7D6"} />
            <text x={x0 + 10} y={f.y0 + 14} fontSize="10" fontWeight="700" fill={sel ? "#FFFFFF" : INK} fontFamily="ui-monospace, monospace">
              {(f.title || f.type).slice(0, 40)}
            </text>
            {f.empty && (
              <text x={x0 + 10} y={f.y0 + 36} fontSize="10" fontStyle="italic" fill={MUTED}>
                empty — click the statements and type messages between the opener and end
              </text>
            )}
          </g>
        );
      })}

      {/* Rows */}
      {layout.rows.map((row, i) => {
        if (row.kind === "block-start" || row.kind === "block-end") return null;
        if (row.kind === "block-else") {
          const b = row.node;
          if (b.nodeType !== "block") return null;
          return (
            <g key={`r${i}`}>
              <line x1={SIDE_PAD / 2} y1={row.y + 15} x2={layout.width - SIDE_PAD / 2} y2={row.y + 15} stroke={GOLD} strokeWidth="1" strokeDasharray="4 3" />
              <text x={SIDE_PAD / 2 + 10} y={row.y + 11} fontSize="10" fontWeight="700" fill={MUTED} fontFamily="ui-monospace, monospace">
                ELSE{b.elseLabel ? ` - ${b.elseLabel.slice(0, 40)}` : ""}
              </text>
            </g>
          );
        }
        if (row.kind === "note") {
          const b = row.node;
          if (b.nodeType !== "block") return null;
          const sel = selectedId === b.id;
          return (
            <g key={`r${i}`} onClick={() => onSelect?.(b.id)} className={onSelect ? "cursor-pointer" : undefined}>
              <rect x={SIDE_PAD} y={row.y + 4} width={layout.width - SIDE_PAD * 2} height={34} rx={6} fill="#F5F1E8" stroke={sel ? BRONZE : "#E3D9C6"} strokeWidth={sel ? 2 : 1} />
              <text x={SIDE_PAD + 12} y={row.y + 26} fontSize="11" fill={INK}>
                ✎ {(b.title || "Note").slice(0, 90)}
              </text>
            </g>
          );
        }
        const m = row.node;
        if (m.nodeType !== "message") return null;
        const x1 = msgX(m.from);
        const x2 = msgX(m.to);
        if (x1 == null || x2 == null) return null;
        const sel = selectedId === m.id;
        const ly = row.y + 28;
        const dashed = m.kind === "response";
        const marker = m.kind === "async" ? "url(#seq-async)" : "url(#seq-arrow)";
        const self = x1 === x2;
        return (
          <g key={`r${i}`} onClick={() => onSelect?.(m.id)} className={onSelect ? "cursor-pointer" : undefined}>
            <text x={self ? x1 + 8 : Math.min(x1, x2) + 4} y={row.y + 14} fontSize="11" fill={sel ? BRONZE : INK} fontWeight={sel ? 700 : 400}>
              {(m.label || "unlabeled").slice(0, 60)}
              {m.retry ? <tspan fill={MUTED} fontSize="10">{` ↻${m.retry.attempts}×`}</tspan> : null}
            </text>
            {self ? (
              <path d={`M ${x1} ${ly} h 34 v 14 h -27`} fill="none" stroke={BRONZE} strokeWidth="1.6" markerEnd="url(#seq-arrow)" strokeDasharray={dashed ? "5 3" : undefined} />
            ) : (
              <line x1={x1} y1={ly} x2={x2} y2={ly} stroke={BRONZE} strokeWidth={sel ? 2.4 : 1.6} markerEnd={marker} strokeDasharray={dashed ? "5 3" : undefined} />
            )}
          </g>
        );
      })}

      {layout.rows.length === 0 && (
        <text x={layout.width / 2} y={layout.height / 2} textAnchor="middle" fontSize="12" fill={MUTED}>
          No interactions yet - describe them in the statement editor.
        </text>
      )}
    </svg>
  );
}
