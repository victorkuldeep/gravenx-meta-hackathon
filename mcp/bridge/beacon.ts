import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Bridge beacon: lets the studio tab auto-discover a locally running MCP
 * hub without copy-pasting the pairing code (OAuth-style, same machine).
 *
 * The hub writes { port, code, pid, startedAt } here on listen and removes
 * it on close. The studio dev server reads it through
 * GET /api/bridge/local and the Setup panel prefills the form - the
 * architect still presses Pair, so discovery never implies consent.
 * Remote deployments have no beacon file, so the route 404s and the manual
 * code flow remains the only path.
 */

export interface BridgeBeacon {
  v: 1;
  port: number;
  code: string;
  pid: number;
  startedAt: number;
}

export function beaconFile(): string {
  // NOTE: resolved from env (not os.tmpdir() directly) so Cloudflare
  // OpenNext file-tracing cannot statically evaluate it into a bundle path.
  // The hub and the dev-server route share the same machine env, so they
  // always agree at runtime.
  const base =
    process.env.GRAVENX_BEACON_DIR ||
    process.env.TEMP ||
    process.env.TMP ||
    process.env.TMPDIR ||
    os.tmpdir();
  return path.join(base, "gravenx-bridge.json");
}

export function writeBeacon(port: number, code: string): void {
  try {
    const beacon: BridgeBeacon = { v: 1, port, code, pid: process.pid, startedAt: Date.now() };
    writeFileSync(beaconFile(), JSON.stringify(beacon), "utf8");
  } catch {
    /* discovery is best-effort; pairing still works manually */
  }
}

export function clearBeacon(): void {
  try {
    unlinkSync(beaconFile());
  } catch {
    /* already gone */
  }
}

export function readBeacon(): BridgeBeacon | null {
  try {
    const raw = JSON.parse(readFileSync(beaconFile(), "utf8")) as Partial<BridgeBeacon>;
    if (raw.v !== 1 || !Number.isFinite(raw.port) || typeof raw.code !== "string" || !raw.code) return null;
    return raw as BridgeBeacon;
  } catch {
    return null;
  }
}
