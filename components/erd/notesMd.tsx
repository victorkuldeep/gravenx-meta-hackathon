"use client";

import type { ReactNode } from "react";

/**
 * Markdown-lite for design notes: headings, bold/italic, inline code, code
 * fences, bullets, numbered lists, task checkboxes (clickable - writes back
 * `- [x]`), rules, paragraphs. Zero deps, safe by construction (no HTML passthrough).
 */

function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // code, bold, italic - in that precedence
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      out.push(
        <code key={`${keyPrefix}-${k++}`} className="rounded bg-ivory-200 px-1 font-mono text-[11px] text-ivory-900">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("**")) {
      out.push(<strong key={`${keyPrefix}-${k++}`}>{tok.slice(2, -2)}</strong>);
    } else {
      out.push(<em key={`${keyPrefix}-${k++}`}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdownLite(
  md: string,
  onToggleTask?: (lineIndex: number) => void
): ReactNode[] {
  const lines = md.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      out.push(
        <pre key={k++} className="overflow-x-auto rounded-lg bg-ivory-950 p-2.5 font-mono text-[11px] leading-relaxed text-ivory-100">
          {buf.join("\n")}
        </pre>
      );
      continue;
    }
    // headings
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls =
        level === 1
          ? "text-sm font-bold text-ivory-950"
          : level === 2
            ? "text-[13px] font-bold text-ivory-950"
            : "text-xs font-bold text-ivory-900";
      out.push(
        <p key={k++} className={`${cls} mt-2 first:mt-0`}>
          {inline(h[2], `h${k}`)}
        </p>
      );
      i++;
      continue;
    }
    // rule
    if (/^---+$/.test(line.trim())) {
      out.push(<hr key={k++} className="my-2 border-[var(--color-line)]" />);
      i++;
      continue;
    }
    // task list
    const task = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (task) {
      const checked = task[2].toLowerCase() === "x";
      const idx = i;
      out.push(
        <label key={k++} className="flex cursor-pointer items-start gap-1.5 py-0.5 text-xs text-ivory-900">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => onToggleTask?.(idx)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-bronze-600"
          />
          <span className={checked ? "line-through text-ivory-500" : ""}>{inline(task[3], `t${k}`)}</span>
        </label>
      );
      i++;
      continue;
    }
    // bullets
    if (/^(\s*)[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^(\s*)[-*]\s+/.test(lines[i]) && !/^(\s*)[-*]\s+\[[ xX]\]/.test(lines[i])) {
        buf.push(lines[i].replace(/^(\s*)[-*]\s+/, ""));
        i++;
      }
      out.push(
        <ul key={k++} className="list-disc space-y-0.5 py-0.5 pl-5 text-xs text-ivory-900">
          {buf.map((b, bi) => (
            <li key={bi}>{inline(b, `b${k}-${bi}`)}</li>
          ))}
        </ul>
      );
      continue;
    }
    // numbered
    if (/^(\s*)\d+[.)]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^(\s*)\d+[.)]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^(\s*)\d+[.)]\s+/, ""));
        i++;
      }
      out.push(
        <ol key={k++} className="list-decimal space-y-0.5 py-0.5 pl-5 text-xs text-ivory-900">
          {buf.map((b, bi) => (
            <li key={bi}>{inline(b, `o${k}-${bi}`)}</li>
          ))}
        </ol>
      );
      continue;
    }
    // blank
    if (line.trim() === "") {
      i++;
      continue;
    }
    // paragraph (fold soft wraps)
    const buf = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3}\s|```|---+\s*$|(\s*)[-*]\s|(\s*)\d+[.)]\s)/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(
      <p key={k++} className="py-0.5 text-xs leading-relaxed text-ivory-900">
        {inline(buf.join(" "), `p${k}`)}
      </p>
    );
  }
  return out;
}

/** Flip the task checkbox on the given 0-based line. No-op when not a task line. */
export function toggleTaskLine(md: string, lineIndex: number): string {
  const lines = md.split("\n");
  const line = lines[lineIndex];
  if (!line) return md;
  const m = /^(\s*[-*]\s+\[)([ xX])(\]\s+.*)$/.exec(line);
  if (!m) return md;
  lines[lineIndex] = `${m[1]}${m[2] === " " ? "x" : " "}${m[3]}`;
  return lines.join("\n");
}
