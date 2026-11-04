import { z } from "zod";

/**
 * GRAVENX Sequence - interaction model (EPIC 01).
 *
 * Source-of-truth rule (same as Wireframe): the diagram is a projection,
 * this model decides. Messages plus control blocks nest recursively; the
 * DSL, renderer, System bridge and AI tools all read and write this shape.
 * V1 message kinds: sync / response / async. V1 blocks: loop, condition,
 * parallel (+join), retry, note. Reserved fields (operationRef, timeout,
 * retry policy) give execution and API refs somewhere to land later.
 */

export const SCHEMA_VERSION = 1;

export const PARTICIPANT_KINDS = ["system", "service", "actor", "bus", "store"] as const;
export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];

export const MESSAGE_KINDS = ["sync", "response", "async"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const BLOCK_TYPES = ["loop", "condition", "parallel", "retry", "note"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

const participantSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  kind: z.enum(PARTICIPANT_KINDS).default("system"),
  /** Future link into the System registry - resolved by name until then. */
  systemRef: z.string().max(120).optional(),
});
export type Participant = z.infer<typeof participantSchema>;

const retrySchema = z.object({
  attempts: z.number().int().min(1).max(100),
  waitSecs: z.number().min(0).max(86400).optional(),
  onFailure: z.string().max(200).optional(),
});
export type RetryPolicy = z.infer<typeof retrySchema>;

export interface SeqMessage {
  nodeType: "message";
  id: string;
  from: string;
  to: string;
  label: string;
  kind: MessageKind;
  retry?: RetryPolicy;
  timeoutSecs?: number;
  operationRef?: string;
  note?: string;
}

export interface SeqBlock {
  nodeType: "block";
  id: string;
  type: BlockType;
  title: string;
  iterator?: string;
  condition?: string;
  elseLabel?: string;
  attempts?: number;
  waitSecs?: number;
  children: SeqNode[];
  /** Else-branch of a condition block. */
  elseChildren?: SeqNode[];
}

export type SeqNode = SeqMessage | SeqBlock;

const messageSchema = z.object({
  nodeType: z.literal("message"),
  id: z.string().min(1).max(80),
  from: z.string().min(1).max(80),
  to: z.string().min(1).max(80),
  label: z.string().max(200).default(""),
  kind: z.enum(MESSAGE_KINDS).default("sync"),
  retry: retrySchema.optional(),
  timeoutSecs: z.number().min(0).max(86400).optional(),
  operationRef: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
});

const blockSchema = z.object({
  nodeType: z.literal("block"),
  id: z.string().min(1).max(80),
  type: z.enum(BLOCK_TYPES),
  title: z.string().max(200).default(""),
  iterator: z.string().max(200).optional(),
  condition: z.string().max(200).optional(),
  elseLabel: z.string().max(200).optional(),
  attempts: z.number().int().min(1).max(100).optional(),
  waitSecs: z.number().min(0).max(86400).optional(),
  children: z.array(z.lazy((): z.ZodTypeAny => seqNodeSchema)).max(500).default([]),
  elseChildren: z.array(z.lazy((): z.ZodTypeAny => seqNodeSchema)).max(500).optional(),
});

// v4 cannot infer the recursive union back to the hand-maintained SeqNode
// (lazy children widen); the cast is guarded by model.test.ts round-trips.
const seqNodeSchema = z.discriminatedUnion("nodeType", [
  messageSchema,
  blockSchema,
]) as unknown as z.ZodType<SeqNode>;

export const SEQ_STATUSES = ["draft", "in-review", "approved"] as const;
export type SeqStatus = (typeof SEQ_STATUSES)[number];

const sequenceSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  version: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
  status: z.enum(SEQ_STATUSES),
  participants: z.array(participantSchema).max(100).default([]),
  nodes: z.array(seqNodeSchema).max(500).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type SequenceDocument = z.infer<typeof sequenceSchema>;
export const SequenceSchema = sequenceSchema;

function wid(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    /* fall through */
  }
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function newId(prefix: string): string {
  return wid(prefix);
}

export function newSequence(name: string): SequenceDocument {
  const now = Date.now();
  return {
    id: wid("seq"),
    name: name.trim().slice(0, 160) || "Untitled sequence",
    version: 1,
    schemaVersion: SCHEMA_VERSION,
    status: "draft",
    participants: [],
    nodes: [],
    createdAt: now,
    updatedAt: now,
  };
}

/** Rename rule: trimmed, capped, null when unchanged/blank (no-op). */
export function renameSequence(doc: SequenceDocument, draft: string): SequenceDocument | null {
  const clean = draft.trim().slice(0, 160);
  if (!clean || clean === doc.name) return null;
  return { ...doc, name: clean };
}

/** Approval workflow: review first, build only from approved. */
export function canTransition(from: SeqStatus, to: SeqStatus): boolean {
  if (from === to) return true;
  if (from === "draft" && to === "in-review") return true;
  if (from === "in-review" && (to === "approved" || to === "draft")) return true;
  return false;
}

/** Resolve a participant by id or case-insensitive name. */
export function resolveParticipant(doc: SequenceDocument, ref: string): Participant | null {
  const q = ref.trim().toLowerCase();
  return doc.participants.find((p) => p.id === ref || p.name.toLowerCase() === q) ?? null;
}

/** Structural problems: dangling refs, empty labels/blocks, duplicate names. */
export function validateSequence(doc: SequenceDocument): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const p of doc.participants) {
    const k = p.name.trim().toLowerCase();
    if (seen.has(k)) problems.push(`Duplicate participant "${p.name}".`);
    seen.add(k);
  }
  const walk = (nodes: SeqNode[], path: string) => {
    for (const n of nodes) {
      if (n.nodeType === "message") {
        if (!resolveParticipant(doc, n.from)) problems.push(`${path}Message "${n.label || n.id}": unknown source "${n.from}".`);
        if (!resolveParticipant(doc, n.to)) problems.push(`${path}Message "${n.label || n.id}": unknown target "${n.to}".`);
        if (!n.label.trim()) problems.push(`${path}A message has no label - write "A -> B: describe it".`);
      } else {
        // Name the block by what the author wrote, never by an internal id.
        const name =
          n.type === "loop" ? n.iterator || n.title
          : n.type === "condition" ? n.condition || n.title
          : n.title;
        if (n.type !== "note" && n.children.length === 0 && (n.elseChildren ?? []).length === 0) {
          problems.push(
            `${path}${name ? `${n.type} "${name}" is empty - add a message between the opener and "end".` : `A ${n.type} block is empty - add a message between the opener and "end".`}`,
          );
        }
        walk(n.children, `${path}${n.type} > `);
      }
    }
  };
  walk(doc.nodes, "");
  return problems;
}

/** Count messages recursively (blocks don't send messages). */
export function messageCount(nodes: SeqNode[]): number {
  let n = 0;
  for (const x of nodes) {
    if (x.nodeType === "message") n++;
    else n += messageCount(x.children) + messageCount(x.elseChildren ?? []);
  }
  return n;
}
