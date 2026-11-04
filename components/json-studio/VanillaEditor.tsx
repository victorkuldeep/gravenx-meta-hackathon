"use client";

import { useEffect, useRef } from "react";

// Lazily loaded - vanilla-jsoneditor touches the DOM and weighs ~10MB
// unpacked, so it must never join the initial bundle.
export function VanillaEditor({
  value,
  onChange,
  reveal,
}: {
  value: unknown;
  onChange?: (value: unknown) => void;
  /** Reveal a tree path (graph → editor sync). Bumped nonce re-triggers. */
  reveal?: { path: (string | number)[]; nonce: number } | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<{
    destroy: () => void;
    updateProps?: (props: { mode?: string }) => void;
    select?: (sel: unknown) => void;
  } | null>(null);
  const selectRef = useRef<((path: (string | number)[]) => unknown) | null>(null);
  const modeRef = useRef<{ tree: string } | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let alive = true;
    (async () => {
      const { createJSONEditor, Mode, createValueSelection } = await import("vanilla-jsoneditor");
      if (!alive || !hostRef.current || editorRef.current) return;
      modeRef.current = Mode as unknown as { tree: string };
      selectRef.current = createValueSelection as unknown as (path: (string | number)[]) => unknown;
      const editor = createJSONEditor({
        target: hostRef.current,
        props: {
          content: { json: value as Record<string, unknown> },
          mode: Mode.tree,
          onChange: (content: unknown) => {
            const v = (content as { json?: unknown })?.json;
            if (v !== undefined) onChangeRef.current?.(v);
          },
        },
      });
      editorRef.current = editor as unknown as {
        destroy: () => void;
        updateProps?: (props: { mode?: string }) => void;
        select?: (sel: unknown) => void;
      };
    })();
    return () => {
      alive = false;
      try {
        editorRef.current?.destroy();
      } catch {
        /* already gone */
      }
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Graph → editor reveal: switch to tree mode and select the node.
  useEffect(() => {
    if (!reveal || !editorRef.current || !modeRef.current || !selectRef.current) return;
    try {
      editorRef.current.updateProps?.({ mode: modeRef.current.tree });
      editorRef.current.select?.(selectRef.current(reveal.path));
    } catch {
      /* reveal is best-effort */
    }
  }, [reveal]);

  return (
    <div
      ref={hostRef}
      className="min-h-[480px] overflow-hidden rounded-xl border border-[#E8E2D8]"
      style={{
        // Ivory + bronze skin - scoped to the editor wrapper.
        ["--jse-theme-color" as string]: "#49381B",
        ["--jse-theme-color-highlight" as string]: "#3A2C15",
        ["--jse-menu-color" as string]: "#FFFFFF",
        ["--jse-background-color" as string]: "#FAF8F2",
        ["--jse-panel-background" as string]: "#FFFFFF",
        ["--jse-main-background-color" as string]: "#FFFFFF",
      }}
    />
  );
}
