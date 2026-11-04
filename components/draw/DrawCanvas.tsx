"use client";

import { useEffect, useRef, useState } from "react";
import { Excalidraw, restoreElements, serializeAsJSON, useHandleLibrary } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { Action } from "@excalidraw/excalidraw/actions/types";
import { readStoredScene, writeStoredScene, type StoredScene } from "@/lib/draw/storage";
import { registerDrawBridge, summarizeDrawElements, type DrawElementSpec } from "@/lib/ai/drawBridge";

/**
 * DrawCanvas - the single boundary between GRAVENX and Excalidraw.
 *
 * No other module imports `@excalidraw/excalidraw` at runtime; the rest of
 * the app talks to this wrapper, so the engine can be replaced without
 * rewriting callers.
 *
 * Reload-safety lives here too: the current scene restores from IndexedDB
 * on mount and saves (debounced) on every change. No snapshots, no chrome -
 * a reload simply returns to the drawing.
 */

// Self-hosted runtime assets (fonts, locales) copied from the installed
// package into public/excalidraw-assets by scripts/copy-excalidraw-assets.mjs.
// No CDN fallback is configured, so a missing file fails loudly, not silently.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).EXCALIDRAW_ASSET_PATH =
    "/excalidraw-assets/";
}

async function readInitialScene(): Promise<ExcalidrawInitialDataState | null> {
  const stored: StoredScene | null = await readStoredScene();
  if (!stored) return null;
  return {
    elements: stored.elements,
    appState: stored.appState,
    files: stored.files ?? undefined,
    scrollToContent: true,
  } as unknown as ExcalidrawInitialDataState;
}

export interface DrawCanvasProps {
  /** Called with the live scene elements when the user sends to System. */
  onSendToSystem: (elements: unknown[]) => void;
}

export function DrawCanvas({ onSendToSystem }: DrawCanvasProps) {
  // Kick off once per mount: a fresh promise every render would reset the editor.
  const [initialScene] = useState<Promise<ExcalidrawInitialDataState | null>>(readInitialScene);
  const saveTimer = useRef<number | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const sendRef = useRef(onSendToSystem);
  sendRef.current = onSendToSystem;

  // Library installs from libraries.excalidraw.com arrive as #addLibrary
  // hashes. The hosted editor handles these internally; npm integrators
  // must wire the official hook or installs silently never land (worse in an
  // SPA where the return trip doesn't remount the editor).
  useHandleLibrary({
    excalidrawAPI: api,
    validateLibraryUrl: (url) => {
      try {
        return new URL(url).hostname === "libraries.excalidraw.com";
      } catch {
        return false;
      }
    },
  });

  const fireSend = () => {
    const api = apiRef.current;
    const elements = api ? [...api.getSceneElements()] : [];
    sendRef.current(elements as unknown[]);
  };

  // AI seam: snapshot the live board, append AI-placed elements through
  // the engine's own restore so seeds/indexes/bindings stay valid.
  useEffect(() => () => registerDrawBridge(null), []);

  const registerBridge = () => {
    const api = apiRef.current;
    if (!api) return;
    registerDrawBridge({
      getSnapshot: () => {
        const elements = [...api.getSceneElements()] as unknown[];
        const st = api.getAppState() as unknown as Record<string, unknown>;
        const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
        const zoomRaw = st.zoom as { value?: unknown } | number | undefined;
        const zoom = num(typeof zoomRaw === "number" ? zoomRaw : zoomRaw?.value, 1) || 1;
        const w = num(st.width, 0);
        const h = num(st.height, 0);
        return summarizeDrawElements(elements, {
          centerX: w / (2 * zoom) - num(st.scrollX, 0),
          centerY: h / (2 * zoom) - num(st.scrollY, 0),
        });
      },
      append: (specs: DrawElementSpec[]) => {
        try {
          const existing = [...api.getSceneElementsIncludingDeleted()];
          // restoreElements exists to normalize incomplete imports - the
          // strict input type is upstream imprecision, hence the cast.
          const restored = restoreElements(
            [...existing, ...(specs as unknown as typeof existing)],
            existing,
            { refreshDimensions: true, repairBindings: true },
          );
          const wanted = new Set(specs.map((s) => s.id).filter((id): id is string => typeof id === "string"));
          const selectedElementIds: Record<string, true> = {};
          for (const el of restored) {
            if (typeof el.id === "string" && wanted.has(el.id)) selectedElementIds[el.id] = true;
          }
          api.updateScene({ elements: restored, appState: { selectedElementIds } });
          return { ok: true as const, added: specs.length };
        } catch (e) {
          return { ok: false as const, error: e instanceof Error ? e.message : "Append failed." };
        }
      },
    });
  };

  const sendButton = (
    <button
      type="button"
      onClick={fireSend}
      title="Parse this board into a System Design draft"
      className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:border-[var(--color-accent)] transition-colors cursor-pointer"
    >
      Send to System
    </button>
  );

  return (
    <Excalidraw
      initialData={initialScene}
      excalidrawAPI={(api) => {
        apiRef.current = api;
        setApi(api);
        registerBridge();
        // Command-palette entry mirroring the button. `name` is cast: the
        // closed ActionName union only knows built-ins, but the runtime
        // registry is a plain name-keyed map (verified in the bundle).
        api.registerAction({
          name: "sendToSystemDesign" as Action["name"],
          label: "Send to System Design",
          paletteName: "Send to System Design",
          keywords: ["system", "topology", "integration", "send"],
          trackEvent: false,
          perform: () => {
            fireSend();
            return false;
          },
        } as Action);
      }}
      renderTopRightUI={() => (
        <div className="flex items-center gap-1.5">
          <a
            href="/console"
            title="Open Console - track this board as tasks"
            className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:border-[var(--color-accent)] transition-colors cursor-pointer"
          >
            Console
          </a>
          {sendButton}
        </div>
      )}
      onChange={(elements, appState, files) => {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          void writeStoredScene(serializeAsJSON(elements, appState, files, "local"));
        }, 500);
      }}
    />
  );
}
