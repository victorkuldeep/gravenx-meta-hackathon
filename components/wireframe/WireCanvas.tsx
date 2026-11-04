"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Button from "../ui/Button";
import { DEFAULT_WHEEL_COEFFICIENT, scaleForTouchRatio, scaleForWheelDelta } from "@/lib/canvas/pinchZoom";
import { newScreen, type ComponentKind, type Experience } from "@/lib/wireframe/model";
import { childrenOf, newComponent, paletteByCategory, patchComponent, removeSubtree, reorderSibling } from "@/lib/wireframe/registry";
import { saveExperience } from "@/lib/wireframe/store";
import { loadViewport, panBy, storeViewport, zoomAt, type Viewport } from "@/lib/wireframe/viewport";
import { ApiPanel } from "./ApiPanel";
import { BehaviorPanel } from "./BehaviorPanel";
import { ComponentView } from "./ComponentView";
import { ConfirmDialog } from "./ConfirmDialog";
import { DeltaPanel } from "./DeltaPanel";
import { Inspector } from "./Inspector";
import { JourneyPanel } from "./JourneyPanel";
import { pruneJourney } from "@/lib/wireframe/journey";
import { SchemaPanel } from "./SchemaPanel";
import { useWireSchema } from "./useWireSchema";
import { toPng } from "html-to-image";
import { buildBoundComponent } from "@/lib/wireframe/schema";
import { contentBounds, frameFor, toWorld, wirePngFileName } from "@/lib/wireframe/canvasExport";
import { registerWireBridge, wireSnapshotOf } from "@/lib/ai/wireBridge";
import { rollupProposedFields } from "@/lib/wireframe/model";
import type { SalesforceField } from "@/lib/salesforce/types";

/**
 * Wireframe canvas shell (EPIC 02): screens strip, infinite pan/zoom
 * world, flow-layout screen cards, silent autosave. Component rendering
 * (palette, inspector, binding) arrives in EPIC 03+ - screens already
 * preview their assigned components read-only.
 */
