import { z } from "zod";
import { parseStatements } from "@/lib/sequence/dsl";
import { importSequenceFile, sequencePackage } from "@/lib/sequence/packageIo";
import { toMermaid } from "@/lib/sequence/mermaid";
import { newSequence } from "@/lib/sequence/model";
import { claimFile, findRecords, listKind, writeJson } from "../workspace";
import type { McpTool, ToolResult } from "./types";

/** Inner document of a stored sequence package (or the raw document). */
function asDocument(data: unknown): { id?: string; name?: string } & Record<string, unknown> {
  if (data && typeof data === "object" && "document" in data) {
    return (data as { document: Record<string, unknown> }).document as { id?: string; name?: string } & Record<string, unknown>;
  }
  return (data ?? {}) as { id?: string; name?: string } & Record<string, unknown>;
}

function matchSeq(data: unknown) {
  const d = asDocument(data);
  if (typeof d.id !== "string") return null;
  return { id: d.id, name: typeof d.name === "string" ? d.name : undefined };
}

function resolveOne(dir: string, ref: string): { file: string; doc: ReturnType<typeof asDocument> } {
  const hits = findRecords(dir, "sequence", ref, matchSeq);
  if (hits.length === 0) throw new Error(`No sequence matches "${ref}" - create one first or check the filename.`);
  if (hits.length > 1) {
    throw new Error(
      `Ambiguous ref "${ref}" - ${hits.length} matches. Use the exact filename.`,
    );
  }
  return { file: hits[0].file, doc: asDocument(hits[0].data) };
}

export async function parseDsl(dsl: string): Promise<ToolResult> {
  const r = parseStatements(dsl);
  if (r.errors.length > 0) {
    return {
      ok: false,
      summary: `${r.errors.length} DSL error(s)`,
      error: r.errors.slice(0, 8).map((e) => `line ${e.line}: ${e.message}`).join(" "),
      data: { errors: r.errors },
    };
  }
  return {
    ok: true,
    summary: `${r.participants.length} participant(s), ${r.nodes.length} top-level node(s)`,
    data: {
      participants: r.participants.map((p) => p.name),
      nodes: r.nodes.length,
    },
  };
}

export async function createSequence(
  dir: string,
  args: { name: string; dsl: string; overwrite?: boolean },
): Promise<ToolResult> {
  const parsed = await parseDsl(args.dsl);
  if (!parsed.ok) return parsed;
  const r = parseStatements(args.dsl);
  const doc = {
    ...newSequence(args.name),
    participants: r.participants,
    nodes: r.nodes,
  };
  const file = claimFile(dir, "sequence", args.name, args.overwrite);
  writeJson(file, sequencePackage(doc));
  return {
    ok: true,
    file,
    summary: `Sequence "${doc.name}" saved - open it in Sequence Studio via Import.`,
    data: { id: doc.id, name: doc.name },
  };
}

export const sequenceTools: McpTool[] = [
  {
    name: "sequence_parse",
    description:
      "Validate GRAVENX interaction DSL without writing a file. Returns participants, node count, or line-numbered errors.",
    shape: { dsl: z.string().min(1).max(20000).describe("Interaction statements, one per line") },
    run: async (_dir, args) => parseDsl(args.dsl as string),
  },
  {
    name: "sequence_create",
    description:
      "Create a sequence package file from DSL (sync/response/async messages, loop, condition, parallel, retry, note). The studio Import button opens the file directly.",
    shape: {
      name: z.string().min(1).max(160),
      dsl: z.string().min(1).max(20000),
      overwrite: z.boolean().optional(),
    },
    run: (dir, args) =>
      createSequence(dir, args as { name: string; dsl: string; overwrite?: boolean }),
  },
  {
    name: "sequence_mermaid",
    description: "Render a stored sequence as Mermaid sequenceDiagram text (docs, reviews, wikis).",
    shape: { ref: z.string().min(1).describe("Filename, id, or name substring") },
    run: async (dir, args) => {
      const { file, doc } = resolveOne(dir, args.ref as string);
      const mmd = toMermaid({
        ...(doc as unknown as Parameters<typeof toMermaid>[0]),
      });
      return { ok: true, file, summary: "Mermaid rendered.", data: { mermaid: mmd } };
    },
  },
  {
    name: "sequence_validate",
    description: "Schema-check a stored sequence package the same way studio import does.",
    shape: { ref: z.string().min(1).describe("Filename, id, or name substring") },
    run: async (dir, args) => {
      const { file, doc } = resolveOne(dir, args.ref as string);
      const r = importSequenceFile(JSON.stringify(doc), "validate.json");
      if (!r.ok) {
        return { ok: false, file, summary: "Invalid sequence.", error: r.error, data: undefined };
      }
      return {
        ok: true,
        file,
        summary: `Valid: ${r.document?.participants.length ?? 0} participant(s).`,
        data: { id: r.document?.id, name: r.document?.name },
      };
    },
  },
  {
    name: "sequence_list",
    description: "List stored sequence packages with participant counts.",
    shape: {},
    run: async (dir) => {
      const items = listKind(dir, "sequence").map(({ file, data }) => {
        const d = asDocument(data);
        const participants = Array.isArray((d as { participants?: unknown[] }).participants)
          ? ((d as { participants?: unknown[] }).participants ?? []).length
          : 0;
        return { file: file.split(/[\\/]/).pop(), name: d.name, participants };
      });
      return { ok: true, summary: `${items.length} sequence(s).`, data: { items } };
    },
  },
];
