import type { SequenceDocument, SeqNode } from "./model";

/**
 * Mermaid export (EPIC 07): one-way projection of the interaction model
 * into `sequenceDiagram` text. Mermaid is an export format, never the
 * model - retry blocks become annotated rects, notes span the diagram.
 */

function arrowOf(kind: string): string {
  if (kind === "async") return "->>";
  if (kind === "response") return "-->";
  return "->";
}

export function toMermaid(doc: SequenceDocument): string {
  const L = ["sequenceDiagram", `autonumber`];
  for (const p of doc.participants) {
    L.push(`participant ${p.name}`);
  }
  const names = new Map(doc.participants.map((p) => [p.id, p.name]));
  const nm = (ref: string) => names.get(ref) ?? ref;
  const first = doc.participants[0]?.name ?? "A";
  const last = doc.participants[doc.participants.length - 1]?.name ?? "B";

  const walk = (list: SeqNode[]) => {
    for (const n of list) {
      if (n.nodeType === "message") {
        const label = n.label.replace(/[#;]/g, "");
        L.push(`${nm(n.from)}${arrowOf(n.kind)}${nm(n.to)}: ${label || "call"}`);
      } else if (n.type === "note") {
        L.push(`Note over ${first},${last}: ${n.title.replace(/[#;]/g, "")}`);
      } else if (n.type === "loop") {
        L.push(`loop ${n.iterator ?? n.title}`.trimEnd());
        walk(n.children);
        L.push("end");
      } else if (n.type === "condition") {
        L.push(`alt ${n.condition ?? n.title}`.trimEnd());
        walk(n.children);
        if ((n.elseChildren ?? []).length > 0) {
          L.push(`else ${n.elseLabel ?? ""}`.trimEnd());
          walk(n.elseChildren ?? []);
        }
        L.push("end");
      } else if (n.type === "parallel") {
        L.push(`par ${n.title}`.trimEnd());
        walk(n.children);
        L.push("end");
      } else if (n.type === "retry") {
        L.push(`rect rgba(201, 168, 106, 0.15)`);
        L.push(`%% retry ${n.attempts ?? 3}x${n.waitSecs ? ` wait ${n.waitSecs}s` : ""}${n.title ? ` - ${n.title}` : ""}`);
        walk(n.children);
        L.push("end");
      }
    }
  };
  walk(doc.nodes);
  return L.join("\n");
}

/**
 * Mermaid import (Phase 4): the inverse of toMermaid. Translates the
 * `sequenceDiagram` subset we emit - plus hand-written diagrams in the
 * same shape - back into our DSL, which stays the validated model.
 * Styling-only lines (rect, autonumber) drop silently; anything
 * unrecognized survives as a `#` comment so no input line vanishes.
 */
export function mermaidToDsl(text: string): string {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m: RegExpMatchArray | null;
    if (/^sequenceDiagram\b/i.test(line) || /^autonumber\b/i.test(line) || /^rect\b/i.test(line)) continue;
    if ((m = /^%%\s*retry\s*(.*)$/i.exec(line))) {
      const rest = (m[1] ?? '').trim();
      const am = /^(\d+)x\b\s*(.*)$/.exec(rest);
      const wm = /^wait\s+(\d+(?:\.\d+)?)s?\b\s*-?\s*(.*)$/i.exec(am ? am[2] : rest);
      const attempts = am ? am[1] : "";
      const wait = wm ? wm[1] : "";
      const title = (wm ? wm[2] : am ? am[2] : rest).replace(/^-\s*/, "").trim();
      out.push(`retry${attempts ? ` ${attempts} times` : ""}${wait ? ` wait ${wait}s` : ""}${title ? ` ${title}` : ""}`.trimEnd() || "retry");
      continue;
    }
    if (line.startsWith("%%")) {
      out.push(`# ${line.slice(2).trim()}`);
      continue;
    }
    if ((m = /^participant\s+(\S+)(?:\s+as\s+(.+))?$/i.exec(line))) {
      out.push(`participant ${(m[2] ?? m[1]).trim()}`);
      continue;
    }
    if ((m = /^note\s+over\s+[^:]+:\s*(.*)$/i.exec(line))) {
      out.push(`note ${m[1].trim()}`);
      continue;
    }
    if ((m = /^loop\s*(.*)$/i.exec(line))) {
      out.push(`loop ${m[1].trim()}`.trimEnd());
      continue;
    }
    if ((m = /^alt\s*(.*)$/i.exec(line)) || (m = /^opt\s+(.+?)\s*$/i.exec(line))) {
      out.push(`if ${m[1].trim()}`);
      continue;
    }
    if (/^opt\s*$/i.test(line)) { out.push("if case"); continue; }
    if ((m = /^else(?:\s+(.+?))?\s*$/i.exec(line))) {
      out.push(m[1] ? `else ${m[1].trim()}` : "else");
      continue;
    }
    if ((m = /^par\s*(.*)$/i.exec(line))) {
      out.push(`parallel ${m[1].trim()}`.trimEnd() || "parallel");
      continue;
    }
    if (/^end\s*$/i.test(line)) { out.push("end"); continue; }
    if ((m = /^(.+?)\s*(-->>|-->|->>|->)\s*(.+?)\s*:\s*(.*)$/.exec(line))) {
      const op = m[2] === "-->>" ? "-->" : m[2];
      out.push(`${m[1].trim()} ${op} ${m[3].trim()}: ${m[4].trim()}`);
      continue;
    }
    out.push(`# mermaid skipped: ${line}`);
  }
  return out.join("\n");
}
