"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { parseJsonInput, formatJson, formatBytes } from "@/lib/json/studio";
import { buildDocument } from "@/lib/json/document";
import { VanillaEditor } from "./VanillaEditor";
import { JsonGraph } from "./JsonGraph";
import { LaserButton, LaserOverlay, useLaser } from "./LaserOverlay";
import Button from "../ui/Button";

/** Single-pane JSON editor: paste, validate, tree/text edit, copy/download. */
export function JsonEditorPane() {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<object | null>(null);
  const [loadId, setLoadId] = useState(0);
  const [live, setLive] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(true);
  const [view, setView] = useState<"editor" | "graph">("editor");
  const [reveal, setReveal] = useState<{ path: (string | number)[]; nonce: number } | null>(null);
  const [laser, setLaser] = useState(false);
  const laserHostRef = useRef<HTMLDivElement>(null);
  const graphHostRef = useRef<HTMLDivElement>(null);
  useLaser(laser, setLaser);

  // One-shot handoff from the Validate workspace (payload + finding path).
  // Additive: no-ops when no handoff is pending.
  useEffect(() => {
    try {
      const rawHandoff = sessionStorage.getItem("sf_json_handoff");
      if (!rawHandoff) return;
      sessionStorage.removeItem("sf_json_handoff");
      const handoff = JSON.parse(rawHandoff) as { text?: string; path?: (string | number)[] | null };
      if (typeof handoff.text !== "string" || !handoff.text.trim()) return;
      const r = parseJsonInput(handoff.text);
      if (!r.ok) {
        setRaw(handoff.text);
        setError(r.error);
        return;
      }
      setError(null);
      setRaw(handoff.text);
      setDoc(r.value as object);
      setLive(r.value);
      setLoadId((n) => n + 1);
      setSourceOpen(false);
      if (Array.isArray(handoff.path)) {
        setReveal({ path: handoff.path, nonce: Date.now() });
      }
    } catch {
      /* handoff unavailable - start empty */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = () => {
    const r = parseJsonInput(raw);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    setDoc(r.value as object);
    setLive(r.value);
    setLoadId((n) => n + 1);
    setSourceOpen(false);
  };

  const current = live ?? doc;
  const size = current ? formatBytes(new Blob([formatJson(current)]).size) : null;
  const graphDoc = useMemo(() => (current ? buildDocument(current) : null), [current]);

  const copy = async () => {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(formatJson(current));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const download = () => {
    if (!current) return;
    const blob = new Blob([formatJson(current)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "document.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`grid items-start gap-4 ${sourceOpen ? "lg:grid-cols-[320px_minmax(0,1fr)]" : "lg:grid-cols-[44px_minmax(0,1fr)]"}`}>
      <div className="rounded-xl border border-[#E8E2D8] bg-white p-3">
        {sourceOpen ? (
          <>
            <button
              type="button"
              onClick={() => setSourceOpen(false)}
              aria-expanded={true}
              title="Collapse source panel sideways"
              className="mb-1.5 flex w-full cursor-pointer items-center gap-1.5 text-left"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                aria-hidden="true"
                className="shrink-0 text-[#A39B8E] transition-transform"
              >
                <path d="m14 6-6 6 6 6" />
              </svg>
              <span className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">
                Source
              </span>
              {size && (
                <span className="ml-auto font-mono text-[11px] text-[#A39B8E]">{size}</span>
              )}
            </button>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder='Paste JSON here… {"allOrNone": true, …}'
              rows={12}
              spellCheck={false}
              className="w-full rounded-lg border border-[#E8E2D8] p-2 font-mono text-xs focus:border-[#A98450] focus:outline-none"
            />
            {error && (
              <p className="mt-1.5 rounded-lg border border-red-300 bg-red-50 px-2 py-1.5 font-mono text-[11px] text-red-700" role="alert">
                {error}
              </p>
            )}
            <div className="mt-2 flex gap-1.5">
              <Button size="sm" onClick={load} disabled={raw.trim() === ""}>
                Load into editor
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setRaw(""); setError(null); }}>
                Clear
              </Button>
            </div>
            {size && <p className="mt-2 font-mono text-[11px] text-[#A39B8E]">{size} · tree/text via editor menu</p>}
          </>
        ) : (
          <button
            type="button"
            onClick={() => setSourceOpen(true)}
            aria-expanded={false}
            title="Expand source panel"
            className="flex w-full cursor-pointer flex-col items-center gap-2 py-1"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              aria-hidden="true"
              className="shrink-0 text-[#A39B8E]"
            >
              <path d="m10 6 6 6-6 6" />
            </svg>
            <span className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]" style={{ writingMode: "vertical-rl" }}>
              Source
            </span>
          </button>
        )}
      </div>

      <div>
        {!doc ? (
          <div className="rounded-xl border border-[#E8E2D8] bg-[#FBF8F1] px-6 py-10 text-center">
            <svg width="360" height="168" viewBox="0 0 360 168" fill="none" aria-hidden="true" className="mx-auto h-auto w-full max-w-[360px]">
              <ellipse cx="180" cy="84" rx="128" ry="62" stroke="#E3D9C6" strokeWidth="1.5" strokeDasharray="5 6" />
              <ellipse cx="180" cy="84" rx="88" ry="40" stroke="#EFE7D6" strokeWidth="1.5" />
              <line x1="180" y1="84" x2="52" y2="34" stroke="#C9A86A" strokeWidth="1.5" />
              <line x1="180" y1="84" x2="308" y2="34" stroke="#C9A86A" strokeWidth="1.5" />
              <line x1="180" y1="84" x2="52" y2="134" stroke="#C9A86A" strokeWidth="1.5" />
              <line x1="180" y1="84" x2="308" y2="134" stroke="#C9A86A" strokeWidth="1.5" />
              <circle cx="52" cy="34" r="17" fill="#FFFFFF" stroke="#9A7653" strokeWidth="1.5" />
              <circle cx="308" cy="34" r="17" fill="#FFFFFF" stroke="#9A7653" strokeWidth="1.5" />
              <circle cx="52" cy="134" r="17" fill="#FFFFFF" stroke="#9A7653" strokeWidth="1.5" />
              <circle cx="308" cy="134" r="17" fill="#FFFFFF" stroke="#9A7653" strokeWidth="1.5" />
              <text x="52" y="39" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="13" fontWeight="700" fill="#7A5C3A">[ ]</text>
              <text x="308" y="39" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="13" fontWeight="700" fill="#7A5C3A">{"{ }"}</text>
              <text x="52" y="139" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="13" fontWeight="700" fill="#7A5C3A">01</text>
              <text x="308" y="139" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="13" fontWeight="700" fill="#7A5C3A">{"\" \""}</text>
              <rect x="148" y="52" width="64" height="64" rx="16" fill="#FFFFFF" stroke="#9A7653" strokeWidth="2" />
              <circle cx="180" cy="60" r="3" fill="#C9A86A" />
              <text x="180" y="99" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="22" fontWeight="700" fill="#27241F">{"{;}"}</text>
              <circle cx="180" cy="22" r="2.5" fill="#C9A86A" />
              <circle cx="180" cy="146" r="2.5" fill="#C9A86A" />
              <circle cx="322" cy="84" r="2.5" fill="#C9A86A" />
              <circle cx="38" cy="84" r="2.5" fill="#C9A86A" />
            </svg>
            <p className="mt-4 text-base font-bold text-[#27241F]">No document loaded</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-[#777168]">
              Paste JSON on the left and load it - then browse, collapse, search and edit every node.
            </p>
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
              Browse · Collapse · Search · Edit
            </p>
          </div>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <div className="flex rounded-lg border border-[#E8E2D8] overflow-hidden" role="tablist" aria-label="Editor view">
                {(["editor", "graph"] as const).map((v) => (
                  <button
                    key={v}
                    role="tab"
                    aria-selected={view === v}
                    onClick={() => setView(v)}
                    className={`px-3 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                      view === v ? "bg-[#211F1B] text-white" : "bg-white text-[#777168] hover:text-[#27241F]"
                    }`}
                  >
                    {v === "editor" ? "Editor" : "Graph"}
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={copy}>{copied ? "Copied" : "Copy formatted"}</Button>
              <Button variant="ghost" size="sm" onClick={download}>Download</Button>
              <LaserButton active={laser} onToggle={() => setLaser((v) => !v)} />
            </div>
            {view === "editor" || !graphDoc ? (
              <div ref={laserHostRef} className="relative">
                <VanillaEditor
                  key={loadId}
                  value={doc}
                  onChange={setLive}
                  reveal={reveal}
                />
                <LaserOverlay active={laser && view === "editor"} hostRef={laserHostRef} />
              </div>
            ) : (
              <div ref={graphHostRef} className="relative">
                <JsonGraph
                  doc={graphDoc}
                  onRevealInTree={(path) => {
                    setReveal({ path, nonce: Date.now() });
                    setView("editor");
                  }}
                />
                <LaserOverlay active={laser} hostRef={graphHostRef} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
