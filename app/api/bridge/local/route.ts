import { NextResponse } from "next/server";
import { readBeacon } from "@/mcp/bridge/beacon";

export const dynamic = "force-dynamic";

/**
 * GET /api/bridge/local - same-machine hub discovery for pairing.
 * Reads the beacon file the local MCP hub writes on listen; returns its
 * port + pairing code so Setup can prefill the form. Read-only, no tokens,
 * no org access. On deployed instances there is no beacon file and this
 * 404s - manual pairing stays the only path.
 */
export async function GET() {
  const beacon = readBeacon();
  if (!beacon) {
    return NextResponse.json(
      { ok: false, error: "No local hub beacon - start the MCP server on this machine first." },
      { status: 404 }
    );
  }
  return NextResponse.json({
    ok: true,
    port: beacon.port,
    code: beacon.code,
    ageMs: Date.now() - (beacon.startedAt || Date.now()),
  });
}
