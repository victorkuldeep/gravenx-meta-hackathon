"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { highlightIndexes, renderJsonLines } from "@/lib/mapping/jsonView";

function Tint({ text }: { text: string }) {
  const m = /^(\s*)("[^"]*": )?([\s\S]*)$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      {m[1]}
      {m[2] && <span className="text-[#722F37]">{m[2]}</span>}
      <span className="text-[#4E342E]">{m[3]}</span>
    </>
  );
}

/**
 * Minimized-by-default sample JSON reference. One click opens it; the
 * selected catalog path scrolls into view and highlights, so repeated
 * key names stay anchored to their values while mapping.
 */
export function SourceJsonViewer({
  text,
  selected,
  onSelectPath,
}: {
  text: string | undefined;
  selected: string | null;
  onSelectPath: (pathId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const lineRefs = useRef(new Map<number, HTMLDivElement>());

  const parsed = useMemo(() => {
    if (!text?.trim()) return { ok: false as const };
    try {
      return { ok: true as const, value: JSON.parse(text) as unknown };
    } catch {
      return { ok: false as const };
    }
  }, [text]);

  const { lines, truncated } = useMemo(
    () => (parsed.ok ? renderJsonLines(parsed.value) : { lines: [], truncated: false }),
    [parsed]
  );
  const hits = useMemo(() => highlightIndexes(lines, selected), [lines, selected]);
  const firstHit = useMemo(() => (hits.size > 0 ? Math.min(...hits) : -1), [hits]);

  useEffect(() => {
    if (open && firstHit >= 0) {
      lineRefs.current.get(firstHit)?.scrollIntoView({ block: "nearest" });
    }
  }, [open, firstHit]);

  if (!text?.trim()) return null;

  return (
    <div className="mt-3 rounded-xl border border-[#F0EBE0]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? "Minimize the sample" : "Show the sample JSON beside the tree"}
        className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-[#FAF8F2]"
      >
        <span className="font-mono text-[10px] text-[#A39B8E]">{open ? "▾" : "▸"}</span>
        <span className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Sample JSON</span>
        <span className="ml-auto font-mono text-[10px] text-[#A39B8E]">
          {parsed.ok ? `${lines.length} lines` : "unparseable"}
        </span>
      </button>
      {open && (
        <div className="border-t border-[#F0EBE0]">
          {parsed.ok ? (
            <>
              <div className="max-h-[380px] overflow-auto p-2" role="log" aria-label="Source sample JSON">
                {lines.map((line, i) => {
                  const active = hits.has(i);
                  return (
                    <div
                      key={i}
                      ref={(el) => {
                        if (el) lineRefs.current.set(i, el);
                        else lineRefs.current.delete(i);
                      }}
                      onClick={() => line.pathId && onSelectPath(line.pathId)}
                      title={line.pathId ?? undefined}
                      className={`whitespace-pre rounded px-2 font-mono text-[11px] leading-[1.55] ${
                        line.pathId ? "cursor-pointer" : ""
                      } ${active ? "bg-[#FAF3E3] outline outline-1 outline-[#A98450]" : "hover:bg-[#FAF8F2]"}`}
                    >
                      <Tint text={line.text} />
                    </div>
                  );
                })}
              </div>
              {truncated && (
                <p className="border-t border-[#F0EBE0] px-3 py-1.5 text-[10px] text-[#A39B8E]">
                  Long sample - view capped for readability. The full text stays preserved in the project.
                </p>
              )}
              <p className="border-t border-[#F0EBE0] px-3 py-1.5 text-[10px] text-[#A39B8E]">
                Click any line to select that path in the tree above.
              </p>
            </>
          ) : (
            <pre className="max-h-[380px] overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] text-[#4E342E]">{text}</pre>
          )}
        </div>
      )}
    </div>
  );
}
