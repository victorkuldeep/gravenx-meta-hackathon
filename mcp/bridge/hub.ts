import { WebSocketServer, type WebSocket } from "ws";
import {
  BRIDGE_PROTOCOL_V,
  type BridgeCall,
  type BridgeHello,
  type BridgeResult,
  type BridgeWelcome,
} from "./protocol.js";
import { clearBeacon, writeBeacon } from "./beacon.js";

/**
 * Agent bridge hub: a localhost-only WebSocket server the MCP process hosts.
 * One open GRAVENX tab dials in (after pairing); live tools forward command
 * calls to that tab and await its result. No tab connected -> tools fail
 * with a clear "enable Agent bridge in Setup" error.
 *
 * Security: 127.0.0.1 bind only, single tab, per-boot pairing code, session
 * id on every call, version handshake. Approval itself happens tab-side -
 * the hub just relays the delayed result.
 */

export interface BridgeStatus {
  listening: boolean;
  port: number;
  code: string;
  connected: boolean;
  tab: string | null;
}

interface Pending {
  resolve: (r: BridgeResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function makeCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export class BridgeHub {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private tabName: string | null = null;
  private session = "";
  private pending = new Map<string, Pending>();
  readonly code = makeCode();
  port = 0;

  get connected(): boolean {
    return this.socket !== null;
  }

  status(): BridgeStatus {
    return {
      listening: this.wss !== null,
      port: this.port,
      code: this.code,
      connected: this.connected,
      tab: this.tabName,
    };
  }

  listen(port: number): void {
    if (this.wss) return;
    // Requested port up front: address() is null until the async bind
    // completes, so the real port lands on the 'listening' event.
    this.port = port;
    this.wss = new WebSocketServer({ host: "127.0.0.1", port });
    this.wss.on("listening", () => {
      const addr = this.wss?.address();
      if (addr && typeof addr === "object") this.port = addr.port;
      // Beacon for same-machine auto-discovery (Setup > Find local hub).
      // Manual pairing with the printed code always keeps working.
      writeBeacon(this.port, this.code);
    });
    this.wss.on("close", () => clearBeacon());
    this.wss.on("connection", (ws: WebSocket) => this.onConnection(ws));
    this.wss.on("error", (err: Error) => {
      console.error(`[gravenx-bridge] listen failed on 127.0.0.1:${port}: ${err.message}`);
    });
  }

  private onConnection(ws: WebSocket): void {
    console.error("[gravenx-bridge] incoming connection.");
    if (this.socket) {
      try {
        ws.send(
          JSON.stringify({ v: BRIDGE_PROTOCOL_V, type: "result", id: "", ok: false, error: "Bridge busy - one tab at a time." })
        );
      } catch { /* ignore */ }
      ws.close();
      return;
    }
    let paired = false;
    const helloTimer = setTimeout(() => {
      if (!paired) {
        console.error("[gravenx-bridge] pairing timeout (no valid hello in 30s).");
        try { ws.close(4401, "Pairing timeout"); } catch { /* ignore */ }
      }
    }, 30000);
    ws.on("message", (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!paired) {
        const hello = msg as unknown as BridgeHello;
        if (hello.type !== "hello" || hello.v !== BRIDGE_PROTOCOL_V || hello.code !== this.code) {
          const why = hello.type !== "hello" ? "not-a-hello" : hello.v !== BRIDGE_PROTOCOL_V ? `version-${hello.v}` : "code-mismatch";
          console.error(`[gravenx-bridge] pairing rejected (${why}).`);
          try { ws.close(4403, "Pairing failed"); } catch { /* ignore */ }
          clearTimeout(helloTimer);
          return;
        }
        paired = true;
        clearTimeout(helloTimer);
        this.socket = ws;
        this.tabName = typeof hello.tab === "string" ? hello.tab.slice(0, 80) : "studio";
        console.error(`[gravenx-bridge] tab paired: ${this.tabName}.`);
        this.session = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
        const welcome: BridgeWelcome = { v: BRIDGE_PROTOCOL_V, type: "welcome", session: this.session };
        try { ws.send(JSON.stringify(welcome)); } catch { /* ignore */ }
        ws.on("close", () => this.drop(ws));
        ws.on("error", () => this.drop(ws));
        return;
      }
      const res = msg as unknown as BridgeResult;
      if (res.type === "result" && typeof res.id === "string") {
        const p = this.pending.get(res.id);
        if (p) {
          this.pending.delete(res.id);
          clearTimeout(p.timer);
          p.resolve(res);
        }
      }
    });
    ws.on("close", () => {
      if (!paired) clearTimeout(helloTimer);
    });
  }

  private drop(ws: WebSocket): void {
    if (this.socket !== ws) return;
    this.socket = null;
    this.tabName = null;
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.reject(new Error("Studio tab disconnected."));
    }
  }

  call(command: string, args: Record<string, unknown>, timeoutMs = 120000): Promise<BridgeResult> {
    const ws = this.socket;
    if (!ws) {
      return Promise.reject(
        new Error("No studio tab connected - open GRAVENX, enable Agent bridge in Setup, and pair.")
      );
    }
    const id = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const call: BridgeCall = { v: BRIDGE_PROTOCOL_V, id, type: "call", session: this.session, command, args };
    return new Promise<BridgeResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge call timed out (${command}) - the tab may be waiting on architect approval.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        ws.send(JSON.stringify(call));
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error("Bridge send failed."));
      }
    });
  }
}
