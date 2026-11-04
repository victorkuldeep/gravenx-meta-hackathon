import { NextResponse } from "next/server";
import { validateShareStructure } from "@/lib/erd/shareLink";
import { validateShareEnvelope } from "@/lib/share/envelope";
import { shareKv } from "../store";

const KEY_PREFIX = "share:";
const ID_PATTERN = /^[a-z0-9]{16,64}$/i;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!ID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Share link expired or invalid." }, { status: 404 });
  }
  const kv = await shareKv();
  if (!kv) {
    return NextResponse.json(
      { error: "Share backend unavailable (KV binding missing)." },
      { status: 503 }
    );
  }
  let raw: unknown;
  try {
    raw = await kv.get(`${KEY_PREFIX}${id}`, "json");
  } catch {
    return NextResponse.json({ error: "Could not read share." }, { status: 500 });
  }
  if (!raw) {
    // Expired (TTL) or never existed - indistinguishable by design.
    return NextResponse.json({ error: "Share link expired or invalid." }, { status: 404 });
  }
  const envelope = validateShareEnvelope(raw);
  if (envelope) return NextResponse.json(envelope);
  const structure = validateShareStructure(raw);
  if (!structure) {
    return NextResponse.json({ error: "Share link expired or invalid." }, { status: 404 });
  }
  return NextResponse.json(structure);
}
