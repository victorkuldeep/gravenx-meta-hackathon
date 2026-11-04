import { z } from "zod";
import {
  blankSketchNode,
  sketchId,
  type SketchNodeKind,
  type StudioSketch,
} from "@/lib/diagram-studio/sketch";
import type { SystemType } from "@/lib/system-design/model";
import { getSketchBridge, sketchSnapshotOf } from "./sketchBridge";
import type { AgentTool } from "./tools";

/**
 * Sketch tools: the AI draws on the open Studio canvas, the human adjusts
 * by hand, and systems promote to System. Reads run free; every placement
 * goes through the user's explicit Apply (undo covers it on canvas).
 */

const noArgs = z.object({});

function liveSketch(): { bridge: NonNullable<ReturnType<typeof getSketchBridge>>; sketch: StudioSketch } | { bridge: null; sketch: null } {
  const bridge = getSketchBridge();
  const sketch = bridge?.getSketch() ?? null;
  if (!bridge || !sketch) return { bridge: null, sketch: null };
  return { bridge, sketch };
}

function findNode(sketch: StudioSketch, name: string): string | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const exact = sketch.nodes.find((n) => n.label.trim().toLowerCase() === want);
  if (exact) return exact.id;
  return sketch.nodes.find((n) => n.label.toLowerCase().includes(want))?.id ?? null;
}

const describeSketch: AgentTool = {
  name: "sketch_describe",
  description: "Summarize the open studio sketch: name, system/flow/note/link counts. Read-only.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "Read sketch summary",
  schema: noArgs,
  execute: async () => {
    const { sketch } = liveSketch();
    if (!sketch) return { ok: false, error: "No Studio sketch is open - ask the user to open the Studio tab and a sketch first." };
    return { ok: true, result: sketchSnapshotOf(sketch) };
  },
};

const addArgs = z.object({
  kind: z.enum(["system", "process", "decision", "terminator", "note"]).describe("What to place"),
  label: z.string().min(1).max(120).describe("Box text, e.g. Middleware Hub"),
  systemType: z.string().max(40).optional().describe("For kind system: salesforce, middleware, saas, queue, database, rest, custom"),
});

const addNode: AgentTool = {
  name: "sketch_add",
  description: "Place a box on the open sketch: system, process, decision, terminator or note. Lands cascading from existing boxes; the user fine-tunes by hand.",
  parameters: {
    type: "object",
    properties: { kind: { type: "string" }, label: { type: "string" }, systemType: { type: "string" } },
    required: ["kind", "label"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => {
    const v = a as { kind?: string; label?: string };
    return `Place ${v.kind ?? "?"} "${v.label ?? "?"}"`;
  },
  schema: addArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof addArgs>;
    const { bridge, sketch } = liveSketch();
    if (!bridge || !sketch) return { ok: false, error: "No Studio sketch is open." };
    const kind = args.kind as SketchNodeKind;
    const n = sketch.nodes.length;
    const node = {
      ...blankSketchNode(kind, { x: 120 + (n % 4) * 320, y: 120 + Math.floor(n / 4) * 220 }),
      label: args.label.trim(),
      systemType: (kind === "system" ? (args.systemType?.trim() as SystemType | undefined) ?? "custom" : undefined),
    };
    const res = bridge.apply((s) => ({ ...s, nodes: [...s.nodes, node] }), `AI: place ${kind} "${node.label}"`);
    if (!res.ok) return { ok: false, error: res.error ?? "Apply failed." };
    return { ok: true, result: `Placed ${kind} "${node.label}".` };
  },
};

const connectArgs = z.object({
  from: z.string().min(1).max(120).describe("Source box label"),
  to: z.string().min(1).max(120).describe("Target box label"),
  label: z.string().max(120).optional().describe("Link label, e.g. Create Order"),
});

const connectNodes: AgentTool = {
  name: "sketch_connect",
  description: "Draw a labeled link between two boxes on the open sketch, matched by label. Static diagram link - no animation, no backend.",
  parameters: {
    type: "object",
    properties: { from: { type: "string" }, to: { type: "string" }, label: { type: "string" } },
    required: ["from", "to"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => {
    const v = a as { from?: string; to?: string };
    return `Link "${v.from ?? "?"} → ${v.to ?? "?"}"`;
  },
  schema: connectArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof connectArgs>;
    const { bridge, sketch } = liveSketch();
    if (!bridge || !sketch) return { ok: false, error: "No Studio sketch is open." };
    const fromId = findNode(sketch, args.from);
    const toId = findNode(sketch, args.to);
    if (!fromId || !toId) {
      const missing = [!fromId && `"${args.from}"`, !toId && `"${args.to}"`].filter(Boolean).join(" and ");
      return { ok: false, error: `No box matches ${missing} - ask for the exact box text first.` };
    }
    if (fromId === toId) return { ok: false, error: "Source and target are the same box." };
    const edge = { id: sketchId("ske"), sourceId: fromId, targetId: toId, label: (args.label ?? "").trim() };
    const res = bridge.apply((s) => ({ ...s, edges: [...s.edges, edge] }), `AI: link boxes`);
    if (!res.ok) return { ok: false, error: res.error ?? "Apply failed." };
    return { ok: true, result: edge.label ? `Linked with label "${edge.label}".` : "Linked." };
  },
};

export const SKETCH_TOOLS: AgentTool[] = [describeSketch, addNode, connectNodes];
