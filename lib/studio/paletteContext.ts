import { useSyncExternalStore } from "react";
import type { WireframeRef } from "@/lib/experience/types";

/**
 * Palette attach context. The focused surface (a screen, a project)
 * registers itself with live attach handlers; the global palette offers
 * Attach actions against them. Owners clear on unmount so the palette
 * never attaches into a dead surface; a stale clear from a previous
 * owner is ignored.
 */

export interface PaletteAttachContext {
  kind: "screen" | "project";
  /** Displayed in the palette header, e.g. screen or project name. */
  title: string;
  attachedMappingIds: string[];
  attachedWireKey: string | null;
  onAttachWireframe: (ref: WireframeRef) => void;
  onAttachMapping: (mappingId: string) => void;
}

let current: PaletteAttachContext | null = null;
let owner: object | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function setPaletteAttachContext(ctx: PaletteAttachContext | null, nextOwner?: object): void {
  if (ctx === null) {
    if (nextOwner !== undefined && owner !== nextOwner) return;
    current = null;
    owner = null;
  } else {
    current = ctx;
    owner = nextOwner ?? null;
  }
  notify();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function snapshot(): PaletteAttachContext | null {
  return current;
}

export function usePaletteAttachContext(): PaletteAttachContext | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
