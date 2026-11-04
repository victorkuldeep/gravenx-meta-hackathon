"use client";

import { SystemNodeView } from "./SystemNode";
import { CanvasImageView, CanvasNoteView } from "./CanvasMarks";

/**
 * Shared React Flow node-type registry (extracted from SystemDesigner so
 * Diagram Studio renders the identical canvas for themed PNG sets).
 * The pure projection (toFlowNodes/toFlowEdges) lives in lib: see
 * lib/system-design/flow.ts, which stays importable from unit tests.
 */
export const systemNodeTypes = { system: SystemNodeView, note: CanvasNoteView, "canvas-image": CanvasImageView } as const;
