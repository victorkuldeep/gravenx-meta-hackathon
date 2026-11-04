"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { DrawCanvasProps } from "./DrawCanvas";
import { DraftDialog, type DraftConfirmation } from "./DraftDialog";
import {
  SYSTEM_DRAFT_KEY,
  buildSystemProject,
  parseTopology,
  type TopologyDraft,
} from "@/lib/draw/toSystemDraft";

const DrawCanvasLazy = dynamic<DrawCanvasProps>(
  () => import("./DrawCanvas").then((m) => m.DrawCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted)]">
        Loading whiteboard…
      </div>
    ),
  },
);

/**
 * Pure Excalidraw canvas - the only Studio chrome is the on-demand
 * Send-to-System confirm dialog. Nothing here renders locale- or
 * time-sensitive text, so server and client HTML always agree.
 */
export function DrawStudio() {
  const router = useRouter();
  const [draft, setDraft] = useState<TopologyDraft | null>(null);

  const handleConfirm = (selection: DraftConfirmation) => {
    if (!draft) return;
    const project = buildSystemProject(draft, selection);
    try {
      sessionStorage.setItem(SYSTEM_DRAFT_KEY, JSON.stringify(project));
    } catch {
      /* private mode etc - the canvas still holds the drawing */
    }
    setDraft(null);
    router.push("/system");
  };

  return (
    <>
      <div className="m-px h-[calc(100dvh-98px)] min-h-[480px] overflow-hidden bg-white">
        <DrawCanvasLazy onSendToSystem={(elements) => setDraft(parseTopology(elements))} />
      </div>
      {draft && (
        <DraftDialog
          draft={draft}
          onCancel={() => setDraft(null)}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}
