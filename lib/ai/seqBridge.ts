import { messageCount, type SequenceDocument } from "@/lib/sequence/model";

/**
 * Bridge between the live Sequence canvas and headless AI tools.
 *
 * SequenceCanvas registers itself on mount (getter + apply function);
 * tools in lib/ai/toolsSequence.ts call through this module, never
 * React. Outside /sequence (or in tests) the bridge is simply absent
 * and tools report that instead of crashing.
 */

export interface SeqSnapshot {
  id: string;
  name: string;
  status: string;
  version: number;
  participants: { id: string; name: string; kind: string }[];
  messageCount: number;
  blockCount: number;
  dirty: boolean;
}

export interface SeqBridge {
  getSnapshot: () => SeqSnapshot | null;
  /** Live document for read tools - no persistence side effects. */
  getDocument: () => SequenceDocument | null;
  /** Applies a document transform through the canvas persist path (autosave intact). */
  apply: (fn: (d: SequenceDocument) => SequenceDocument, label: string) => { ok: boolean; error?: string };
}

let bridge: SeqBridge | null = null;

export function registerSeqBridge(b: SeqBridge | null): void {
  bridge = b;
}

export function getSeqBridge(): SeqBridge | null {
  return bridge;
}

export function seqSnapshotOf(doc: SequenceDocument | null): SeqSnapshot | null {
  if (!doc) return null;
  return {
    id: doc.id,
    name: doc.name,
    status: doc.status,
    version: doc.version,
    participants: doc.participants.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
    messageCount: messageCount(doc.nodes),
    blockCount: doc.nodes.filter((n) => n.nodeType === "block").length,
    dirty: false,
  };
}
