import { z } from "zod";
import { parseStatements } from "@/lib/sequence/dsl";
import type { SequenceDocument } from "@/lib/sequence/model";
import { getSeqBridge, seqSnapshotOf } from "./seqBridge";
import type { AgentTool } from "./tools";

/**
 * Sequence-tab tool pack: reads run free, mutations need panel approval.
 * The statement list is the edit surface - seq_apply parses the model's
 * DSL, so every mutation is validated before it touches the canvas, and
 * application goes through the bridge persist path (autosave intact).
 */

const noArgs = z.object({});

function liveDoc(): { bridge: NonNullable<ReturnType<typeof getSeqBridge>>; doc: SequenceDocument } | { bridge: null; doc: null } {
  const bridge = getSeqBridge();
  const doc = bridge?.getDocument() ?? null;
  if (!bridge || !doc) return { bridge: null, doc: null };
  return { bridge, doc };
}

const describeDoc: AgentTool = {
  name: "seq_describe",
  description: "Summarize the open sequence: name, status, version, participants and message/block counts.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "Read sequence summary",
  schema: noArgs,
  execute: async () => {
    const { doc } = liveDoc();
    if (!doc) return { ok: false, error: "No Sequence canvas is open - ask the user to open the Sequence tab and a document first." };
    return { ok: true, result: seqSnapshotOf(doc) };
  },
};

function flatten(doc: SequenceDocument): { from: string; to: string; label: string; kind: string }[] {
  const names = new Map(doc.participants.map((p) => [p.id, p.name]));
  const out: { from: string; to: string; label: string; kind: string }[] = [];
  const walk = (nodes: SequenceDocument["nodes"], ctx: string[]) => {
    for (const n of nodes) {
      if (n.nodeType === "message") {
        out.push({
          from: names.get(n.from) ?? n.from,
          to: names.get(n.to) ?? n.to,
          label: ctx.length > 0 ? `[${ctx.join(" / ")}] ${n.label}` : n.label,
          kind: n.kind,
        });
      } else if (n.type !== "note") {
        const tag = n.type.toUpperCase() + (n.iterator ? ` ${n.iterator}` : n.condition ? ` ${n.condition}` : "");
        walk(n.children, [...ctx, tag]);
        if (n.elseChildren) walk(n.elseChildren, [...ctx, "ELSE"]);
      } else {
        out.push({ from: "-", to: "-", label: `note: ${n.title}`, kind: "note" });
      }
    }
  };
  walk(doc.nodes, []);
  return out;
}

const readMessages: AgentTool = {
  name: "seq_messages",
  description: "List every message flattened with its block context, e.g. [LOOP order.lines] Create Line. Read-only.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  needsApproval: false,
  label: () => "List messages",
  schema: noArgs,
  execute: async () => {
    const { doc } = liveDoc();
    if (!doc) return { ok: false, error: "No Sequence canvas is open." };
    const flat = flatten(doc);
    if (flat.length === 0) return { ok: true, result: "No messages yet." };
    return { ok: true, result: flat.slice(0, 200) };
  },
};

const applyArgs = z.object({
  statements: z.string().min(1).max(20000).describe("DSL statements to apply"),
  mode: z.enum(["append", "replace"]).describe("append adds to the current document; replace swaps the whole interaction"),
});

const applyStatements: AgentTool = {
  name: "seq_apply",
  description: "Append DSL statements to the open sequence, or replace its whole interaction. Participants auto-create on first mention. Rejected with line errors when the DSL does not parse.",
  parameters: {
    type: "object",
    properties: {
      statements: { type: "string" },
      mode: { type: "string", enum: ["append", "replace"] },
    },
    required: ["statements", "mode"],
    additionalProperties: false,
  },
  needsApproval: true,
  label: (a) => {
    const v = a as { mode?: string };
    return v.mode === "replace" ? "Replace interaction" : "Append statements";
  },
  schema: applyArgs,
  execute: async (raw) => {
    const args = raw as z.infer<typeof applyArgs>;
    const { bridge, doc } = liveDoc();
    if (!bridge || !doc) return { ok: false, error: "No Sequence canvas is open." };
    const r = parseStatements(args.statements);
    if (r.errors.length > 0) {
      return { ok: false, error: `DSL errors: ${r.errors.slice(0, 5).map((e) => `line ${e.line}: ${e.message}`).join(" ")}` };
    }
    if (args.mode === "replace") {
      const res = bridge.apply((d) => ({ ...d, participants: r.participants, nodes: r.nodes }), "AI: replace interaction");
      if (!res.ok) return { ok: false, error: res.error ?? "Apply failed." };
      return { ok: true, result: `Replaced with ${r.participants.length} participants, ${r.nodes.length} top-level nodes.` };
    }
    // Append: merge participants by name, keep existing ids stable.
    const res = bridge.apply((d) => {
      const known = new Map(d.participants.map((p) => [p.name.toLowerCase(), p]));
      const participants = [...d.participants];
      for (const p of r.participants) {
        if (!known.has(p.name.toLowerCase())) {
          known.set(p.name.toLowerCase(), p);
          participants.push(p);
        }
      }
      const remap = new Map(r.participants.map((p) => [p.id, known.get(p.name.toLowerCase())!.id]));
      const remapNodes = (nodes: SequenceDocument["nodes"]): SequenceDocument["nodes"] =>
        nodes.map((n) => {
          if (n.nodeType === "message") {
            return { ...n, from: remap.get(n.from) ?? n.from, to: remap.get(n.to) ?? n.to };
          }
          return { ...n, children: remapNodes(n.children), elseChildren: n.elseChildren ? remapNodes(n.elseChildren) : undefined };
        });
      return { ...d, participants, nodes: [...d.nodes, ...remapNodes(r.nodes)] };
    }, "AI: append statements");
    if (!res.ok) return { ok: false, error: res.error ?? "Apply failed." };
    return { ok: true, result: `Appended ${r.nodes.length} top-level node(s).` };
  },
};

export const SEQUENCE_TOOLS: AgentTool[] = [describeDoc, readMessages, applyStatements];