export function WireCanvas({ experience, onSaved }: { experience: Experience; onSaved: (exp: Experience) => void }) {
  const [exp, setExp] = useState(experience);
  const [view, setView] = useState<Viewport>({ x: 40, y: 40, k: 1 });
  const [selId, setSelId] = useState<string | null>(null);
  const [selComp, setSelComp] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [deltaOpen, setDeltaOpen] = useState(false);
  const [behaviorOpen, setBehaviorOpen] = useState(false);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [apiOpen, setApiOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [locked, setLocked] = useState(false);
  const [pendingScreenDelete, setPendingScreenDelete] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const schema = useWireSchema();
  const [newName, setNewName] = useState("");
  const areaRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gesture = useRef<{ panX: number; panY: number; dragScreen: string | null; moved: boolean; pinch: Map<number, { x: number; y: number }>; pinchDist: number }>({
    panX: 0, panY: 0, dragScreen: null, moved: false, pinch: new Map(), pinchDist: 0,
  });

  useEffect(() => {
    setExp(experience);
    setSelId(null);
    setSelComp(null);
    setView(loadViewport(experience.id) ?? { x: 40, y: 40, k: 1 });
  }, [experience.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useCallback(
    (next: Experience) => {
      // The rollup is derived, never hand-edited: recompute at the single choke point.
      next = { ...next, proposedFields: rollupProposedFields(next.components) };
      setExp(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void saveExperience(next).then((ok) => {
          if (ok) onSaved(next);
        });
      }, 800);
    },
    [onSaved],
  );

  const setViewPersist = useCallback(
    (v: Viewport) => {
      setView(v);
      if (viewTimer.current) clearTimeout(viewTimer.current);
      viewTimer.current = setTimeout(() => storeViewport(exp.id, v), 300);
    },
    [exp.id],
  );

  // Wheel: plain = pan, ctrl/cmd = zoom to cursor. Non-passive listener.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        setViewPersist(zoomAt(view, cx, cy, scaleForWheelDelta(e.deltaY, DEFAULT_WHEEL_COEFFICIENT)));
      } else {
        setViewPersist(panBy(view, -e.deltaX, -e.deltaY));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [view, setViewPersist]);

  const fitView = () => {
    const area = areaRef.current;
    if (!area || exp.screens.length === 0) {
      setViewPersist({ x: 40, y: 40, k: 1 });
      return;
    }
    const pad = 60;
    const xs = exp.screens.map((s) => s.position.x);
    const ys = exp.screens.map((s) => s.position.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs) + 340;
    const maxY = Math.max(...ys) + 480;
    const w = area.clientWidth || 800;
    const h = area.clientHeight || 560;
    const k = Math.min(2.5, Math.max(0.25, Math.min(w / (maxX - minX + pad * 2), h / (maxY - minY + pad * 2))));
    setViewPersist({
      x: (w - (maxX - minX) * k) / 2 - minX * k,
      y: (h - (maxY - minY) * k) / 2 - minY * k,
      k: +k.toFixed(2),
    });
  };

  const doExport = useCallback(
    async (scale: 2 | 3) => {
      setExporting(true);
      setExportError(null);
      try {
        const area = areaRef.current;
        const world = worldRef.current;
        if (!area || !world) throw new Error("Canvas not ready");
        const areaRect = area.getBoundingClientRect();
        // Direct children only: drag headers carry the same attribute.
        const cards = [...world.querySelectorAll(":scope > [data-screen-id]")].map((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return toWorld(r, areaRect, view);
        });
        const bounds = contentBounds(cards);
        if (!bounds) throw new Error("Nothing to export - add a screen first");
        const frame = frameFor(bounds);
        const dataUrl = await toPng(world, {
          backgroundColor: "#FBF8F1",
          pixelRatio: scale,
          cacheBust: true,
          width: frame.imgW,
          height: frame.imgH,
          style: {
            width: `${frame.imgW}px`,
            height: `${frame.imgH}px`,
            transform: `translate(${frame.tx}px, ${frame.ty}px) scale(${frame.zoom})`,
          },
        });
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = wirePngFileName(exp.name, scale);
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (err) {
        setExportError(err instanceof Error ? err.message : "PNG export failed");
      } finally {
        setExporting(false);
      }
    },
    [exp.name, view],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (locked) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const g = gesture.current;
    const rect = areaRef.current?.getBoundingClientRect();
    const px = e.clientX - (rect?.left ?? 0);
    const py = e.clientY - (rect?.top ?? 0);
    g.pinch.set(e.pointerId, { x: px, y: py });
    if (g.pinch.size === 2) {
      const [a, b] = [...g.pinch.values()];
      g.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      g.dragScreen = null;
      return;
    }
    const dragEl = (e.target as HTMLElement).closest("[data-screen-drag]");
    const screenId = dragEl?.getAttribute("data-screen-id") ?? null;
    g.dragScreen = screenId;
    g.panX = e.clientX;
    g.panY = e.clientY;
    g.moved = false;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    // Locked canvas still pinch-zooms; drag-pan and screen moves are frozen.
    if (locked && g.pinch.size < 2) return;
    if (!g.pinch.has(e.pointerId)) return;
    const rect = areaRef.current?.getBoundingClientRect();
    g.pinch.set(e.pointerId, { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
    if (g.pinch.size === 2) {
      const [a, b] = [...g.pinch.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.pinchDist > 0 && dist > 0) {
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        setViewPersist(zoomAt(view, cx, cy, scaleForTouchRatio(dist / g.pinchDist, 4)));
      }
      g.pinchDist = dist;
      g.moved = true;
      return;
    }
    const dx = e.clientX - g.panX;
    const dy = e.clientY - g.panY;
    if (Math.abs(dx) + Math.abs(dy) > 2) g.moved = true;
    if (g.dragScreen) {
      const nx = exp.screens.map((s) =>
        s.id === g.dragScreen ? { ...s, position: { x: Math.round(s.position.x + dx / view.k), y: Math.round(s.position.y + dy / view.k) } } : s,
      );
      persist({ ...exp, screens: nx });
    } else {
      setViewPersist(panBy(view, dx, dy));
    }
    g.panX = e.clientX;
    g.panY = e.clientY;
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    g.pinch.delete(e.pointerId);
    if (g.pinch.size < 2) g.pinchDist = 0;
    if (!g.moved && !g.dragScreen) {
      const scr = (e.target as HTMLElement).closest("[data-screen-id]");
      setSelId(scr?.getAttribute("data-screen-id") ?? null);
      if (!scr) setSelComp(null);
    } else if (!g.moved && g.dragScreen) {
      setSelId(g.dragScreen);
    }
    if (!g.moved && !(e.target as HTMLElement).closest("[data-screen-id]") && g.pinch.size === 0) {
      setSelId(null);
      setSelComp(null);
    }
    g.dragScreen = null;
    g.moved = false;
  };

  const deleteComponent = useCallback(
    (id: string) => {
      persist({ ...exp, components: removeSubtree(exp.components, id) });
      if (selComp === id) setSelComp(null);
    },
    [exp, persist, selComp],
  );

  // Delete selected component first, else the selected screen (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (selComp) {
        e.preventDefault();
        deleteComponent(selComp);
      } else if (selId) {
        e.preventDefault();
        setPendingScreenDelete(selId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, selComp, exp]);

  const patchComponentById = useCallback(
    (id: string, patch: Partial<(typeof exp.components)[number]>) => {
      persist({ ...exp, components: patchComponent(exp.components, id, patch) });
    },
    [exp, persist],
  );

  const moveComponent = useCallback(
    (id: string, dir: -1 | 1) => {
      persist({ ...exp, components: reorderSibling(exp.components, id, dir) });
    },
    [exp, persist],
  );

  /** AI agent bridge: headless tools read/apply through the canvas persist path. */
  useEffect(() => {
    registerWireBridge({
      getSnapshot: () => wireSnapshotOf(exp),
      getExperience: () => exp,
      apply: (fn) => {
        persist(fn(exp));
        return { ok: true };
      },
    });
    return () => registerWireBridge(null);
  }, [exp, persist]);

  const inspected = exp.components.find((c) => c.id === selComp) ?? null;

  const jumpToComponent = (id: string) => {
    setSelComp(id);
    const c = exp.components.find((x) => x.id === id);
    if (c?.parentId) setSelId(c.parentId);
  };

  const addBoundField = (field: SalesforceField, objectName: string) => {
    if (locked) return;
    const target = selId ?? exp.screens[0]?.id;
    if (!target) return;
    const comp = buildBoundComponent(field, objectName, target);
    persist({ ...exp, components: [...exp.components, comp] });
    setSelId(target);
    setSelComp(comp.id);
  };

  const bindField = (componentId: string, field: SalesforceField, objectName: string) => {
    const current = exp.components.find((c) => c.id === componentId);
    persist({
      ...exp,
      components: patchComponent(exp.components, componentId, {
        bindingState: "existing",
        binding: { source: "salesforce", object: objectName, field: field.name },
        validation: { ...(current?.validation ?? {}), required: !field.nillable },
      }),
    });
  };

  const addComponent = (kind: ComponentKind, screenId: string | null) => {
    const target = screenId ?? exp.screens[0]?.id;
    if (!target) return;
    const comp = newComponent(kind, target);
    persist({ ...exp, components: [...exp.components, comp] });
    setSelId(target);
    setSelComp(comp.id);
  };

  const addScreen = () => {
    const s = newScreen(newName || `Screen ${exp.screens.length + 1}`, 120 + exp.screens.length * 60, 120);
    persist({ ...exp, screens: [...exp.screens, s] });
    setNewName("");
    setSelId(s.id);
  };

  const removeScreen = (id: string) => {
    const valid = new Set(exp.screens.map((s) => s.id).filter((sid) => sid !== id));
    persist({
      ...exp,
      screens: exp.screens.filter((s) => s.id !== id),
      components: exp.components.filter((c) => c.parentId !== id),
      journeys: exp.journeys.map((j) => pruneJourney(j, valid)),
    });
    if (selId === id) setSelId(null);
    setPendingScreenDelete(null);
  };

  const grid = 28 * view.k;

  return (
    <div className="flex gap-3">
      {!railOpen && (
        <div className="flex shrink-0 flex-col items-center rounded-xl border border-[#E8E2D8] bg-white p-1.5">
          <button
            type="button"
            onClick={() => setRailOpen(true)}
            title="Expand sidebar"
            aria-label="Expand sidebar"
            className="cursor-pointer rounded-lg px-2 py-1.5 font-mono text-xs text-[#777168] hover:bg-[#F5F1E8] hover:text-[#27241F]"
          >
            »
          </button>
        </div>
      )}
      {railOpen && (
      <aside className="w-52 shrink-0 rounded-xl border border-[#E8E2D8] bg-white p-2.5">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <p className="font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">
            Screens · {exp.screens.length}
          </p>
          <button
            type="button"
            onClick={() => setRailOpen(false)}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="cursor-pointer rounded px-1.5 py-0.5 font-mono text-[11px] text-[#A39B8E] hover:bg-[#F5F1E8] hover:text-[#27241F]"
          >
            «
          </button>
        </div>
        <ul className="mb-2 max-h-[420px] space-y-1 overflow-y-auto">
          {exp.screens.map((s) => {
            const n = exp.components.filter((c) => c.parentId === s.id).length;
            return (
              <li key={s.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelId(s.id)}
                  className={`min-w-0 flex-1 cursor-pointer truncate rounded-lg px-2 py-1.5 text-left text-xs font-medium transition-colors ${
                    selId === s.id ? "bg-[#27241F] text-white" : "text-[#27241F] hover:bg-[#F5F1E8]"
                  }`}
                >
                  <span className="block truncate">{s.name}</span>
                  <span className={`block font-mono text-[10px] ${selId === s.id ? "text-[#C9BFAE]" : "text-[#A39B8E]"}`}>
                    {n} component{n === 1 ? "" : "s"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setPendingScreenDelete(s.id)}
                  title={`Delete ${s.name}`}
                  aria-label={`Delete ${s.name}`}
                  className="shrink-0 rounded p-1 text-[#C9BFAE] opacity-0 transition-colors cursor-pointer hover:bg-red-500/10 hover:text-red-700 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-1">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addScreen();
            }}
            placeholder="Screen name"
            aria-label="New screen name"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-[#E8E2D8] px-2 py-1.5 text-xs text-[#27241F] placeholder-[#A39B8E] focus:border-[#C9A86A] focus:outline-none"
          />
          <Button size="sm" onClick={addScreen} title="Add screen">
            +
          </Button>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setPaletteOpen((v) => !v)} title="Component palette" aria-expanded={paletteOpen} className="mt-2 w-full">
          {paletteOpen ? "Close palette" : "+ Component"}
        </Button>
        {schema.connected && (
          <Button size="sm" variant="secondary" onClick={() => setSchemaOpen((v) => !v)} title="Salesforce schema" aria-expanded={schemaOpen} className="mt-1.5 w-full">
            {schemaOpen ? "Close schema" : "⇄ Schema"}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => setDeltaOpen((v) => !v)} title="Schema delta" aria-expanded={deltaOpen} className="mt-1.5 w-full">
          {deltaOpen ? "Close delta" : `Δ Delta${exp.proposedFields.length > 0 ? ` · ${exp.proposedFields.length}` : ""}`}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setBehaviorOpen((v) => !v)} title="Behavior overview" aria-expanded={behaviorOpen} className="mt-1.5 w-full">
          {behaviorOpen ? "Close behavior" : "⚡ Behavior"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setJourneyOpen((v) => !v)} title="Journeys" aria-expanded={journeyOpen} className="mt-1.5 w-full">
          {journeyOpen ? "Close journeys" : `⤳ Journeys${exp.journeys.length > 0 ? ` · ${exp.journeys.length}` : ""}`}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setApiOpen((v) => !v)} title="API impact" aria-expanded={apiOpen} className="mt-1.5 w-full">
          {apiOpen ? "Close APIs" : "API impact"}
        </Button>
        <div className="mt-1.5 flex gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void doExport(2)}
            disabled={exporting || exp.screens.length === 0}
            title="Download the full canvas as PNG (2x)"
            className="flex-1"
          >
            {exporting ? "Exporting…" : "⤓ Snapshot PNG"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void doExport(3)}
            disabled={exporting || exp.screens.length === 0}
            title="Download the full canvas as hi-res PNG (3x) for decks"
            className="flex-1"
          >
            {exporting ? "Exporting…" : "3x Hi-Res"}
          </Button>
        </div>
        {exportError && (
          <p className="mt-1 px-1 text-[11px] text-red-700">{exportError}</p>
        )}
        <p className="mt-2 px-1 text-[10px] leading-relaxed text-[#A39B8E]">
          {locked ? "Locked - unlock to edit the canvas" : "Drag headers to move · scroll to pan · Ctrl+scroll or pinch to zoom · Del removes"}
        </p>
      </aside>
      )}

      {paletteOpen && (
        <aside className="w-52 shrink-0 overflow-y-auto rounded-xl border border-[#E8E2D8] bg-white p-2.5" style={{ maxHeight: 640 }} aria-label="Component palette">
          {paletteByCategory().map(({ category, items }) => (
            <div key={category} className="mb-2">
              <p className="mb-1 px-1 font-mono text-[10px] uppercase tracking-[2px] text-[#A39B8E]">{category}</p>
              <ul className="space-y-0.5">
                {items.map((d) => (
                  <li key={d.kind}>
                    <button
                      type="button"
                      draggable={!locked}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/x-wire-kind", d.kind);
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => addComponent(d.kind, selId)}
                      disabled={locked}
                      title={locked ? "Unlock the canvas to add components" : `Add ${d.label}${selId ? "" : " to the first screen"}`}
                      className="w-full cursor-grab truncate rounded-lg px-2 py-1.5 text-left text-xs text-[#27241F] transition-colors hover:bg-[#F5F1E8] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {d.label}
                      <span className="ml-1 font-mono text-[9px] text-[#A39B8E]">{d.kind}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="px-1 text-[10px] leading-relaxed text-[#A39B8E]">Click adds to the selected screen · or drag onto any screen</p>
        </aside>
      )}

      {schemaOpen && schema.connected && (
        <SchemaPanel
          schema={schema}
          selectedScreenId={selId ?? exp.screens[0]?.id ?? null}
          inspectedId={selComp}
          onAddField={addBoundField}
          onBindField={bindField}
        />
      )}
      {deltaOpen && (
        <DeltaPanel
          exp={exp}
          onSelectComponent={jumpToComponent}
        />
      )}
      {behaviorOpen && (
        <BehaviorPanel
          exp={exp}
          onSelectComponent={jumpToComponent}
        />
      )}
      {journeyOpen && (
        <JourneyPanel
          exp={exp}
          onPatchJourneys={(journeys) => persist({ ...exp, journeys })}
          onGotoScreen={(screenId) => setSelId(screenId)}
        />
      )}
      {apiOpen && (
        <ApiPanel
          exp={exp}
          onGotoScreen={(screenId) => setSelId(screenId)}
        />
      )}

      <div className="relative min-w-0 flex-1">
        <div
          ref={areaRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative h-[560px] touch-none overflow-hidden rounded-xl border border-[#E8E2D8] bg-[#FBF8F1] select-none"
          style={{
            backgroundImage: "radial-gradient(#D8CFBB 1px, transparent 1px)",
            backgroundSize: `${grid}px ${grid}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
        >
          <div
            ref={worldRef}
            className="absolute left-0 top-0"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: "0 0" }}
          >
            {exp.screens.map((s) => {
              const comps = childrenOf(exp.components, s.id);
              const renderTree = (parentId: string): ReactNode => (
                <div className="space-y-1.5">
                  {childrenOf(exp.components, parentId).map((c) => (
                    <ComponentView
                      key={c.id}
                      comp={c}
                      selected={selComp === c.id}
                      onSelect={() => {
                        setSelComp(c.id);
                        setSelId(s.id);
                      }}
                      onDelete={() => deleteComponent(c.id)}
                    >
                      {renderTree(c.id)}
                    </ComponentView>
                  ))}
                </div>
              );
              return (
                <div
                  key={s.id}
                  data-screen-id={s.id}
                  onDragOver={(e) => {
                    if ([...e.dataTransfer.types].includes("application/x-wire-kind")) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (locked) return;
                    const kind = e.dataTransfer.getData("application/x-wire-kind") as ComponentKind;
                    if (kind) {
                      e.preventDefault();
                      addComponent(kind, s.id);
                    }
                  }}
                  className={`absolute w-[300px] rounded-xl border-2 bg-white shadow-[0_8px_28px_-12px_rgba(24,20,12,0.35)] ${
                    selId === s.id ? "border-[#9A7653]" : "border-[#E3D9C6]"
                  }`}
                  style={{ left: s.position.x, top: s.position.y }}
                >
                  <div
                    data-screen-drag
                    data-screen-id={s.id}
                    className="cursor-grab rounded-t-[10px] border-b border-[#EFE9DC] bg-[#F5F1E8] px-3 py-2 active:cursor-grabbing"
                  >
                    <p className="truncate text-[13px] font-semibold text-[#27241F]">{s.name}</p>
                    <p className="font-mono text-[10px] text-[#A39B8E]">
                      {s.viewport.width}×{s.viewport.height} · {comps.length}
                    </p>
                  </div>
                  <div className="min-h-10 space-y-2 p-2.5">
                    {comps.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-[#E3D9C6] px-2 py-3 text-center text-[11px] text-[#A39B8E]">
                        Drop components here
                      </p>
                    ) : (
                      renderTree(s.id)
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {exp.screens.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="max-w-xs text-center text-xs leading-relaxed text-[#A39B8E]">
                Blank world - add your first screen on the left. Drag headers to arrange; everything autosaves.
              </p>
            </div>
          )}
        </div>
        <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-[#E8E2D8] bg-white px-1.5 py-1 shadow-sm">
          <button type="button" onClick={() => setViewPersist({ ...view, k: Math.max(0.25, +(view.k - 0.25).toFixed(2)) })} aria-label="Zoom out" className="rounded px-1.5 py-0.5 text-sm text-[#777168] cursor-pointer hover:bg-[#F5F1E8]">−</button>
          <span className="min-w-10 text-center font-mono text-[10px] text-[#777168]">{Math.round(view.k * 100)}%</span>
          <button type="button" onClick={() => setViewPersist({ ...view, k: Math.min(2.5, +(view.k + 0.25).toFixed(2)) })} aria-label="Zoom in" className="rounded px-1.5 py-0.5 text-sm text-[#777168] cursor-pointer hover:bg-[#F5F1E8]">+</button>
          <button type="button" onClick={fitView} aria-label="Fit to content" title="Fit to content" className="rounded px-1.5 py-0.5 font-mono text-[10px] text-[#777168] cursor-pointer hover:bg-[#F5F1E8]">[]</button>
          <button
            type="button"
            onClick={() => setLocked((v) => !v)}
            aria-label={locked ? "Unlock canvas" : "Lock canvas"}
            aria-pressed={locked}
            title={locked ? "Unlock canvas" : "Lock canvas - freeze pan, drag and drop"}
            className={`rounded p-1 cursor-pointer hover:bg-[#F5F1E8] ${locked ? "text-[#9A7653]" : "text-[#A39B8E] hover:text-[#777168]"}`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              {locked ? (
                <><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>
              ) : (
                <><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 7.5-2" /></>
              )}
            </svg>
          </button>
          <button type="button" onClick={() => setViewPersist({ x: 40, y: 40, k: 1 })} aria-label="Reset view" title="Reset view" className="rounded px-1.5 py-0.5 font-mono text-[10px] text-[#777168] cursor-pointer hover:bg-[#F5F1E8]">1:1</button>
        </div>
      </div>

      {inspected && (
        <Inspector
          comp={inspected}
          schema={schema}
          onPatch={(patch) => patchComponentById(inspected.id, patch)}
          onMove={(dir) => moveComponent(inspected.id, dir)}
          onDelete={() => deleteComponent(inspected.id)}
          onClose={() => setSelComp(null)}
        />
      )}
      {pendingScreenDelete && (
        <ConfirmDialog
          title="Delete this screen?"
          message={`"${exp.screens.find((s) => s.id === pendingScreenDelete)?.name ?? "Screen"}" and its components will be removed, and journey steps pointing at it will be pruned. This cannot be undone.`}
          confirmLabel="Delete screen"
          onCancel={() => setPendingScreenDelete(null)}
          onConfirm={() => removeScreen(pendingScreenDelete)}
        />
      )}
    </div>
  );
}
