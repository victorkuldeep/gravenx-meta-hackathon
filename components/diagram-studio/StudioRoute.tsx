"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ReactFlowProvider } from "@xyflow/react";
import { toPng } from "html-to-image";
import { Camera, ChevronLeft, ChevronRight, Download, Eye, EyeOff, Send, Trash2, X } from "lucide-react";
import Button from "../ui/Button";
import { blankSketch, SKETCH_FLAVORS, sketchToSystemProject, type SketchFlavor, type StudioSketch } from "@/lib/diagram-studio/sketch";
import { deleteSketch, listSketches, saveSketch } from "@/lib/diagram-studio/sketchStore";
import { studioItemPngFileName } from "@/lib/diagram-studio/types";
import { SYSTEM_DRAFT_KEY } from "@/lib/draw/toSystemDraft";
import { StudioCanvas } from "./StudioCanvas";

const inputCls =
  "rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[13px] focus:border-[#A98450] focus:outline-none";

/**
 * Diagram Studio route: freehand architecture sketching. Boxes (systems,
 * flowchart shapes, notes) with static labeled links - pure diagrams, no
 * animation. System sketches promote to the System tab for real APIs;
 * flowcharts export and deliver as-is.
 */
export function StudioRoute() {
  const router = useRouter();
  const [sketches, setSketches] = useState<StudioSketch[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newFlavor, setNewFlavor] = useState<SketchFlavor>("hybrid");
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState("");
  const [invOpen, setInvOpen] = useState(true);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void listSketches().then(setSketches).catch(() => setSketches([]));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const sketch = sketches.find((s) => s.id === activeId) ?? null;
  const systemCount = sketch?.nodes.filter((n) => n.kind === "system").length ?? 0;

  const persist = useCallback(async (next: StudioSketch) => {
    const ok = await saveSketch(next);
    if (ok) setSketches((prev) => prev.map((s) => (s.id === next.id ? { ...next, updatedAt: Date.now() } : s)));
  }, []);

  const mutateSketch = useCallback(
    (fn: (s: StudioSketch) => StudioSketch) => {
      const cur = sketches.find((s) => s.id === activeId);
      if (!cur) return;
      const next = fn(cur);
      setSketches((prev) => prev.map((s) => (s.id === next.id ? next : s)));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void persist(next), 900);
    },
    [sketches, activeId, persist]
  );

  const createSketch = () => {
    const s = blankSketch(newName, newFlavor);
    setNewName("");
    setNewFlavor("hybrid");
    setShowNew(false);
    setConfirmDelete(false);
    void saveSketch(s).then(() => {
      setSketches((prev) => [s, ...prev]);
      setActiveId(s.id);
    });
  };

  const visibleSketches = search.trim()
    ? sketches.filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase()))
    : sketches;

  const deleteActive = async () => {
    if (!sketch) return;
    await deleteSketch(sketch.id).catch(() => undefined);
    setSketches((prev) => prev.filter((s) => s.id !== sketch.id));
    setActiveId(null);
    setConfirmDelete(false);
  };

  const exportPng = async (scale: 2 | 3) => {
    if (!sketch || busy) return;
    const el = shotRef.current;
    if (!el) return;
    setBusy(true);
    setExportError(null);
    // Capture the clean preview view (no connector dots or viewport
    // controls), then restore whatever mode the user was in.
    const wasPreview = preview;
    if (!wasPreview) {
      setPreview(true);
      await new Promise((r) => setTimeout(r, 80));
    }
    try {
      const dataUrl = await toPng(el, { backgroundColor: "#FFFFFF", pixelRatio: scale, cacheBust: true });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = studioItemPngFileName(sketch.name, scale);
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setExportError("Export failed - try again.");
    } finally {
      if (!wasPreview) setPreview(false);
      setBusy(false);
    }
  };

  const sendToSystem = () => {
    if (!sketch || systemCount === 0) return;
    const promotion = sketchToSystemProject(sketch);
    try {
      sessionStorage.setItem(SYSTEM_DRAFT_KEY, JSON.stringify(promotion.project));
    } catch {
      setExportError("Browser storage refused the handoff - try again.");
      return;
    }
    router.push("/system");
  };



  return (
    <div className="grid min-h-0 flex-1 items-stretch gap-[2px] lg:grid-cols-[auto_minmax(0,1fr)]">
      {invOpen ? (
      <aside className="flex h-full max-h-[calc(100vh-140px)] min-h-[420px] w-full flex-col rounded-xl border border-[#E8E2D8] bg-white p-2 lg:w-[300px]" aria-label="Sketches inventory">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#A39B8E]">Sketches · {sketches.length}</p>
          <button type="button" onClick={() => setInvOpen(false)} aria-label="Collapse sketches" title="Collapse sketches"
            className="rounded-md p-1 text-[#A39B8E] hover:text-[#27241F] cursor-pointer">
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="mb-2 flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sketches…"
            aria-label="Search sketches"
            className={inputCls}
          />
          <Button size="sm" onClick={() => setShowNew(true)} title="New sketch">
            + New
          </Button>
        </div>
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {visibleSketches.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => {
                  setActiveId(s.id);
                  setConfirmDelete(false);
                                setExportError(null);
                }}
                aria-current={s.id === activeId ? "true" : undefined}
                className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                  s.id === activeId ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] bg-white hover:border-[#A98450]"
                }`}
              >
                <p className="truncate text-[13px] font-semibold">{s.name}</p>
                <p className={`font-mono text-[10px] ${s.id === activeId ? "text-white/70" : "text-[#A39B8E]"}`}>
                  {(s.flavor ?? "hybrid")[0].toUpperCase() + (s.flavor ?? "hybrid").slice(1)} · {s.nodes.filter((n) => n.kind === "system").length} systems · {s.edges.length} links
                </p>
              </button>
            </li>
          ))}
          {visibleSketches.length === 0 && (
            <li className="rounded-lg border border-dashed border-[#D8CFC0] p-4 text-center">
              <p className="text-[13px] font-semibold text-[#27241F]">{search.trim() ? "No matches" : "No sketches yet"}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-[#777168]">
                {search.trim()
                  ? "Try a different search."
                  : "Hit + New - pick a name and a type, then place boxes, link them, and send systems to the System tab for real APIs."}
              </p>
            </li>
          )}
        </ul>
      </aside>
      ) : (
        <button type="button" onClick={() => setInvOpen(true)} aria-label="Expand sketches" title="Expand sketches"
          className="w-8 shrink-0 self-stretch rounded-xl border border-[#E8E2D8] bg-white p-1 text-[#A39B8E] hover:text-[#27241F] cursor-pointer">
          <ChevronRight size={14} aria-hidden="true" className="mx-auto" />
        </button>
      )}

      <section className="min-h-0 rounded-xl border border-[#E8E2D8] bg-white p-[2px]" aria-label="Sketch editor">
        {!sketch ? (
          <div className="flex h-full min-h-[420px] flex-col items-center justify-center px-6 text-center">
            <p className="text-[16px] font-semibold text-[#27241F]">Diagram Studio</p>
            <p className="mt-2 max-w-md text-[12px] leading-relaxed text-[#777168]">
              Figma-for-systems sketching: drop boxes, connect them in seconds, no backend ceremony.
              System sketches promote to the System tab for real APIs; flowcharts export and deliver as-is.
              The AI dock draws here too - ask it to place your boxes, adjust by hand.
            </p>
          </div>
        ) : (
          <div className="flex h-full max-h-[calc(100vh-140px)] min-h-[460px] flex-col gap-[2px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                key={sketch.id}
                defaultValue={sketch.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== sketch.name) mutateSketch((p) => ({ ...p, name: v }));
                }}
                aria-label="Sketch name"
                className="min-w-0 flex-1 rounded-lg border border-transparent px-2 py-1 text-[15px] font-semibold text-[#27241F] hover:border-[#E8E2D8] focus:border-[#A98450] focus:outline-none"
              />
              <button type="button" onClick={() => setPreview((p) => !p)} title={preview ? "Exit preview" : "Preview clean export view"}
                aria-label={preview ? "Exit preview" : "Preview clean export view"} aria-pressed={preview}
                className={`rounded-lg border p-2 transition-colors cursor-pointer ${preview ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] bg-white text-[#777168] hover:border-[#A98450] hover:text-[#27241F]"}`}>
                {preview ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
              </button>
              <button type="button" onClick={() => void exportPng(2)} disabled={busy || sketch.nodes.length === 0}
                title="Snapshot PNG (2x)" aria-label="Snapshot PNG"
                className="rounded-lg border border-[#E8E2D8] bg-white p-2 text-[#777168] hover:border-[#A98450] hover:text-[#27241F] transition-colors cursor-pointer disabled:opacity-40">
                <Camera size={15} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => void exportPng(3)} disabled={busy || sketch.nodes.length === 0}
                title="Hi-res PNG (3x)" aria-label="Hi-res PNG"
                className="rounded-lg border border-[#211F1B] bg-[#211F1B] p-2 text-white hover:bg-[#3a352d] transition-colors cursor-pointer disabled:opacity-40">
                <Download size={15} aria-hidden="true" />
              </button>
              <button type="button" onClick={sendToSystem} disabled={systemCount === 0}
                title={systemCount === 0 ? "Place at least one system box first - flowcharts export directly" : "Send to System - promote boxes + links into a runnable project"}
                aria-label="Send to System"
                className="rounded-lg border border-[#E8E2D8] bg-white p-2 text-[#777168] hover:border-[#A98450] hover:text-[#27241F] transition-colors cursor-pointer disabled:opacity-40">
                <Send size={15} aria-hidden="true" />
              </button>
              {confirmDelete ? (
                <>
                  <button type="button" onClick={() => setConfirmDelete(false)} title="Keep sketch" aria-label="Keep sketch"
                    className="rounded-lg border border-[#E8E2D8] bg-white p-2 text-[#777168] hover:text-[#27241F] transition-colors cursor-pointer">
                    <X size={15} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={deleteActive} title="Confirm delete" aria-label="Confirm delete"
                    className="rounded-lg border border-[#B3261E] bg-[#B3261E] p-2 text-white hover:bg-[#92211a] transition-colors cursor-pointer">
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} title="Delete sketch" aria-label="Delete sketch"
                  className="rounded-lg border border-[#E8E2D8] bg-white p-2 text-[#B3261E] hover:border-[#B3261E] transition-colors cursor-pointer">
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              )}
            </div>
            {exportError && (
              <p className={`rounded-lg border px-3 py-2 text-[11px] ${exportError ? "border-[#E5B8B2] bg-[#F9E8E6] text-[#B3261E]" : "border-[#BFD9C6] bg-[#E9F3EC] text-[#2F7D4F]"}`} role="status">
                {exportError}
              </p>
            )}
            <ReactFlowProvider>
              <div className="flex min-h-0 flex-1 flex-col">
                <StudioCanvas sketch={sketch} onChange={(next) => mutateSketch(() => next)} preview={preview} shotRef={shotRef} />
              </div>
            </ReactFlowProvider>
          </div>
        )}
      </section>

      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="New sketch"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNew(false);
          }}>
          <div className="w-full max-w-md rounded-2xl border border-[#E8E2D8] bg-white p-5 shadow-[0_2px_24px_rgba(169,132,80,0.08)]">
            <p className="text-[16px] font-semibold text-[#27241F]">New sketch</p>
            <label className="mt-3 block text-[12px] font-semibold text-[#27241F]">
              Name
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createSketch();
                }}
                placeholder="e.g. Order flow"
                aria-label="Sketch name"
                autoFocus
                className="mt-1 w-full rounded-lg border border-[#E8E2D8] bg-white px-2.5 py-1.5 text-[13px] font-normal focus:border-[#A98450] focus:outline-none"
              />
            </label>
            <p className="mt-3 text-[12px] font-semibold text-[#27241F]">Type</p>
            <div className="mt-1.5 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Sketch type">
              {SKETCH_FLAVORS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={newFlavor === f.id}
                  onClick={() => setNewFlavor(f.id)}
                  title={f.blurb}
                  className={`rounded-xl border px-2 py-2.5 text-center transition-colors cursor-pointer ${
                    newFlavor === f.id ? "border-[#211F1B] bg-[#211F1B] text-white" : "border-[#E8E2D8] bg-white hover:border-[#A98450]"
                  }`}
                >
                  <span className="block text-[13px] font-semibold">{f.label}</span>
                  <span className={`mt-0.5 block text-[10px] leading-snug ${newFlavor === f.id ? "text-white/70" : "text-[#777168]"}`}>{f.blurb}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setShowNew(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={createSketch} title="Create sketch">
                Create
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
