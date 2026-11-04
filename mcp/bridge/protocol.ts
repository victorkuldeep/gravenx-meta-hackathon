/**
 * Agent bridge protocol v1 - KEEP IN SYNC with bridge/protocol.ts
 * in the gravenx-mcp repo. Bump BRIDGE_PROTOCOL_V on any wire change.
 */

export const BRIDGE_PROTOCOL_V = 1;

export const BRIDGE_READS = ["bridge.ping", "erd.snapshot"] as const;
export const BRIDGE_WRITES = [
  "erd.discover",
  "erd.place",
  "erd.focus",
  "erd.mode",
  "erd.filter",
  "erd.author_field",
  "erd.author_object",
] as const;

export type BridgeCommandKind =
  | (typeof BRIDGE_READS)[number]
  | (typeof BRIDGE_WRITES)[number];

export interface BridgeCall {
  v: number;
  id: string;
  type: "call";
  session: string;
  command: string;
  args: Record<string, unknown>;
}

export interface BridgeResult {
  v: number;
  id: string;
  type: "result";
  ok: boolean;
  data?: unknown;
  error?: string;
  denied?: boolean;
}

export interface BridgeHello {
  v: number;
  type: "hello";
  code: string;
  tab: string;
}

export interface BridgeWelcome {
  v: number;
  type: "welcome";
  session: string;
}

export function isWriteCommand(command: string): boolean {
  return (BRIDGE_WRITES as readonly string[]).includes(command);
}
