import { z } from "zod";
import type { AgentTool } from "./tools";
import {
  buildArrowSpec,
  buildShapeSpecs,
  buildTextSpec,
  getDrawBridge,
  type DrawShapeKind,
} from "./drawBridge";

/**
 * Draw tool pack - read the board, place shapes with labels.
 *
 * Reads auto-execute; placements pause for human Apply. New elements land
 * at viewport center with a small cascade so repeats don't stack.
 * Excalidraw's own undo covers every apply; the skill text says so.
 */

function liveBridge() {
  return getDrawBridge();
}

const describeDraw: AgentTool = {
  name: "draw_describe",
  description:
    "Census the open Draw board: element counts by type, text contents, positions and the viewport center for placements.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "Describe board",
  schema: z.object({}),
  execute: async () => {
    const bridge = liveBridge();
    if (!bridge) return { ok: false, error: "No Draw canvas is open." };
    const snap = bridge.getSnapshot();
    if (!snap) return { ok: false, error: "No Draw canvas is open." };
    return { ok: true, result: snap };
  },
};

const SHAPES: readonly DrawShapeKind[] = ["rectangle", "ellipse", "diamond"];

const addShapeArgs = z.object({
  shape: z.string().min(1).describe("Box shape: rectangle, ellipse or diamond"),
  label: z
    .string()
    .min(1)
    .max(120)
    .describe('System label, e.g. "Middleware :8080" - one labeled box per system converts cleanly via Send to System'),
  width: z.number().min(60).max(1200).optional().describe("Box width - defaults to 240"),
  height: z.number().min(40).max(800).optional().describe("Box height - defaults to 120"),
});

const addShape: AgentTool = {
  name: "draw_add_shape",
  description:
    "Place a labeled system box on the open Draw board at viewport center. Only new boxes - never move or delete.",
  parameters: {
    type: "object",
    properties: {
      shape: { type: "string" },
      label: { type: "string" },
      width: { type: "number" },
      height: { type: "number" },
    },
    required: ["shape", "label"],
    additionalProperties: false,
  },
  needsApproval: true,
  undoable: true,
  label: (a) => `Add ${(a as { label?: string }).label ?? "shape"} box`,
  schema: addShapeArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof addShapeArgs>;
    const bridge = liveBridge();
    if (!bridge) return { ok: false, error: "No Draw canvas is open." };
    if (!(SHAPES as readonly string[]).includes(args.shape)) {
      return { ok: false, error: `Unknown shape "${args.shape}" - pick rectangle, ellipse or diamond.` };
    }
    const snap = bridge.getSnapshot();
    if (!snap) return { ok: false, error: "No Draw canvas is open." };
    const n = snap.elementCount;
    const cx = (snap.viewport?.centerX ?? 0) + (n % 8) * 32;
    const cy = (snap.viewport?.centerY ?? 0) + (n % 8) * 24;
    const specs = buildShapeSpecs(args.shape as DrawShapeKind, args.label, cx, cy, args.width ?? 240, args.height ?? 120);
    const r = bridge.append(specs);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, result: `Placed ${args.shape} "${args.label}" near (${Math.round(cx)}, ${Math.round(cy)}).` };
  },
};

const addTextArgs = z.object({
  text: z.string().min(1).max(280).describe("Annotation text - architecture note, port label, decision"),
});

const addText: AgentTool = {
  name: "draw_add_text",
  description: "Place a text annotation on the open Draw board at viewport center. Only new text - never edit or delete.",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  needsApproval: true,
  undoable: true,
  label: (a) => `Add note "${((a as { text?: string }).text ?? "").slice(0, 40)}"`,
  schema: addTextArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof addTextArgs>;
    const bridge = liveBridge();
    if (!bridge) return { ok: false, error: "No Draw canvas is open." };
    const snap = bridge.getSnapshot();
    if (!snap) return { ok: false, error: "No Draw canvas is open." };
    const n = snap.elementCount;
    const cx = (snap.viewport?.centerX ?? 0) + (n % 8) * 32;
    const cy = (snap.viewport?.centerY ?? 0) + (n % 8) * 24;
    const r = bridge.append([buildTextSpec(args.text, cx, cy)]);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, result: `Placed note near (${Math.round(cx)}, ${Math.round(cy)}).` };
  },
};

const addArrowArgs = z.object({
  dx: z.number().min(-2000).max(2000).optional().describe("Horizontal length - defaults to 220 (pointing right)"),
  dy: z.number().min(-2000).max(2000).optional().describe("Vertical length - defaults to 0"),
});

const addArrow: AgentTool = {
  name: "draw_add_arrow",
  description:
    "Place a call arrow on the open Draw board at viewport center. Only new arrows - never rewire or delete. Position boxes first, then bridge them.",
  parameters: {
    type: "object",
    properties: { dx: { type: "number" }, dy: { type: "number" } },
    additionalProperties: false,
  },
  needsApproval: true,
  undoable: true,
  label: () => "Add call arrow",
  schema: addArrowArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof addArrowArgs>;
    const bridge = liveBridge();
    if (!bridge) return { ok: false, error: "No Draw canvas is open." };
    const snap = bridge.getSnapshot();
    if (!snap) return { ok: false, error: "No Draw canvas is open." };
    const cx = snap.viewport?.centerX ?? 0;
    const cy = snap.viewport?.centerY ?? 0;
    const r = bridge.append([buildArrowSpec(cx, cy, args.dx ?? 220, args.dy ?? 0)]);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, result: `Placed arrow near (${Math.round(cx)}, ${Math.round(cy)}). Drag its endpoints onto the boxes.` };
  },
};

export const DRAW_TOOLS: AgentTool[] = [describeDraw, addShape, addText, addArrow];
