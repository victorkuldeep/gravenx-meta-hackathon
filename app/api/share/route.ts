import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateShareStructure, newShareId, SHARE_MAX_BODY_BYTES } from "@/lib/erd/shareLink";
import { validateShareEnvelope, SHARE_ENVELOPE_MAX_BYTES } from "@/lib/share/envelope";
import { shareKv, SHARE_TTL_SECONDS } from "./store";

/**
 * Ephemeral canvas shares (Cloudflare KV, 30-min TTL).
 * Stores structure only - api names, positions, view, opt-in notes.
 * Field metadata is never sent here; receivers re-describe locally.
 */

const KEY_PREFIX = "share:";

/** Backend status probe: tells the UI whether the KV binding is live on
 * this deployment (bindings attach at deploy time - adding one in the
 * dashboard without redeploying still reads false here). */
export async function GET() {
  const kv = await shareKv();
  return NextResponse.json({ ok: true, kv: kv !== null, now: Date.now() });
}

const shareEntityRowSchema = z.object({
  title: z.string().max(160).optional(),
  text: z.string().max(50_000),
  kind: z.enum(["note", "task", "question", "decision"]).optional(),
  status: z.enum(["open", "in-progress", "blocked", "awaiting-feedback", "done"]).optional(),
  updatedAt: z.number().optional(),
});

const legacyEntityNoteSchema = z.object({
  text: z.string().max(50_000),
  todo: z.boolean().optional(),
  done: z.boolean().optional(),
  updatedAt: z.number().optional(),
});

const shareBodySchema = z.object({
  v: z.number(),
  name: z.string().max(200).optional(),
  root: z.string().min(1).max(255),
  nodes: z.array(z.string().min(1).max(255)).min(1).max(2000),
  positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
  view: z.enum(["erd", "graph"]).optional(),
  notes: z.string().max(100_000).optional(),
  entityNotes: z.record(z.string(), z.union([z.array(shareEntityRowSchema), legacyEntityNoteSchema])).optional(),
  todos: z.array(z.object({
    id: z.string().min(1).max(160),
    title: z.string().min(1).max(200),
    body: z.string().max(12_000).optional(),
    assignee: z.string().max(120).optional(),
    dueDate: z.string().max(32).optional(),
    kind: z.enum(["note", "task", "question", "decision"]).optional(),
    owner: z.string().max(120).optional(),
    team: z.string().max(120).optional(),
    priority: z.enum(["low", "normal", "high", "critical"]).optional(),
    status: z.enum(["open", "in-progress", "blocked", "awaiting-feedback", "done"]).optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
  })).max(500).optional(),
});

export async function POST(req: NextRequest) {
  const kv = await shareKv();
  if (!kv) {
    return NextResponse.json(
      { error: "Share backend unavailable (KV binding missing)." },
      { status: 503 }
    );
  }
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > Math.max(SHARE_MAX_BODY_BYTES, SHARE_ENVELOPE_MAX_BYTES) + 4096) {
    return NextResponse.json({ error: "Share payload too large." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  // Generic envelope first (sequence / experience / system-project), then
  // the legacy ERD structure shape. Stored verbatim either way.
  const envelope = validateShareEnvelope(body);
  let structure: unknown = envelope;
  if (!envelope) {
    const parsed = shareBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid share structure." }, { status: 400 });
    }
    structure = validateShareStructure(parsed.data);
    if (!structure) {
      return NextResponse.json({ error: "Invalid share structure." }, { status: 400 });
    }
  }
  const id = newShareId();
  try {
    await kv.put(`${KEY_PREFIX}${id}`, JSON.stringify(structure), {
      expirationTtl: SHARE_TTL_SECONDS,
    });
  } catch {
    return NextResponse.json({ error: "Could not store share." }, { status: 500 });
  }
  return NextResponse.json({ id, expiresInSeconds: SHARE_TTL_SECONDS });
}
